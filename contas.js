// Contas de usuário: cadastro, login, progresso, amigos e ranking.
import crypto from 'crypto';
import express from 'express';
import { q, bancoAtivo } from './db.js';

const COOKIE = 'xadrez_sessao';
const DURACAO_SESSAO_DIAS = 30;
const NOME_VALIDO = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_VALIDO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// O e-mail do administrador fica na variável ADMIN_EMAIL do Render (não no código, que é público)
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
export const ehAdmin = (email) => !!ADMIN_EMAIL && String(email || '').toLowerCase() === ADMIN_EMAIL;

// "Mozilla/5.0 (Windows NT 10.0...) Chrome/..." -> "Chrome · Windows"
function resumoNavegador(ua = '') {
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Outro';
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '?';
  return `${nav} · ${so}`;
}

async function registrarLogin(req, { usuarioId = null, email, sucesso, tipo }) {
  try {
    await q('INSERT INTO logins (usuario_id, email, sucesso, tipo, ip, navegador) VALUES ($1, $2, $3, $4, $5, $6)', [
      usuarioId, String(email || '').slice(0, 200), sucesso, tipo, String(req.ip || '').slice(0, 64), resumoNavegador(req.get('user-agent')),
    ]);
  } catch (e) {
    console.error('Erro ao registrar login:', e.message);
  }
}

/* ---------- Senhas (scrypt, embutido no Node) ---------- */
function gerarHash(senha) {
  return new Promise((resolve, reject) => {
    const sal = crypto.randomBytes(16);
    crypto.scrypt(senha, sal, 64, (erro, chave) => {
      if (erro) reject(erro);
      else resolve(`scrypt$${sal.toString('hex')}$${chave.toString('hex')}`);
    });
  });
}

function conferirSenha(senha, guardado) {
  return new Promise((resolve) => {
    const [tipo, salHex, chaveHex] = String(guardado).split('$');
    if (tipo !== 'scrypt' || !salHex || !chaveHex) return resolve(false);
    crypto.scrypt(senha, Buffer.from(salHex, 'hex'), 64, (erro, chave) => {
      if (erro) return resolve(false);
      const esperado = Buffer.from(chaveHex, 'hex');
      resolve(esperado.length === chave.length && crypto.timingSafeEqual(esperado, chave));
    });
  });
}

