// Contas de usuário: cadastro, login, progresso, amigos e ranking.
import crypto from 'crypto';
import express from 'express';
import { q, bancoAtivo } from './db.js';
import { filtrarTexto } from './filtro.js';
import { emailAtivo, enviarEmail, modeloEmail } from './email.js';

/* ---------- Moderação: quem está proibido de falar e IPs banidos (guardados também na memória) ---------- */
export const silenciados = new Set(); // ids de contas proibidas de usar o chat
const ipsBanidos = new Set();
export const normalizarIp = (ip) => String(ip || '').replace(/^::ffff:/, '').trim();
export const ipBanido = (ip) => ipsBanidos.has(normalizarIp(ip));
export async function carregarModeracao() {
  if (!bancoAtivo()) return;
  for (const r of await q('SELECT id FROM usuarios WHERE chat_bloqueado')) silenciados.add(r.id);
  for (const r of await q('SELECT ip FROM ips_banidos')) ipsBanidos.add(r.ip);
}

/* ---------- Links por e-mail (confirmar conta e redefinir senha) ---------- */
// O endereço do site vem do Render (não do navegador, para ninguém conseguir trocar o link do e-mail)
const SITE = (process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function criarToken(usuarioId, tipo) {
  const token = crypto.randomBytes(32).toString('hex');
  await q('DELETE FROM tokens_email WHERE usuario_id = $1 AND tipo = $2', [usuarioId, tipo]);
  await q(`INSERT INTO tokens_email (token_hash, usuario_id, tipo, expira_em) VALUES ($1, $2, $3, now() + interval '1 hour')`, [sha256(token), usuarioId, tipo]);
  return token;
}
async function usarToken(token, tipo) {
  const [t] = await q('DELETE FROM tokens_email WHERE token_hash = $1 AND tipo = $2 AND expira_em > now() RETURNING usuario_id',
    [sha256(String(token || '')), tipo]);
  return t?.usuario_id || null;
}
async function enviarConfirmacao(usuarioId) {
  if (!emailAtivo()) return false;
  const [u] = await q('SELECT nome, email, email_confirmado FROM usuarios WHERE id = $1', [usuarioId]);
  if (!u?.email || u.email_confirmado) return false;
  const token = await criarToken(usuarioId, 'confirmar');
  return enviarEmail(u.email, 'Confirme seu e-mail no Xadrez',
    modeloEmail(`Olá, ${u.nome}!`, 'Clique no botão abaixo para confirmar que este e-mail é seu.', 'Confirmar meu e-mail', `${SITE}/?confirmar=${token}`));
}

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
    `SELECT u.id, u.nome, u.email, u.avatar, round(u.elo)::int AS elo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
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
    `SELECT id, nome, email, avatar, round(elo)::int AS elo, vitorias, derrotas, empates,
            bot_vitorias, bot_derrotas, bot_empates, problemas, tema,
            to_char(problema_dia_data, 'YYYY-MM-DD') AS problema_dia_data, problema_dia_seq, email_confirmado, chat_bloqueado
     FROM usuarios WHERE id = $1`,
    [id]
  );
  return u ? { ...u, admin: ehAdmin(u.email) } : null;
}

/* ---------- Conquistas ---------- */
let avisarUsuario = () => {}; // definido quando as rotas são montadas
export const CONQUISTAS = {
  primeira_vitoria: { nome: 'Primeira vitória', icone: '🎉', desc: 'Venceu sua primeira partida online valendo ELO' },
  vitorias_10: { nome: 'Dez vitórias', icone: '🔟', desc: 'Venceu 10 partidas online' },
  vitorias_50: { nome: 'Veterano', icone: '🎖️', desc: 'Venceu 50 partidas online' },
  sequencia_3: { nome: 'Embalado', icone: '🔥', desc: 'Venceu 3 partidas online seguidas' },
  sequencia_10: { nome: 'Imparável', icone: '☄️', desc: 'Venceu 10 partidas online seguidas' },
  partidas_100: { nome: 'Viciado em xadrez', icone: '♟️', desc: 'Jogou 100 partidas online' },
  mate_rapido: { nome: 'Mate relâmpago', icone: '⚡', desc: 'Deu xeque-mate em até 10 lances numa partida online' },
  bala: { nome: 'Bala', icone: '🚀', desc: 'Venceu uma partida online de 1 minuto' },
  liga_ouro: { nome: 'Liga Ouro', icone: '🥇', desc: 'Chegou a 600 de ELO' },
  liga_diamante: { nome: 'Liga Diamante', icone: '💎', desc: 'Chegou a 1500 de ELO' },
  liga_mestre: { nome: 'Liga Mestre', icone: '👑', desc: 'Chegou a 2000 de ELO' },
  bot_5: { nome: 'Domador de robôs', icone: '🤖', desc: 'Venceu o bot no nível 5 ou mais' },
  bot_8: { nome: 'Exterminador', icone: '🦾', desc: 'Venceu o bot no nível 8 ou mais' },
  bot_10: { nome: 'Lenda', icone: '🧠', desc: 'Venceu o bot no nível máximo (10)' },
  problemas_10: { nome: 'Resolvedor', icone: '🧩', desc: 'Resolveu 10 problemas' },
  problemas_30: { nome: 'Mestre dos problemas', icone: '🏅', desc: 'Resolveu 30 problemas' },
  problema_dia_7: { nome: 'Semana perfeita', icone: '📅', desc: 'Resolveu o problema do dia 7 dias seguidos' },
  amigos_5: { nome: 'Popular', icone: '👥', desc: 'Tem 5 amigos' },
  campeao: { nome: 'Campeão do mês', icone: '🏆', desc: 'Terminou um mês em 1º lugar no ranking mensal' },
  torneio: { nome: 'Campeão de torneio', icone: '🏟️', desc: 'Venceu um torneio' },
};

// Avatares que dá para escolher
export const AVATARES = ['🦁', '🐯', '🐺', '🦊', '🐼', '🐨', '🐸', '🐵', '🦄', '🐲', '🦉', '🦅', '🐢', '🐬', '🐙', '🐝',
  '🤖', '👽', '👑', '🧙', '🥷', '🦸', '🧛', '🤠', '😎', '🔥', '⚡', '🌟', '💎', '🎯', '♞', '♛'];

export async function darConquista(usuarioId, codigo) {
  if (!usuarioId || !CONQUISTAS[codigo] || !bancoAtivo()) return;
  const r = await q('INSERT INTO conquistas (usuario_id, codigo) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING codigo', [usuarioId, codigo]);
  if (r.length) avisarUsuario(usuarioId, 'conquista', { codigo, ...CONQUISTAS[codigo] });
}

async function conquistasDeAmigos(usuarioId) {
  const [r] = await q('SELECT count(*)::int AS n FROM amizades WHERE aceita AND (de = $1 OR para = $1)', [usuarioId]);
  if (r.n >= 5) await darConquista(usuarioId, 'amigos_5');
}

/* ---------- Temporadas (ranking de cada mês) ---------- */
const mesAtual = () => new Date().toISOString().slice(0, 7); // "2026-11"

// Guarda o pódio dos meses que já acabaram (roda ao ligar o servidor e de hora em hora)
export async function fecharTemporadas() {
  if (!bancoAtivo()) return;
  const meses = await q(
    `SELECT DISTINCT to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM') AS mes FROM elo_historico
     WHERE to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM') < $1
       AND to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM') NOT IN (SELECT temporada FROM temporada_premios)`,
    [mesAtual()]
  );
  for (const { mes } of meses) {
    const top = await rankingDoMes(mes, 3);
    for (const [i, t] of top.entries()) {
      await q('INSERT INTO temporada_premios (temporada, posicao, usuario_id, nome, pontos) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [mes, i + 1, t.id, t.nome, t.pontos]);
      if (i === 0) await darConquista(t.id, 'campeao');
    }
    if (!top.length) await q(`INSERT INTO temporada_premios (temporada, posicao, nome, pontos) VALUES ($1, 0, '-', 0) ON CONFLICT DO NOTHING`, [mes]);
  }
}

