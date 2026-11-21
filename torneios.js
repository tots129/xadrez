// Torneios eliminatórios ("mata-mata"): o admin cria, os jogadores se inscrevem,
// e o servidor monta as partidas de cada rodada sozinho até sobrar um campeão.
import express from 'express';
import { q, bancoAtivo } from './db.js';
import { lerCookie, usuarioDaSessao, ehAdmin, darConquista } from './contas.js';

const ESPERA_JOGADOR_MS = 3 * 60_000; // quem não aparecer em 3 minutos perde por W.O.

export function iniciarTorneios({ io, salas, criarSala, apagarSala, avisar }) {
  const avisarTodos = (id) => io.emit('torneios-mudou', { id });
  const timers = new Map(); // partidaId -> timer de W.O.

  /* ---------- Montar e andar com o chaveamento ---------- */
  async function abrirPartida(p, torneio) {
    const { codigo, sala } = criarSala(torneio.minutos, torneio.incremento);
    sala.reservado = { w: p.branco_id, b: p.preto_id };
    sala.torneio = { torneioId: torneio.id, partidaId: p.id, nome: torneio.nome, rodada: p.rodada };
    await q("UPDATE torneio_partidas SET sala = $2, estado = 'jogando' WHERE id = $1", [p.id, codigo]);
    for (const [id, oponente] of [[p.branco_id, p.preto_nome], [p.preto_id, p.branco_nome]]) {
      avisar(id, 'torneio-partida', { torneio: torneio.nome, codigo, oponente });
    }
    // Ninguém (ou só um) apareceu: W.O.
    clearTimeout(timers.get(p.id));
    timers.set(p.id, setTimeout(async () => {
      const s = salas.get(codigo);
      if (s && s.iniciada) return;
      const presente = s ? ['w', 'b'].find((c) => s.jogadores[c]) : null;
      const vencedor = presente || 'w';
      if (s) {
        io.to(codigo).emit('erro-sala', 'O oponente não apareceu. Vitória por W.O.!');
        apagarSala(codigo);
      }
      await registrarResultado(p.id, vencedor, presente ? 'W.O. (oponente não apareceu)' : 'W.O. (ninguém apareceu)');
    }, ESPERA_JOGADOR_MS));
    avisarTodos(torneio.id);
  }

  async function registrarResultado(partidaId, vencedorCor, motivo) {
    clearTimeout(timers.get(partidaId));
    timers.delete(partidaId);
    const [p] = await q("SELECT * FROM torneio_partidas WHERE id = $1 AND estado <> 'terminada'", [partidaId]);
    if (!p) return;
    const vencedorId = vencedorCor === 'w' ? p.branco_id : p.preto_id;
    const vencedorNome = vencedorCor === 'w' ? p.branco_nome : p.preto_nome;
    await q("UPDATE torneio_partidas SET vencedor_id = $2, vencedor_nome = $3, motivo = $4, estado = 'terminada' WHERE id = $1",
      [partidaId, vencedorId, vencedorNome, motivo]);
    await avancar(p.torneio_id);
  }

  // Cria as partidas da próxima rodada quando as duas de baixo terminaram
  async function avancar(torneioId) {
    const [t] = await q('SELECT * FROM torneios WHERE id = $1', [torneioId]);
    if (!t || t.estado !== 'andamento') return;
    const partidas = await q('SELECT * FROM torneio_partidas WHERE torneio_id = $1 ORDER BY rodada, posicao', [torneioId]);
    const primeiraRodada = partidas.filter((p) => p.rodada === 1).length;
    const totalRodadas = Math.round(Math.log2(primeiraRodada * 2));
    const final = partidas.find((p) => p.rodada === totalRodadas);
    if (final?.estado === 'terminada') {
      await q("UPDATE torneios SET estado = 'terminado', vencedor_id = $2, vencedor_nome = $3 WHERE id = $1", [t.id, final.vencedor_id, final.vencedor_nome]);
      await darConquista(final.vencedor_id, 'torneio');
      io.emit('torneio-campeao', { torneio: t.nome, nome: final.vencedor_nome });
      return avisarTodos(t.id);
    }
    for (let r = 1; r < totalRodadas; r++) {
      const daRodada = partidas.filter((p) => p.rodada === r);
      for (let i = 0; i < daRodada.length; i += 2) {
        const [a, b] = [daRodada[i], daRodada[i + 1]];
        const posicao = i / 2;
        if (partidas.some((p) => p.rodada === r + 1 && p.posicao === posicao)) continue;
        if (a?.estado !== 'terminada' || b?.estado !== 'terminada') continue;
        // Cores sorteadas
        const [w, bl] = Math.random() < 0.5 ? [a, b] : [b, a];
        const [nova] = await q(
          `INSERT INTO torneio_partidas (torneio_id, rodada, posicao, branco_id, branco_nome, preto_id, preto_nome)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING *`,
          [t.id, r + 1, posicao, w.vencedor_id, w.vencedor_nome, bl.vencedor_id, bl.vencedor_nome]
        );
        if (nova) await abrirPartida(nova, t);
      }
    }
    avisarTodos(t.id);
  }

  async function comecar(t) {
    const jogadores = await q('SELECT usuario_id, nome FROM torneio_jogadores WHERE torneio_id = $1', [t.id]);
    // Sorteia a ordem e completa com "folgas" até uma potência de 2
    for (let i = jogadores.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jogadores[i], jogadores[j]] = [jogadores[j], jogadores[i]];
    }
    let tamanho = 2;
    while (tamanho < jogadores.length) tamanho *= 2;
    await q("UPDATE torneios SET estado = 'andamento' WHERE id = $1", [t.id]);
    const abrir = [];
    for (let i = 0; i < tamanho / 2; i++) {
      const a = jogadores[i];
      const b = jogadores[tamanho - 1 - i]; // pode ser "folga" (ninguém)
      const [w, bl] = Math.random() < 0.5 ? [a, b] : [b, a];
      const [p] = await q(
        `INSERT INTO torneio_partidas (torneio_id, rodada, posicao, branco_id, branco_nome, preto_id, preto_nome)
         VALUES ($1, 1, $2, $3, $4, $5, $6) RETURNING *`,
        [t.id, i, w?.usuario_id ?? null, w?.nome ?? null, bl?.usuario_id ?? null, bl?.nome ?? null]
      );
      if (!w || !bl) {
        const quem = w || bl;
        await q("UPDATE torneio_partidas SET vencedor_id = $2, vencedor_nome = $3, motivo = 'folga (passou direto)', estado = 'terminada' WHERE id = $1",
          [p.id, quem.usuario_id, quem.nome]);
      } else abrir.push(p);
    }
    for (const p of abrir) await abrirPartida(p, { ...t, estado: 'andamento' });
    await avancar(t.id);
  }

  // Servidor reiniciou no meio de um torneio: reabre as partidas que estavam em andamento
  async function retomar() {
    if (!bancoAtivo()) return;
    const pendentes = await q(
      `SELECT p.*, t.nome AS t_nome, t.minutos, t.incremento FROM torneio_partidas p JOIN torneios t ON t.id = p.torneio_id
       WHERE p.estado = 'jogando' AND t.estado = 'andamento'`
    );
    for (const p of pendentes) {
      if (p.sala && salas.has(p.sala)) continue;
      await abrirPartida(p, { id: p.torneio_id, nome: p.t_nome, minutos: p.minutos, incremento: p.incremento });
    }
  }

  /* ---------- Chamado pelo servidor do jogo ---------- */
  // Quem pode sentar numa sala de torneio: só os dois jogadores sorteados
  function corReservada(sala, usuarioId) {
    if (!sala.reservado) return undefined;
    return ['w', 'b'].find((c) => sala.reservado[c] === usuarioId && !sala.jogadores[c]) || null;
  }
  function aoTerminar(sala, vencedor, motivo) {
    if (!sala.torneio) return;
    // Empate no mata-mata: quem jogou de pretas avança
    const cor = vencedor || 'b';
    const texto = vencedor ? motivo : `${motivo} — empate: pretas avançam`;
    registrarResultado(sala.torneio.partidaId, cor, texto).catch((e) => console.error('Erro no torneio:', e.message));
  }

  /* ---------- Rotas ---------- */
  const r = express.Router();
  r.use(express.json({ limit: '10kb' }));
  for (const metodo of ['get', 'post']) {
    const original = r[metodo].bind(r);
    r[metodo] = (caminho, ...fns) => original(caminho, ...fns.map((f) => (req, res, next) => Promise.resolve(f(req, res, next)).catch(next)));
  }
  r.use(async (req, res, next) => {
    if (!bancoAtivo()) return res.status(503).json({ erro: 'Torneios precisam do banco de dados.' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ erro: 'Formato inválido.' });
    req.usuario = await usuarioDaSessao(lerCookie(req.headers.cookie));
    if (req.usuario) req.usuario.admin = ehAdmin(req.usuario.email);
    next();
  });
  const precisaLogin = (req, res, next) => (req.usuario ? next() : res.status(401).json({ erro: 'Entre na sua conta para participar de torneios.' }));
  const soAdmin = (req, res, next) => (req.usuario?.admin ? next() : res.status(403).json({ erro: 'Só o administrador pode fazer isso.' }));

  r.get('/', async (req, res) => {
    res.json(await q(
      `SELECT t.id, t.nome, t.minutos, t.incremento, t.maximo, t.estado, t.vencedor_nome, t.criado_em,
              (SELECT count(*)::int FROM torneio_jogadores j WHERE j.torneio_id = t.id) AS inscritos,
              EXISTS (SELECT 1 FROM torneio_jogadores j WHERE j.torneio_id = t.id AND j.usuario_id = $1) AS inscrito
       FROM torneios t ORDER BY (t.estado = 'terminado'), t.criado_em DESC LIMIT 30`,
      [req.usuario?.id || 0]
    ));
  });

  r.get('/:id', async (req, res) => {
    const id = Number(req.params.id) || 0;
    const [t] = await q('SELECT * FROM torneios WHERE id = $1', [id]);
    if (!t) return res.status(404).json({ erro: 'Torneio não encontrado.' });
    const [jogadores, partidas] = await Promise.all([
      q('SELECT usuario_id, nome FROM torneio_jogadores WHERE torneio_id = $1 ORDER BY nome', [id]),
      q('SELECT * FROM torneio_partidas WHERE torneio_id = $1 ORDER BY rodada, posicao', [id]),
    ]);
    res.json({ ...t, jogadores, partidas, euId: req.usuario?.id || null, admin: !!req.usuario?.admin });
  });

  r.post('/', soAdmin, async (req, res) => {
    const nome = String(req.body?.nome || '').trim().slice(0, 60) || 'Torneio';
    const minutos = [1, 3, 5, 10, 15].includes(Number(req.body?.minutos)) ? Number(req.body.minutos) : 5;
    const incremento = [0, 2, 5, 10].includes(Number(req.body?.incremento)) ? Number(req.body.incremento) : 0;
    const maximo = [4, 8, 16, 32].includes(Number(req.body?.maximo)) ? Number(req.body.maximo) : 8;
    const [t] = await q('INSERT INTO torneios (nome, minutos, incremento, maximo) VALUES ($1, $2, $3, $4) RETURNING id', [nome, minutos, incremento, maximo]);
    io.emit('torneio-novo', { nome });
    avisarTodos(t.id);
    res.json({ ok: true, id: t.id, texto: `Torneio "${nome}" criado! As inscrições estão abertas.` });
  });

  r.post('/:id/entrar', precisaLogin, async (req, res) => {
    const id = Number(req.params.id) || 0;
    const [t] = await q(`SELECT t.*, (SELECT count(*)::int FROM torneio_jogadores j WHERE j.torneio_id = t.id) AS inscritos FROM torneios t WHERE id = $1`, [id]);
    if (!t || t.estado !== 'inscricoes') return res.status(400).json({ erro: 'As inscrições deste torneio estão fechadas.' });
    if (t.inscritos >= t.maximo) return res.status(400).json({ erro: 'O torneio está cheio.' });
    await q('INSERT INTO torneio_jogadores (torneio_id, usuario_id, nome) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, req.usuario.id, req.usuario.nome]);
    avisarTodos(id);
    res.json({ ok: true, texto: `Você está inscrito em "${t.nome}"! Fique online quando o torneio começar.` });
  });

  r.post('/:id/sair', precisaLogin, async (req, res) => {
    const id = Number(req.params.id) || 0;
    const [t] = await q('SELECT estado FROM torneios WHERE id = $1', [id]);
    if (!t || t.estado !== 'inscricoes') return res.status(400).json({ erro: 'Não dá para sair depois que o torneio começou.' });
    await q('DELETE FROM torneio_jogadores WHERE torneio_id = $1 AND usuario_id = $2', [id, req.usuario.id]);
    avisarTodos(id);
    res.json({ ok: true, texto: 'Inscrição cancelada.' });
  });

  r.post('/:id/comecar', soAdmin, async (req, res) => {
    const id = Number(req.params.id) || 0;
    const [t] = await q(`SELECT t.*, (SELECT count(*)::int FROM torneio_jogadores j WHERE j.torneio_id = t.id) AS inscritos FROM torneios t WHERE id = $1`, [id]);
    if (!t || t.estado !== 'inscricoes') return res.status(400).json({ erro: 'Esse torneio já começou ou terminou.' });
    if (t.inscritos < 2) return res.status(400).json({ erro: 'Precisa de pelo menos 2 inscritos.' });
    await comecar(t);
    res.json({ ok: true, texto: `"${t.nome}" começou! Os jogadores foram avisados.` });
  });

  r.post('/:id/cancelar', soAdmin, async (req, res) => {
    const id = Number(req.params.id) || 0;
    const partidas = await q("SELECT id, sala FROM torneio_partidas WHERE torneio_id = $1 AND estado = 'jogando'", [id]);
    for (const p of partidas) {
      clearTimeout(timers.get(p.id));
      if (p.sala && salas.has(p.sala)) {
        io.to(p.sala).emit('erro-sala', 'O torneio foi cancelado pelo administrador.');
        apagarSala(p.sala);
      }
    }
    await q('DELETE FROM torneios WHERE id = $1', [id]);
    avisarTodos(id);
    res.json({ ok: true, texto: 'Torneio cancelado.' });
  });

  r.use((erro, req, res, next) => {
    console.error('Erro nos torneios:', erro.message);
    res.status(500).json({ erro: 'Algo deu errado no servidor. Tente de novo.' });
  });

  return { rotas: r, corReservada, aoTerminar, retomar, _teste: { comecar, registrarResultado } };
}