/* ---------- Sessões ---------- */
export function lerCookie(cabecalho, nome = COOKIE) {
  for (const parte of String(cabecalho || '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function usuarioDaSessao(token) {
  if (!token || !bancoAtivo()) return null;
  const rows = await q(
    `SELECT u.id, u.nome, u.email FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = $1 AND s.expira_em > now() AND NOT u.bloqueado`,
    [token]
  );
  const u = rows[0];
  return u ? { ...u, admin: ehAdmin(u.email) } : null;
}

async function criarSessao(res, req, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sessoes (token, usuario_id, expira_em) VALUES ($1, $2, now() + interval '${DURACAO_SESSAO_DIAS} days')`, [token, usuarioId]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: DURACAO_SESSAO_DIAS * 24 * 3600 * 1000,
    path: '/',
  });
}

/* ---------- Limite de tentativas de login (contra adivinhação de senha) ---------- */
const tentativas = new Map(); // chave -> { n, ate }
function bloqueado(chave) {
  const t = tentativas.get(chave);
  return t && t.n >= 8 && t.ate > Date.now();
}
function registrarFalha(chave) {
  const t = tentativas.get(chave);
  if (!t || t.ate < Date.now()) tentativas.set(chave, { n: 1, ate: Date.now() + 15 * 60_000 });
  else t.n++;
}
setInterval(() => {
  const agora = Date.now();
  for (const [k, t] of tentativas) if (t.ate < agora) tentativas.delete(k);
}, 60_000).unref();

/* ---------- Perfil ---------- */
async function perfil(id) {
  const [u] = await q(
    `SELECT id, nome, email, round(elo)::int AS elo, vitorias, derrotas, empates,
            bot_vitorias, bot_derrotas, bot_empates, problemas, tema
     FROM usuarios WHERE id = $1`,
    [id]
  );
  return u ? { ...u, admin: ehAdmin(u.email) } : null;
}

/* ---------- Ranking e partidas online (chamado pelo servidor do jogo) ---------- */
export async function registrarPartida({ branco, preto, vencedor, motivo, lances }) {
  if (!bancoAtivo()) return;
  if (!branco.usuarioId && !preto.usuarioId) return; // dois convidados: nada a guardar
  await q(
    `INSERT INTO partidas (branco, preto, branco_nome, preto_nome, vencedor, motivo, lances)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [branco.usuarioId || null, preto.usuarioId || null, branco.nome, preto.nome, vencedor, motivo, lances]
  );

  // Pontos só contam entre duas contas diferentes e com pelo menos 2 lances de cada lado
  if (!branco.usuarioId || !preto.usuarioId || branco.usuarioId === preto.usuarioId || lances < 4) return;
  const linhas = await q('SELECT id, elo FROM usuarios WHERE id = ANY($1)', [[branco.usuarioId, preto.usuarioId]]);
  const elo = Object.fromEntries(linhas.map((l) => [l.id, Number(l.elo)]));
  const eb = elo[branco.usuarioId];
  const ep = elo[preto.usuarioId];
  if (eb === undefined || ep === undefined) return;
  const esperadoB = 1 / (1 + 10 ** ((ep - eb) / 400));
  const placarB = vencedor === 'w' ? 1 : vencedor === 'b' ? 0 : 0.5;
  const K = 32;
  const deltaB = K * (placarB - esperadoB);
  const col = (placar) => (placar === 1 ? 'vitorias' : placar === 0 ? 'derrotas' : 'empates');
  await q(`UPDATE usuarios SET elo = elo + $2, ${col(placarB)} = ${col(placarB)} + 1 WHERE id = $1`, [branco.usuarioId, deltaB]);
  await q(`UPDATE usuarios SET elo = elo - $2, ${col(1 - placarB)} = ${col(1 - placarB)} + 1 WHERE id = $1`, [preto.usuarioId, deltaB]);
}

export async function saoAmigos(a, b) {
  const r = await q('SELECT 1 FROM amizades WHERE aceita AND ((de = $1 AND para = $2) OR (de = $2 AND para = $1))', [a, b]);
  return r.length > 0;
}

/* ---------- Rotas ---------- */
// presenca(id) -> { online, jogando }; avisar(id, evento) -> manda um evento para as abas do usuário
// painel() -> números e salas ao vivo; desconectar(id) -> derruba as conexões de um usuário
export function rotasDeContas({ presenca, avisar, painel, desconectar }) {
  const r = express.Router();
  r.use(express.json({ limit: '20kb' }));

  // Express 4 não pega erros de funções async sozinho: embrulha cada rota
  for (const metodo of ['get', 'post']) {
    const original = r[metodo].bind(r);
    r[metodo] = (caminho, ...fns) =>
      original(caminho, ...fns.map((f) => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next)));
  }

  // Só aceita JSON nos POST (protege contra formulários de outros sites)
  r.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ erro: 'Formato inválido.' });
    next();
  });

  // Sem banco configurado: avisa e não deixa usar contas
  r.use(async (req, res, next) => {
    if (!bancoAtivo()) {
      if (req.path === '/eu') return res.json({ contas: false, usuario: null });
      if (req.path === '/ranking') return res.json([]);
      return res.status(503).json({ erro: 'As contas ainda não estão ativadas neste servidor.' });
    }
    try {
      req.usuario = await usuarioDaSessao(lerCookie(req.headers.cookie));
      next();
    } catch (e) {
      next(e);
    }
  });

  const precisaLogin = (req, res, next) => (req.usuario ? next() : res.status(401).json({ erro: 'Entre na sua conta primeiro.' }));

  r.get('/eu', async (req, res) => {
    res.json({ contas: true, usuario: req.usuario ? await perfil(req.usuario.id) : null });
  });

  r.post('/cadastrar', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const nome = String(req.body?.nome || '').trim();
    const senha = String(req.body?.senha || '');
    if (!EMAIL_VALIDO.test(email) || email.length > 254) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
    if (!NOME_VALIDO.test(nome)) return res.status(400).json({ erro: 'O apelido deve ter de 3 a 16 caracteres: letras, números ou _ (sem espaços nem acentos).' });
    if (senha.length < 6 || senha.length > 100) return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });
    const ip = req.ip;
    if (bloqueado('cad:' + ip)) return res.status(429).json({ erro: 'Muitas contas criadas. Tente mais tarde.' });
    const emailUsado = await q('SELECT 1 FROM usuarios WHERE lower(email) = $1', [email]);
    if (emailUsado.length) return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail. Tente entrar.' });
    const nomeUsado = await q('SELECT 1 FROM usuarios WHERE lower(nome) = lower($1)', [nome]);
    if (nomeUsado.length) return res.status(409).json({ erro: 'Esse apelido já está em uso. Escolha outro.' });
    const hash = await gerarHash(senha);
    let novo;
    try {
      [novo] = await q('INSERT INTO usuarios (nome, email, senha_hash, ultimo_login) VALUES ($1, $2, $3, now()) RETURNING id', [nome, email, hash]);
    } catch {
      return res.status(409).json({ erro: 'Esse e-mail ou apelido já está em uso.' });
    }
    registrarFalha('cad:' + ip); // conta como "tentativa" para limitar criação em massa
    await registrarLogin(req, { usuarioId: novo.id, email, sucesso: true, tipo: 'cadastro' });
    await criarSessao(res, req, novo.id);
    res.json({ usuario: await perfil(novo.id) });
  });

  // Entra com o e-mail (contas antigas, sem e-mail, ainda podem usar o apelido)
  r.post('/entrar', async (req, res) => {
    const login = String(req.body?.email || req.body?.nome || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    const chave = 'login:' + req.ip;
    const chaveConta = 'conta:' + login;
    if (bloqueado(chave) || bloqueado(chaveConta)) {
      await registrarLogin(req, { email: login, sucesso: false, tipo: 'bloqueado-tentativas' });
      return res.status(429).json({ erro: 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.' });
    }
    const [u] = await q(
      'SELECT id, senha_hash, bloqueado FROM usuarios WHERE lower(email) = $1 OR (email IS NULL AND lower(nome) = $1)',
      [login]
    );
    const ok = u ? await conferirSenha(senha, u.senha_hash) : await conferirSenha(senha, 'scrypt$00$00');
    if (!u || !ok) {
      registrarFalha(chave);
      registrarFalha(chaveConta);
      await registrarLogin(req, { usuarioId: u?.id, email: login, sucesso: false, tipo: 'senha-errada' });
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }
    if (u.bloqueado) {
      await registrarLogin(req, { usuarioId: u.id, email: login, sucesso: false, tipo: 'conta-bloqueada' });
      return res.status(403).json({ erro: 'Esta conta foi bloqueada pelo administrador.' });
    }
    tentativas.delete(chaveConta);
    await q('UPDATE usuarios SET ultimo_login = now() WHERE id = $1', [u.id]);
    await registrarLogin(req, { usuarioId: u.id, email: login, sucesso: true, tipo: 'login' });
    await criarSessao(res, req, u.id);
    res.json({ usuario: await perfil(u.id) });
  });

  // Trocar o e-mail (pede a senha para confirmar)
  r.post('/trocar-email', precisaLogin, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    if (!EMAIL_VALIDO.test(email) || email.length > 254) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
    const chave = 'email:' + req.usuario.id;
    if (bloqueado(chave)) return res.status(429).json({ erro: 'Muitas tentativas erradas. Espere 15 minutos.' });
    const [u] = await q('SELECT senha_hash, email FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (!u || !(await conferirSenha(senha, u.senha_hash))) {
      registrarFalha(chave);
      return res.status(401).json({ erro: 'Senha incorreta.' });
    }
    if ((u.email || '') === email) return res.status(400).json({ erro: 'Esse já é o seu e-mail.' });
    try {
      await q('UPDATE usuarios SET email = $2 WHERE id = $1', [req.usuario.id, email]);
    } catch {
      return res.status(409).json({ erro: 'Esse e-mail já está em uso em outra conta.' });
    }
    await registrarLogin(req, { usuarioId: req.usuario.id, email: `${u.email || '(sem e-mail)'} → ${email}`, sucesso: true, tipo: 'troca-email' });
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  // Contas antigas (criadas antes do e-mail) podem adicionar um e-mail
  r.post('/email', precisaLogin, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_VALIDO.test(email) || email.length > 254) return res.status(400).json({ erro: 'Digite um e-mail válido.' });
    const [atual] = await q('SELECT email FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (atual?.email) return res.status(400).json({ erro: 'Sua conta já tem um e-mail.' });
    try {
      await q('UPDATE usuarios SET email = $2 WHERE id = $1', [req.usuario.id, email]);
    } catch {
      return res.status(409).json({ erro: 'Esse e-mail já está em uso em outra conta.' });
    }
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  r.post('/sair', async (req, res) => {
    const token = lerCookie(req.headers.cookie);
    if (token) await q('DELETE FROM sessoes WHERE token = $1', [token]);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.post('/trocar-senha', precisaLogin, async (req, res) => {
    const atual = String(req.body?.atual || '');
    const nova = String(req.body?.nova || '');
    if (nova.length < 6 || nova.length > 100) return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 6 caracteres.' });
    const [u] = await q('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (!u || !(await conferirSenha(atual, u.senha_hash))) return res.status(401).json({ erro: 'A senha atual está errada.' });
    await q('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', [req.usuario.id, await gerarHash(nova)]);
    // derruba as outras sessões, mantém esta
    await q('DELETE FROM sessoes WHERE usuario_id = $1 AND token <> $2', [req.usuario.id, lerCookie(req.headers.cookie)]);
    res.json({ ok: true });
  });

  // Resultado de partida contra o bot: 'v' (vitória), 'd' (derrota) ou 'e' (empate)
  r.post('/progresso/bot', precisaLogin, async (req, res) => {
    const col = { v: 'bot_vitorias', d: 'bot_derrotas', e: 'bot_empates' }[req.body?.resultado];
    if (!col) return res.status(400).json({ erro: 'Resultado inválido.' });
    await q(`UPDATE usuarios SET ${col} = ${col} + 1 WHERE id = $1`, [req.usuario.id]);
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  // Problemas resolvidos (junta com o que já estava salvo)
  r.post('/progresso/problemas', precisaLogin, async (req, res) => {
    const lista = Array.isArray(req.body?.resolvidos) ? req.body.resolvidos : [];
    const validos = [...new Set(lista.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 500))];
    await q(
      `UPDATE usuarios SET problemas = ARRAY(SELECT DISTINCT unnest(problemas || $2::int[]) ORDER BY 1) WHERE id = $1`,
      [req.usuario.id, validos]
    );
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  r.post('/preferencias', precisaLogin, async (req, res) => {
    const tema = String(req.body?.tema || '').slice(0, 20);
    await q('UPDATE usuarios SET tema = $2 WHERE id = $1', [req.usuario.id, tema]);
    res.json({ ok: true });
  });

  r.get('/partidas', precisaLogin, async (req, res) => {
    const rows = await q(
      `SELECT branco, preto, branco_nome, preto_nome, vencedor, motivo, lances, criado_em
       FROM partidas WHERE branco = $1 OR preto = $1 ORDER BY criado_em DESC LIMIT 10`,
      [req.usuario.id]
    );
    const eu = req.usuario.id;
    res.json(rows.map((p) => {
      const minhaCor = p.branco === eu ? 'w' : 'b';
      return {
        oponente: minhaCor === 'w' ? p.preto_nome : p.branco_nome,
        cor: minhaCor,
        resultado: p.vencedor === null ? 'empate' : p.vencedor === minhaCor ? 'vitoria' : 'derrota',
        motivo: p.motivo,
        lances: p.lances,
        quando: p.criado_em,
      };
    }));
  });

  r.get('/ranking', async (req, res) => {
    const rows = await q(
      `SELECT nome, round(elo)::int AS elo, vitorias AS v, derrotas AS d, empates AS e
       FROM usuarios WHERE vitorias + derrotas + empates > 0 ORDER BY elo DESC LIMIT 20`
    );
    res.json(rows);
  });

  /* ---------- Amigos ---------- */
  r.get('/amigos', precisaLogin, async (req, res) => {
    const eu = req.usuario.id;
    const rows = await q(
      `SELECT a.de, a.para, a.aceita, u.id, u.nome, round(u.elo)::int AS elo
       FROM amizades a JOIN usuarios u ON u.id = CASE WHEN a.de = $1 THEN a.para ELSE a.de END
       WHERE a.de = $1 OR a.para = $1 ORDER BY lower(u.nome)`,
      [eu]
    );
    const amigos = [];
    const recebidos = [];
    const enviados = [];
    for (const l of rows) {
      const item = { id: l.id, nome: l.nome, elo: l.elo };
      if (l.aceita) amigos.push({ ...item, ...presenca(l.id) });
      else if (l.para === eu) recebidos.push(item);
      else enviados.push(item);
    }
    res.json({ amigos, recebidos, enviados });
  });

  r.post('/amigos/pedir', precisaLogin, async (req, res) => {
    const eu = req.usuario.id;
    const nome = String(req.body?.nome || '').trim();
    const [alvo] = await q('SELECT id, nome FROM usuarios WHERE lower(nome) = lower($1)', [nome]);
    if (!alvo) return res.status(404).json({ erro: 'Não encontrei ninguém com esse nome.' });
    if (alvo.id === eu) return res.status(400).json({ erro: 'Você não pode adicionar a si mesmo. 😄' });
    const [existente] = await q('SELECT de, para, aceita FROM amizades WHERE (de = $1 AND para = $2) OR (de = $2 AND para = $1)', [eu, alvo.id]);
    if (existente?.aceita) return res.status(409).json({ erro: `Você e ${alvo.nome} já são amigos.` });
    if (existente && existente.de === eu) return res.status(409).json({ erro: 'Você já mandou um pedido para essa pessoa.' });
    if (existente) {
      // A outra pessoa já tinha me pedido: vira amizade direto
      await q('UPDATE amizades SET aceita = true WHERE de = $1 AND para = $2', [alvo.id, eu]);
      avisar(alvo.id, 'amigos-mudou', { texto: `${req.usuario.nome} aceitou seu pedido de amizade! 🎉` });
      return res.json({ ok: true, texto: `Agora você e ${alvo.nome} são amigos!` });
    }
    await q('INSERT INTO amizades (de, para) VALUES ($1, $2)', [eu, alvo.id]);
    avisar(alvo.id, 'amigos-mudou', { texto: `${req.usuario.nome} quer ser seu amigo!` });
    res.json({ ok: true, texto: `Pedido enviado para ${alvo.nome}.` });
  });

  r.post('/amigos/aceitar', precisaLogin, async (req, res) => {
    const eu = req.usuario.id;
    const id = Number(req.body?.id);
    const rows = await q('UPDATE amizades SET aceita = true WHERE de = $1 AND para = $2 AND NOT aceita RETURNING de', [id, eu]);
    if (!rows.length) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    avisar(id, 'amigos-mudou', { texto: `${req.usuario.nome} aceitou seu pedido de amizade! 🎉` });
    res.json({ ok: true });
  });

  // Recusar pedido, cancelar pedido enviado ou desfazer amizade
  r.post('/amigos/remover', precisaLogin, async (req, res) => {
    const eu = req.usuario.id;
    const id = Number(req.body?.id);
    await q('DELETE FROM amizades WHERE (de = $1 AND para = $2) OR (de = $2 AND para = $1)', [eu, id]);
    avisar(id, 'amigos-mudou', {});
    res.json({ ok: true });
  });

  /* ---------- Painel do administrador ---------- */
  const soAdmin = (req, res, next) => (req.usuario?.admin ? next() : res.status(403).json({ erro: 'Acesso só para o administrador.' }));

  r.get('/admin/resumo', soAdmin, async (req, res) => {
    const [n] = await q(`SELECT
      (SELECT count(*)::int FROM usuarios) AS contas,
      (SELECT count(*)::int FROM usuarios WHERE criado_em > now() - interval '1 day') AS contas_hoje,
      (SELECT count(*)::int FROM usuarios WHERE bloqueado) AS bloqueadas,
      (SELECT count(*)::int FROM logins WHERE sucesso AND quando > now() - interval '1 day') AS logins_hoje,
      (SELECT count(*)::int FROM logins WHERE NOT sucesso AND quando > now() - interval '1 day') AS falhas_hoje,
      (SELECT count(*)::int FROM partidas WHERE criado_em > now() - interval '1 day') AS partidas_hoje,
      (SELECT count(*)::int FROM partidas) AS partidas_total`);
    res.json({ ...n, ...painel() });
  });

  r.get('/admin/usuarios', soAdmin, async (req, res) => {
    const busca = `%${String(req.query.busca || '').trim().toLowerCase()}%`;
    const rows = await q(
      `SELECT u.id, u.nome, u.email, round(u.elo)::int AS elo, u.vitorias, u.derrotas, u.empates,
              u.bot_vitorias, u.bot_derrotas, u.bot_empates, cardinality(u.problemas) AS problemas,
              u.bloqueado, u.criado_em, u.ultimo_login,
              (SELECT count(*)::int FROM amizades a WHERE a.aceita AND (a.de = u.id OR a.para = u.id)) AS amigos
       FROM usuarios u
       WHERE lower(u.nome) LIKE $1 OR lower(coalesce(u.email, '')) LIKE $1
       ORDER BY u.criado_em DESC LIMIT 200`,
      [busca]
    );
    res.json(rows.map((u) => ({ ...u, admin: ehAdmin(u.email), ...presenca(u.id) })));
  });

  r.get('/admin/logins', soAdmin, async (req, res) => {
    const rows = await q(
      `SELECT l.quando, l.email, l.sucesso, l.tipo, l.ip, l.navegador, u.nome
       FROM logins l LEFT JOIN usuarios u ON u.id = l.usuario_id
       ORDER BY l.quando DESC LIMIT 200`
    );
    res.json(rows);
  });

  r.get('/admin/partidas', soAdmin, async (req, res) => {
    const rows = await q(
      `SELECT branco_nome, preto_nome, vencedor, motivo, lances, criado_em
       FROM partidas ORDER BY criado_em DESC LIMIT 100`
    );
    res.json(rows);
  });

  r.get('/admin/salas', soAdmin, (req, res) => res.json(painel().salas));

  // Ações sobre uma conta (nunca sobre a própria conta do admin)
  async function alvoDaAcao(req, res) {
    const id = Number(req.body?.id);
    const [u] = await q('SELECT id, nome, email FROM usuarios WHERE id = $1', [id]);
    if (!u) { res.status(404).json({ erro: 'Conta não encontrada.' }); return null; }
    if (u.id === req.usuario.id || ehAdmin(u.email)) { res.status(400).json({ erro: 'Você não pode fazer isso com a conta de administrador.' }); return null; }
    return u;
  }

  r.post('/admin/bloquear', soAdmin, async (req, res) => {
    const u = await alvoDaAcao(req, res);
    if (!u) return;
    const bloquear = req.body?.bloquear !== false;
    await q('UPDATE usuarios SET bloqueado = $2 WHERE id = $1', [u.id, bloquear]);
    if (bloquear) {
      await q('DELETE FROM sessoes WHERE usuario_id = $1', [u.id]);
      desconectar(u.id);
    }
    res.json({ ok: true, texto: bloquear ? `${u.nome} foi bloqueado.` : `${u.nome} foi desbloqueado.` });
  });

  r.post('/admin/senha', soAdmin, async (req, res) => {
    const u = await alvoDaAcao(req, res);
    if (!u) return;
    const nova = String(req.body?.nova || '');
    if (nova.length < 6 || nova.length > 100) return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });
    await q('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', [u.id, await gerarHash(nova)]);
    await q('DELETE FROM sessoes WHERE usuario_id = $1', [u.id]);
    desconectar(u.id);
    res.json({ ok: true, texto: `Senha de ${u.nome} trocada. Avise a pessoa da nova senha.` });
  });

  r.post('/admin/excluir', soAdmin, async (req, res) => {
    const u = await alvoDaAcao(req, res);
    if (!u) return;
    desconectar(u.id);
    await q('DELETE FROM usuarios WHERE id = $1', [u.id]);
    res.json({ ok: true, texto: `A conta de ${u.nome} foi excluída.` });
  });

  // Erros inesperados (ex.: banco fora do ar)
  r.use((erro, req, res, next) => {
    console.error('Erro na API:', erro.message);
    res.status(500).json({ erro: 'Algo deu errado no servidor. Tente de novo.' });
  });

  return r;
}