// Ranking do mês: quem mais GANHOU ELO no mês
async function rankingDoMes(mes, limite = 20) {
  return q(
    `SELECT u.id, u.nome, round(u.elo)::int AS elo, sum(h.delta)::int AS pontos, count(*)::int AS partidas
     FROM elo_historico h JOIN usuarios u ON u.id = h.usuario_id
     WHERE to_char(h.criado_em AT TIME ZONE 'UTC', 'YYYY-MM') = $1 AND NOT u.bloqueado
     GROUP BY u.id HAVING sum(h.delta) > 0 ORDER BY pontos DESC, partidas DESC LIMIT $2`,
    [mes, limite]
  );
}

/* ---------- Ranking e partidas online (chamado pelo servidor do jogo) ---------- */
export async function registrarPartida({ branco, preto, vencedor, motivo, lances, historico = [], minutos = 0 }) {
  if (!bancoAtivo()) return null;
  if (!branco.usuarioId && !preto.usuarioId) return null; // dois convidados: nada a guardar
  const [partida] = await q(
    `INSERT INTO partidas (branco, preto, branco_nome, preto_nome, vencedor, motivo, lances, historico)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [branco.usuarioId || null, preto.usuarioId || null, branco.nome, preto.nome, vencedor, motivo, lances, historico.join(' ')]
  );

  // Pontos só contam entre duas contas diferentes e com pelo menos 2 lances de cada lado
  if (!branco.usuarioId || !preto.usuarioId || branco.usuarioId === preto.usuarioId || lances < 4) return null;
  const linhas = await q('SELECT id, elo FROM usuarios WHERE id = ANY($1)', [[branco.usuarioId, preto.usuarioId]]);
  const elo = Object.fromEntries(linhas.map((l) => [l.id, Number(l.elo)]));
  const eb = elo[branco.usuarioId];
  const ep = elo[preto.usuarioId];
  if (eb === undefined || ep === undefined) return null;
  const esperadoB = 1 / (1 + 10 ** ((ep - eb) / 400));
  const placarB = vencedor === 'w' ? 1 : vencedor === 'b' ? 0 : 0.5;
  const K = 32;
  const deltaB = K * (placarB - esperadoB);
  const col = (placar) => (placar === 1 ? 'vitorias' : placar === 0 ? 'derrotas' : 'empates');
  // O ELO nunca fica negativo: quem está em 0 e perde continua em 0
  const novoB = Math.max(0, eb + deltaB);
  const novoP = Math.max(0, ep - deltaB);
  // Vitórias seguidas: quem ganha soma 1, quem perde ou empata volta a 0
  const seq = (placar) => (placar === 1 ? 'sequencia + 1' : '0');
  const [ub] = await q(`UPDATE usuarios SET elo = $2, ${col(placarB)} = ${col(placarB)} + 1, sequencia = ${seq(placarB)} WHERE id = $1 RETURNING vitorias, derrotas, empates, sequencia`, [branco.usuarioId, novoB]);
  const [up] = await q(`UPDATE usuarios SET elo = $2, ${col(1 - placarB)} = ${col(1 - placarB)} + 1, sequencia = ${seq(1 - placarB)} WHERE id = $1 RETURNING vitorias, derrotas, empates, sequencia`, [preto.usuarioId, novoP]);
  // Devolve o ELO novo e quanto cada um ganhou/perdeu (arredondado, como aparece na tela)
  const nb = Math.round(novoB);
  const np = Math.round(novoP);
  const mudanca = {
    w: { elo: nb, delta: nb - Math.round(eb) },
    b: { elo: np, delta: np - Math.round(ep) },
  };
  await q('INSERT INTO elo_historico (usuario_id, elo, delta, partida_id) VALUES ($1, $2, $3, $5), ($4, $6, $7, $5)',
    [branco.usuarioId, nb, mudanca.w.delta, preto.usuarioId, partida.id, np, mudanca.b.delta]);

  // Conquistas
  for (const [id, u, elo, ganhou] of [[branco.usuarioId, ub, nb, placarB === 1], [preto.usuarioId, up, np, placarB === 0]]) {
    if (!u) continue;
    if (u.vitorias + u.derrotas + u.empates >= 100) await darConquista(id, 'partidas_100');
    if (elo >= 600) await darConquista(id, 'liga_ouro');
    if (elo >= 1500) await darConquista(id, 'liga_diamante');
    if (elo >= 2000) await darConquista(id, 'liga_mestre');
    if (!ganhou) continue;
    await darConquista(id, 'primeira_vitoria');
    if (u.vitorias >= 10) await darConquista(id, 'vitorias_10');
    if (u.vitorias >= 50) await darConquista(id, 'vitorias_50');
    if (u.sequencia >= 3) await darConquista(id, 'sequencia_3');
    if (u.sequencia >= 10) await darConquista(id, 'sequencia_10');
    if (motivo === 'mate' && lances <= 20) await darConquista(id, 'mate_rapido');
    if (minutos === 1) await darConquista(id, 'bala');
  }
  return mudanca;
}

/* ---------- Denúncias do chat (chamado pelo servidor do jogo) ---------- */
const MOTIVOS_DENUNCIA = ['ofensa', 'assedio', 'spam', 'trapaca', 'outro'];
export async function registrarDenuncia(d) {
  if (!bancoAtivo()) throw new Error('Banco de dados não configurado');
  const motivo = MOTIVOS_DENUNCIA.includes(d.motivo) ? d.motivo : 'outro';
  await q(
    `INSERT INTO denuncias (denunciante_id, denunciante_nome, denunciado_id, denunciado_nome, mensagem, motivo, detalhes, sala, denunciado_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [d.denuncianteId, d.denuncianteNome, d.denunciadoId, d.denunciadoNome, d.mensagem, motivo,
      String(d.detalhes || '').trim().slice(0, 300) || null, d.sala, d.denunciadoIp || null]
  );
}

export async function saoAmigos(a, b) {
  const r = await q('SELECT 1 FROM amizades WHERE aceita AND ((de = $1 AND para = $2) OR (de = $2 AND para = $1))', [a, b]);
  return r.length > 0;
}

/* ---------- Rotas ---------- */
// presenca(id) -> { online, jogando }; avisar(id, evento) -> manda um evento para as abas do usuário
// painel() -> números e salas ao vivo; desconectar(id) -> derruba as conexões de um usuário
export function rotasDeContas({ presenca, avisar, painel, desconectar, desconectarIp }) {
  avisarUsuario = avisar;
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
    res.json({ contas: true, emailAtivo: emailAtivo(), usuario: req.usuario ? await perfil(req.usuario.id) : null });
  });

  /* ---------- Esqueci minha senha / confirmar e-mail ---------- */
  r.post('/esqueci-senha', async (req, res) => {
    if (!emailAtivo()) return res.status(503).json({ erro: 'A recuperação por e-mail ainda não está ativada. Peça ao administrador para trocar sua senha.' });
    const chave = 'esq:' + req.ip;
    if (bloqueado(chave)) return res.status(429).json({ erro: 'Muitos pedidos. Espere 15 minutos.' });
    registrarFalha(chave);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const [u] = await q('SELECT id, nome FROM usuarios WHERE lower(email) = $1 AND NOT bloqueado', [email]);
    if (u) {
      const token = await criarToken(u.id, 'senha');
      await enviarEmail(email, 'Redefinir sua senha no Xadrez',
        modeloEmail(`Olá, ${u.nome}!`, 'Recebemos um pedido para trocar a senha da sua conta. Clique no botão para escolher uma senha nova.', 'Escolher nova senha', `${SITE}/?redefinir=${token}`));
      await registrarLogin(req, { usuarioId: u.id, email, sucesso: true, tipo: 'pediu-nova-senha' });
    }
    // Mesma resposta exista ou não a conta (para ninguém descobrir quais e-mails estão cadastrados)
    res.json({ ok: true, texto: 'Se esse e-mail tiver conta, enviamos um link para trocar a senha. Olhe também a caixa de spam.' });
  });

  r.post('/redefinir-senha', async (req, res) => {
    const nova = String(req.body?.nova || '');
    if (nova.length < 6 || nova.length > 100) return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });
    const id = await usarToken(req.body?.token, 'senha');
    if (!id) return res.status(400).json({ erro: 'Esse link é inválido ou já expirou. Peça um novo em "Esqueci minha senha".' });
    await q('UPDATE usuarios SET senha_hash = $2, email_confirmado = true WHERE id = $1', [id, await gerarHash(nova)]);
    await q('DELETE FROM sessoes WHERE usuario_id = $1', [id]); // sai de todos os aparelhos
    await registrarLogin(req, { usuarioId: id, email: '', sucesso: true, tipo: 'redefiniu-senha' });
    await criarSessao(res, req, id);
    res.json({ ok: true, usuario: await perfil(id), texto: 'Senha trocada! Você já está dentro da sua conta.' });
  });

  r.post('/confirmar-email', async (req, res) => {
    const id = await usarToken(req.body?.token, 'confirmar');
    if (!id) return res.status(400).json({ erro: 'Esse link de confirmação é inválido ou já expirou.' });
    await q('UPDATE usuarios SET email_confirmado = true WHERE id = $1', [id]);
    res.json({ ok: true, texto: 'E-mail confirmado! ✅' });
  });

  r.post('/reenviar-confirmacao', precisaLogin, async (req, res) => {
    if (!emailAtivo()) return res.status(503).json({ erro: 'O envio de e-mails ainda não está ativado.' });
    const chave = 'conf:' + req.usuario.id;
    if (bloqueado(chave)) return res.status(429).json({ erro: 'Já enviamos vários. Espere um pouco.' });
    registrarFalha(chave);
    const ok = await enviarConfirmacao(req.usuario.id);
    res.json({ ok, texto: ok ? 'Enviamos o link de confirmação para o seu e-mail.' : 'Seu e-mail já está confirmado (ou não foi possível enviar).' });
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
    enviarConfirmacao(novo.id).catch(() => {});
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
      await q('UPDATE usuarios SET email = $2, email_confirmado = false WHERE id = $1', [req.usuario.id, email]);
    } catch {
      return res.status(409).json({ erro: 'Esse e-mail já está em uso em outra conta.' });
    }
    enviarConfirmacao(req.usuario.id).catch(() => {});
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
    const nivel = Number(req.body?.nivel) || 0;
    if (req.body.resultado === 'v') {
      if (nivel >= 5) await darConquista(req.usuario.id, 'bot_5');
      if (nivel >= 8) await darConquista(req.usuario.id, 'bot_8');
      if (nivel >= 10) await darConquista(req.usuario.id, 'bot_10');
    }
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  // Problemas resolvidos (junta com o que já estava salvo)
  r.post('/progresso/problemas', precisaLogin, async (req, res) => {
    const lista = Array.isArray(req.body?.resolvidos) ? req.body.resolvidos : [];
    const validos = [...new Set(lista.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 500))];
    const [r2] = await q(
      `UPDATE usuarios SET problemas = ARRAY(SELECT DISTINCT unnest(problemas || $2::int[]) ORDER BY 1) WHERE id = $1
       RETURNING cardinality(problemas) AS n`,
      [req.usuario.id, validos]
    );
    if (r2?.n >= 10) await darConquista(req.usuario.id, 'problemas_10');
    if (r2?.n >= 30) await darConquista(req.usuario.id, 'problemas_30');
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  // Resolveu o problema do dia: conta a sequência de dias seguidos (no horário de Brasília)
  r.post('/progresso/problema-dia', precisaLogin, async (req, res) => {
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const [u] = await q(
      `UPDATE usuarios SET
         problema_dia_seq = CASE WHEN problema_dia_data = $2::date THEN problema_dia_seq
                                 WHEN problema_dia_data = $2::date - 1 THEN problema_dia_seq + 1 ELSE 1 END,
         problema_dia_data = $2::date
       WHERE id = $1 RETURNING problema_dia_seq`,
      [req.usuario.id, hoje]
    );
    if (u?.problema_dia_seq >= 7) await darConquista(req.usuario.id, 'problema_dia_7');
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  r.post('/preferencias', precisaLogin, async (req, res) => {
    const tema = String(req.body?.tema || '').slice(0, 20);
    await q('UPDATE usuarios SET tema = $2 WHERE id = $1', [req.usuario.id, tema]);
    res.json({ ok: true });
  });

  r.get('/partidas', precisaLogin, async (req, res) => {
    const rows = await q(
      `SELECT id, branco, preto, branco_nome, preto_nome, vencedor, motivo, lances, criado_em, historico IS NOT NULL AS tem_replay
       FROM partidas WHERE branco = $1 OR preto = $1 ORDER BY criado_em DESC LIMIT 10`,
      [req.usuario.id]
    );
    const eu = req.usuario.id;
    res.json(rows.map((p) => {
      const minhaCor = p.branco === eu ? 'w' : 'b';
      return {
        id: p.id,
        temReplay: p.tem_replay,
        oponente: minhaCor === 'w' ? p.preto_nome : p.branco_nome,
        cor: minhaCor,
        resultado: p.vencedor === null ? 'empate' : p.vencedor === minhaCor ? 'vitoria' : 'derrota',
        motivo: p.motivo,
        lances: p.lances,
        quando: p.criado_em,
      };
    }));
  });

  // Uma partida completa (para o replay)
  r.get('/partida/:id', async (req, res) => {
    const [p] = await q(
      `SELECT id, branco_nome, preto_nome, vencedor, motivo, historico, criado_em FROM partidas WHERE id = $1`,
      [Number(req.params.id) || 0]
    );
    if (!p || p.historico === null) return res.status(404).json({ erro: 'Partida não encontrada.' });
    res.json({ ...p, historico: p.historico ? p.historico.split(' ') : [] });
  });

  // ?periodo=mes → quem mais ganhou ELO neste mês (temporada); sem nada → ranking geral
  r.get('/ranking', async (req, res) => {
    if (req.query.periodo === 'mes') {
      const rows = await rankingDoMes(mesAtual());
      return res.json(rows.map(({ id, ...x }) => x));
    }
    const rows = await q(
      `SELECT nome, avatar, round(elo)::int AS elo, vitorias AS v, derrotas AS d, empates AS e
       FROM usuarios WHERE vitorias + derrotas + empates > 0 AND NOT bloqueado ORDER BY elo DESC LIMIT 20`
    );
    res.json(rows);
  });

  // Campeões dos meses que já acabaram
  r.get('/temporadas', async (req, res) => {
    res.json(await q('SELECT temporada, posicao, nome, pontos FROM temporada_premios WHERE posicao > 0 ORDER BY temporada DESC, posicao LIMIT 36'));
  });

  r.get('/conquistas', (req, res) => res.json(CONQUISTAS));
  r.get('/avatares', (req, res) => res.json(AVATARES));

  r.post('/avatar', precisaLogin, async (req, res) => {
    const avatar = String(req.body?.avatar || '');
    if (!AVATARES.includes(avatar)) return res.status(400).json({ erro: 'Avatar inválido.' });
    await q('UPDATE usuarios SET avatar = $2 WHERE id = $1', [req.usuario.id, avatar]);
    res.json({ usuario: await perfil(req.usuario.id) });
  });

  /* ---------- Mensagens privadas (só entre amigos) ---------- */
  r.get('/mensagens/:amigo', precisaLogin, async (req, res) => {
    const eu = req.usuario.id;
    const outro = Number(req.params.amigo) || 0;
    if (!(await saoAmigos(eu, outro))) return res.status(403).json({ erro: 'Vocês precisam ser amigos para conversar.' });
    const rows = await q(
      `SELECT id, de, texto, criado_em FROM (
         SELECT * FROM mensagens WHERE (de = $1 AND para = $2) OR (de = $2 AND para = $1) ORDER BY criado_em DESC LIMIT 80
       ) x ORDER BY criado_em`,
      [eu, outro]
    );
    await q('UPDATE mensagens SET lida = true WHERE de = $2 AND para = $1 AND NOT lida', [eu, outro]);
    res.json(rows.map((m) => ({ id: m.id, minha: m.de === eu, texto: m.texto, quando: m.criado_em })));
  });

  const ultimasMsgs = new Map(); // usuarioId -> [horários] (contra spam)
  r.post('/mensagens', precisaLogin, async (req, res) => {
    const eu = req.usuario.id;
    const para = Number(req.body?.para) || 0;
    const texto = filtrarTexto(String(req.body?.texto || '').trim().slice(0, 500));
    if (!texto) return res.status(400).json({ erro: 'Escreva uma mensagem.' });
    if (silenciados.has(eu)) return res.status(403).json({ erro: '🔇 O administrador proibiu sua conta de mandar mensagens.' });
    if (!(await saoAmigos(eu, para))) return res.status(403).json({ erro: 'Vocês precisam ser amigos para conversar.' });
    const agora = Date.now();
    const recentes = (ultimasMsgs.get(eu) || []).filter((t) => agora - t < 60_000);
    if (recentes.length >= 20) return res.status(429).json({ erro: 'Calma! Muitas mensagens em pouco tempo.' });
    recentes.push(agora);
    ultimasMsgs.set(eu, recentes);
    const [m] = await q('INSERT INTO mensagens (de, para, texto) VALUES ($1, $2, $3) RETURNING id, criado_em', [eu, para, texto]);
    avisar(para, 'mensagem', { de: eu, nome: req.usuario.nome, avatar: req.usuario.avatar, texto, id: m.id, quando: m.criado_em });
    res.json({ id: m.id, minha: true, texto, quando: m.criado_em });
  });

  r.get('/mensagens-nao-lidas', precisaLogin, async (req, res) => {
    const [r2] = await q('SELECT count(*)::int AS n FROM mensagens WHERE para = $1 AND NOT lida', [req.usuario.id]);
    res.json({ n: r2.n });
  });

  // Perfil público de um jogador (por apelido)
  r.get('/perfil/:nome', async (req, res) => {
    const [u] = await q(
      `SELECT id, nome, avatar, round(elo)::int AS elo, vitorias, derrotas, empates, sequencia,
              bot_vitorias, cardinality(problemas) AS problemas, criado_em, bloqueado
       FROM usuarios WHERE lower(nome) = lower($1)`,
      [String(req.params.nome || '').slice(0, 32)]
    );
    if (!u || u.bloqueado) return res.status(404).json({ erro: 'Jogador não encontrado.' });
    const [conquistas, historicoElo, partidas, titulos, amizade] = await Promise.all([
      q('SELECT codigo, criado_em FROM conquistas WHERE usuario_id = $1 ORDER BY criado_em', [u.id]),
      q(`SELECT elo, delta, criado_em FROM (SELECT * FROM elo_historico WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 100) x ORDER BY criado_em`, [u.id]),
      q(`SELECT id, branco, branco_nome, preto_nome, vencedor, motivo, criado_em, historico IS NOT NULL AS tem_replay
         FROM partidas WHERE branco = $1 OR preto = $1 ORDER BY criado_em DESC LIMIT 10`, [u.id]),
      q('SELECT temporada, posicao, pontos FROM temporada_premios WHERE usuario_id = $1 ORDER BY temporada DESC', [u.id]),
      req.usuario ? q('SELECT aceita, de FROM amizades WHERE (de = $1 AND para = $2) OR (de = $2 AND para = $1)', [req.usuario.id, u.id]) : [],
    ]);
    const { id, bloqueado, ...publico } = u;
    res.json({
      ...publico,
      ...presenca(id),
      souEu: req.usuario?.id === id,
      amizade: amizade[0] ? (amizade[0].aceita ? 'amigos' : amizade[0].de === req.usuario.id ? 'enviado' : 'recebido') : null,
      conquistas: conquistas.map((c) => ({ ...c, ...CONQUISTAS[c.codigo] })),
      historicoElo,
      titulos,
      partidas: partidas.map((p) => {
        const cor = p.branco === id ? 'w' : 'b';
        return {
          id: p.id, temReplay: p.tem_replay, cor,
          oponente: cor === 'w' ? p.preto_nome : p.branco_nome,
          resultado: p.vencedor === null ? 'empate' : p.vencedor === cor ? 'vitoria' : 'derrota',
          motivo: p.motivo, quando: p.criado_em,
        };
      }),
    });
  });

  /* ---------- Amigos ---------- */
  r.get('/amigos', precisaLogin, async (req, res) => {
    const eu = req.usuario.id;
    const rows = await q(
      `SELECT a.de, a.para, a.aceita, u.id, u.nome, u.avatar, round(u.elo)::int AS elo,
              (SELECT count(*)::int FROM mensagens m WHERE m.de = u.id AND m.para = $1 AND NOT m.lida) AS nao_lidas
       FROM amizades a JOIN usuarios u ON u.id = CASE WHEN a.de = $1 THEN a.para ELSE a.de END
       WHERE a.de = $1 OR a.para = $1 ORDER BY lower(u.nome)`,
      [eu]
    );
    const amigos = [];
    const recebidos = [];
    const enviados = [];
    for (const l of rows) {
      const item = { id: l.id, nome: l.nome, elo: l.elo, avatar: l.avatar, naoLidas: l.nao_lidas };
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
      await conquistasDeAmigos(eu);
      await conquistasDeAmigos(alvo.id);
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
    await conquistasDeAmigos(eu);
    await conquistasDeAmigos(id);
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
      (SELECT count(*)::int FROM partidas) AS partidas_total,
      (SELECT count(*)::int FROM denuncias WHERE estado = 'aberta') AS denuncias_abertas`);
    res.json({ ...n, ...painel() });
  });

  r.get('/admin/usuarios', soAdmin, async (req, res) => {
    const busca = `%${String(req.query.busca || '').trim().toLowerCase()}%`;
    const rows = await q(
      `SELECT u.id, u.nome, u.email, round(u.elo)::int AS elo, u.vitorias, u.derrotas, u.empates,
              u.bot_vitorias, u.bot_derrotas, u.bot_empates, cardinality(u.problemas) AS problemas,
              u.bloqueado, u.chat_bloqueado, u.email_confirmado, u.criado_em, u.ultimo_login,
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

  async function bloquearConta(id, bloquear) {
    await q('UPDATE usuarios SET bloqueado = $2 WHERE id = $1', [id, bloquear]);
    if (bloquear) {
      await q('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
      // denúncias abertas contra essa pessoa ficam resolvidas
      await q("UPDATE denuncias SET estado = 'bloqueado', resolvido_em = now() WHERE denunciado_id = $1 AND estado = 'aberta'", [id]);
      desconectar(id);
    }
  }

  r.post('/admin/bloquear', soAdmin, async (req, res) => {
    const u = await alvoDaAcao(req, res);
    if (!u) return;
    const bloquear = req.body?.bloquear !== false;
    await bloquearConta(u.id, bloquear);
    res.json({ ok: true, texto: bloquear ? `${u.nome} foi bloqueado.` : `${u.nome} foi desbloqueado.` });
  });

  r.get('/admin/denuncias', soAdmin, async (req, res) => {
    const rows = await q(
      `SELECT d.id, d.denunciante_nome, d.denunciado_id, d.denunciado_nome, d.mensagem, d.motivo, d.detalhes,
              d.sala, d.estado, d.criado_em, d.resolvido_em, d.denunciado_ip, u.bloqueado AS ja_bloqueado, u.email AS denunciado_email,
              (SELECT count(*)::int FROM denuncias x WHERE x.denunciado_id = d.denunciado_id AND d.denunciado_id IS NOT NULL) AS total_contra
       FROM denuncias d LEFT JOIN usuarios u ON u.id = d.denunciado_id
       ORDER BY (d.estado = 'aberta') DESC, d.criado_em DESC LIMIT 200`
    );
    res.json(rows.map(({ denunciado_email, ...d }) => ({ ...d, denunciado_admin: ehAdmin(denunciado_email) })));
  });

  // acao: 'bloquear' (bloqueia a conta denunciada) ou 'ignorar' (arquiva a denúncia)
  r.post('/admin/denuncias/resolver', soAdmin, async (req, res) => {
    const id = Number(req.body?.id);
    const acao = req.body?.acao;
    const [d] = await q('SELECT d.*, u.email FROM denuncias d LEFT JOIN usuarios u ON u.id = d.denunciado_id WHERE d.id = $1', [id]);
    if (!d) return res.status(404).json({ erro: 'Denúncia não encontrada.' });
    if (acao === 'ignorar') {
      await q("UPDATE denuncias SET estado = 'ignorada', resolvido_em = now() WHERE id = $1", [id]);
      return res.json({ ok: true, texto: 'Denúncia ignorada.' });
    }
    if (acao === 'banir-ip') {
      if (!d.denunciado_ip) return res.status(400).json({ erro: 'Não temos o IP dessa pessoa.' });
      const r2 = await banirIp(req, d.denunciado_ip, `denúncia #${d.id} (${d.denunciado_nome})`);
      if (r2.erro) return res.status(400).json(r2);
      await q("UPDATE denuncias SET estado = 'bloqueado', resolvido_em = now() WHERE id = $1", [id]);
      return res.json({ ok: true, texto: `IP de ${d.denunciado_nome} banido.` });
    }
    if (acao === 'bloquear') {
      if (!d.denunciado_id) return res.status(400).json({ erro: 'Essa pessoa jogou como convidado (sem conta), então não dá para bloquear. Você pode ignorar a denúncia.' });
      if (d.denunciado_id === req.usuario.id || ehAdmin(d.email)) return res.status(400).json({ erro: 'Não dá para bloquear a conta de administrador.' });
      await bloquearConta(d.denunciado_id, true);
      await q("UPDATE denuncias SET estado = 'bloqueado', resolvido_em = now() WHERE id = $1", [id]);
      return res.json({ ok: true, texto: `${d.denunciado_nome} foi bloqueado.` });
    }
    res.status(400).json({ erro: 'Ação inválida.' });
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

  /* ---------- Admin: silenciar no chat, banir IP, backup ---------- */
  r.post('/admin/silenciar', soAdmin, async (req, res) => {
    const u = await alvoDaAcao(req, res);
    if (!u) return;
    const silenciar = req.body?.silenciar !== false;
    await q('UPDATE usuarios SET chat_bloqueado = $2 WHERE id = $1', [u.id, silenciar]);
    if (silenciar) silenciados.add(u.id);
    else silenciados.delete(u.id);
    avisar(u.id, 'aviso-admin', { texto: silenciar ? '🔇 O administrador proibiu você de usar o chat.' : '🔊 Você pode usar o chat de novo.' });
    res.json({ ok: true, texto: silenciar ? `${u.nome} não pode mais usar o chat.` : `${u.nome} pode usar o chat de novo.` });
  });

  async function banirIp(req, ipBruto, motivo) {
    const ip = normalizarIp(ipBruto);
    if (!ip) return { erro: 'IP inválido.' };
    if (ip === normalizarIp(req.ip)) return { erro: 'Esse é o SEU IP! Não dá para banir a si mesmo.' };
    await q('INSERT INTO ips_banidos (ip, motivo) VALUES ($1, $2) ON CONFLICT (ip) DO UPDATE SET motivo = $2', [ip, String(motivo || '').slice(0, 200)]);
    ipsBanidos.add(ip);
    desconectarIp(ip);
    return { ok: true };
  }

  r.get('/admin/ips', soAdmin, async (req, res) => {
    res.json(await q('SELECT ip, motivo, criado_em FROM ips_banidos ORDER BY criado_em DESC'));
  });
  r.post('/admin/banir-ip', soAdmin, async (req, res) => {
    const r2 = await banirIp(req, req.body?.ip, req.body?.motivo || 'banido pelo admin');
    if (r2.erro) return res.status(400).json(r2);
    res.json({ ok: true, texto: `IP ${normalizarIp(req.body.ip)} banido. A pessoa foi desconectada.` });
  });
  r.post('/admin/desbanir-ip', soAdmin, async (req, res) => {
    const ip = normalizarIp(req.body?.ip);
    await q('DELETE FROM ips_banidos WHERE ip = $1', [ip]);
    ipsBanidos.delete(ip);
    res.json({ ok: true, texto: `IP ${ip} liberado.` });
  });

  // Cópia de segurança de todo o banco (arquivo .json para guardar no computador)
  r.get('/admin/backup', soAdmin, async (req, res) => {
    const tabelas = ['usuarios', 'amizades', 'partidas', 'elo_historico', 'conquistas', 'temporada_premios', 'mensagens',
      'denuncias', 'torneios', 'torneio_jogadores', 'torneio_partidas', 'ips_banidos', 'logins'];
    const dados = { gerado_em: new Date().toISOString(), versao: 1 };
    for (const t of tabelas) dados[t] = await q(`SELECT * FROM ${t}`);
    const data = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="backup-xadrez-${data}.json"`);
    res.json(dados);
  });

  // Erros inesperados (ex.: banco fora do ar)
  r.use((erro, req, res, next) => {
    console.error('Erro na API:', erro.message);
    res.status(500).json({ erro: 'Algo deu errado no servidor. Tente de novo.' });
  });

  return r;
}
