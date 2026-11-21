import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import { prepararBanco } from './db.js';
import { rotasDeContas, lerCookie, usuarioDaSessao, registrarPartida, saoAmigos, registrarDenuncia } from './contas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // o Render fica na frente do servidor (HTTPS)
const server = http.createServer(app);
const io = new Server(server);

// Quanto tempo esperar um jogador que caiu antes de dar a partida como abandonada
const ESPERA_RECONEXAO_MS = 60_000;

// Só estes arquivos ficam públicos (o server.js, db.js e contas.js, por exemplo, não).
const ARQUIVOS_PUBLICOS = ['index.html', 'style.css', 'app.js'];

/* ============================================================
   QUEM ESTÁ ONLINE (para a lista de amigos)
============================================================ */
const abasDoUsuario = new Map(); // usuarioId -> Set(socketId)

function presenca(usuarioId) {
  const online = (abasDoUsuario.get(usuarioId)?.size || 0) > 0;
  let jogando = false;
  for (const sala of salas.values()) {
    if (sala.iniciada && !sala.encerrada &&
        (sala.jogadores.w?.usuarioId === usuarioId || sala.jogadores.b?.usuarioId === usuarioId)) {
      jogando = true;
      break;
    }
  }
  return { online, jogando };
}

const avisar = (usuarioId, evento, dados) => io.to(`u:${usuarioId}`).emit(evento, dados);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
// Para o painel do admin: quem está online e quais salas existem agora
function painel() {
  const listaSalas = [];
  for (const [codigo, sala] of salas) {
    const jog = (c) => sala.jogadores[c] ? { nome: sala.jogadores[c].nome, conta: !!sala.jogadores[c].usuarioId, conectado: sala.jogadores[c].conectado } : null;
    listaSalas.push({
      codigo,
      brancas: jog('w'),
      pretas: jog('b'),
      estado: !sala.iniciada ? 'esperando' : sala.encerrada ? 'terminada' : 'jogando',
      lances: sala.chess.history().length,
      relogio: sala.base ? `${sala.base / 60000} min` : 'sem relógio',
    });
  }
  return { usuarios_online: abasDoUsuario.size, conexoes: io.engine.clientsCount, salas: listaSalas };
}

function desconectar(usuarioId) {
  io.in(`u:${usuarioId}`).disconnectSockets(true);
}

app.use('/api', rotasDeContas({ presenca, avisar, painel, desconectar }));
app.get('/:arquivo', (req, res, next) => {
  if (ARQUIVOS_PUBLICOS.includes(req.params.arquivo)) {
    return res.sendFile(path.join(__dirname, req.params.arquivo));
  }
  next();
});

// Partida terminada: guarda no histórico e atualiza o ranking das contas
function registrarNoRanking(sala, codigo, vencedor, motivo) {
  const { w, b } = sala.jogadores;
  if (!w || !b) return;
  registrarPartida({
    branco: { usuarioId: w.usuarioId, nome: w.nome },
    preto: { usuarioId: b.usuarioId, nome: b.nome },
    vencedor,
    motivo,
    lances: sala.chess.history().length,
    historico: sala.chess.history(),
  })
    .then((mudanca) => {
      if (!mudanca) return;
      // Atualiza o ELO guardado na sala e na conexão de cada um, e avisa os dois
      for (const cor of ['w', 'b']) {
        const j = sala.jogadores[cor];
        if (!j) continue;
        j.elo = mudanca[cor].elo;
        const s = j.socket && io.sockets.sockets.get(j.socket);
        if (s?.data.usuario) s.data.usuario.elo = mudanca[cor].elo;
      }
      io.to(codigo).emit('elo', mudanca);
    })
    .catch((e) => console.error('Erro ao salvar partida:', e.message));
}

/* ============================================================
   SALAS
============================================================ */
// codigo -> {
//   chess, jogadores: { w: {id, nome, socket, conectado, timerSaida} | null, b: ... },
//   iniciada, encerrada, resultado, ofertaDe, revanche: Set,
//   base, incremento, tempo: {w, b}, turnoInicio, timerTempo
// }
const salas = new Map();
let contadorMensagens = 0;

// Fila da partida rápida: [{ socketId, jogador, min, inc, desde }]
const fila = [];
function tirarDaFila(socketId) {
  const i = fila.findIndex((f) => f.socketId === socketId);
  if (i >= 0) fila.splice(i, 1);
}

function relogioValido(minutos, incremento) {
  const min = [0, 1, 3, 5, 10, 15].includes(Number(minutos)) ? Number(minutos) : 0;
  const inc = min && [0, 2, 5, 10].includes(Number(incremento)) ? Number(incremento) : 0;
  return { min, inc };
}

function criarSala(minutos, incremento) {
  const { min, inc } = relogioValido(minutos, incremento);
  const codigo = gerarCodigo();
  const sala = {
    chess: new Chess(),
    jogadores: { w: null, b: null },
    iniciada: false,
    encerrada: false,
    resultado: null,
    ofertaDe: null,
    revanche: new Set(),
    base: min * 60_000,
    incremento: inc * 1000,
    tempo: { w: min * 60_000, b: min * 60_000 },
    turnoInicio: 0,
    timerTempo: null,
  };
  salas.set(codigo, sala);
  return { codigo, sala };
}

function gerarCodigo() {
  let codigo;
  do {
    codigo = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (codigo.length < 4 || salas.has(codigo));
  return codigo;
}

const limparNome = (n) => String(n || '').trim().slice(0, 16) || 'Jogador';
const outra = (cor) => (cor === 'w' ? 'b' : 'w');

// Tempo restante de cada lado agora (descontando o tempo do lance em andamento)
function relogioAgora(sala) {
  const rodando = sala.base > 0 && sala.iniciada && !sala.encerrada;
  const tempo = { ...sala.tempo };
  if (rodando) tempo[sala.chess.turn()] -= Date.now() - sala.turnoInicio;
  return { w: Math.max(0, tempo.w), b: Math.max(0, tempo.b), vez: sala.chess.turn(), rodando, ligado: sala.base > 0 };
}

function infoJogadores(sala) {
  const info = {};
  for (const cor of ['w', 'b']) {
    const j = sala.jogadores[cor];
    info[cor] = j ? { nome: j.nome, conectado: j.conectado, conta: !!j.usuarioId, usuarioId: j.usuarioId, elo: j.elo ?? null } : null;
  }
  return info;
}

// Estado completo, mandado a quem entra/reconecta
function enviarSala(sala, codigo, cor) {
  const j = sala.jogadores[cor];
  if (!j || !j.socket) return;
  io.to(j.socket).emit('sala', {
    codigo,
    cor,
    historico: sala.chess.history(),
    jogadores: infoJogadores(sala),
    relogio: relogioAgora(sala),
    iniciada: sala.iniciada,
    encerrada: sala.encerrada,
    resultado: sala.resultado,
    base: sala.base,
    incremento: sala.incremento,
  });
}

function agendarTempo(sala, codigo) {
  clearTimeout(sala.timerTempo);
  if (!sala.base || !sala.iniciada || sala.encerrada) return;
  const vez = sala.chess.turn();
  const restante = sala.tempo[vez] - (Date.now() - sala.turnoInicio);
  sala.timerTempo = setTimeout(() => {
    if (sala.encerrada) return;
    sala.tempo[vez] = 0;
    finalizar(sala, codigo, { vencedor: outra(vez), motivo: 'tempo' });
  }, Math.max(0, restante) + 50);
}

function finalizar(sala, codigo, resultado) {
  if (sala.encerrada) return;
  // congela o relógio de quem estava jogando
  if (sala.base && sala.iniciada) {
    const vez = sala.chess.turn();
    sala.tempo[vez] = Math.max(0, sala.tempo[vez] - (Date.now() - sala.turnoInicio));
  }
  sala.encerrada = true;
  sala.resultado = resultado;
  sala.ofertaDe = null;
  sala.revanche = new Set();
  clearTimeout(sala.timerTempo);
  registrarNoRanking(sala, codigo, resultado.vencedor, resultado.motivo);
  io.to(codigo).emit('fim', { ...resultado, relogio: relogioAgora(sala), jogadores: infoJogadores(sala) });
}

function resultadoDoTabuleiro(chess) {
  if (chess.isCheckmate()) return { vencedor: outra(chess.turn()), motivo: 'mate' };
  if (chess.isStalemate()) return { vencedor: null, motivo: 'afogamento' };
  if (chess.isThreefoldRepetition()) return { vencedor: null, motivo: 'repeticao' };
  if (chess.isInsufficientMaterial()) return { vencedor: null, motivo: 'material' };
  return { vencedor: null, motivo: 'empate' };
}

function comecarPartida(sala, codigo) {
  sala.chess = new Chess();
  sala.iniciada = true;
  sala.encerrada = false;
  sala.resultado = null;
  sala.ofertaDe = null;
  sala.revanche = new Set();
  sala.tempo = { w: sala.base, b: sala.base };
  sala.turnoInicio = Date.now();
  agendarTempo(sala, codigo);
}

function apagarSala(codigo) {
  const sala = salas.get(codigo);
  if (!sala) return;
  clearTimeout(sala.timerTempo);
  for (const cor of ['w', 'b']) clearTimeout(sala.jogadores[cor]?.timerSaida);
  salas.delete(codigo);
}

// Jogador saiu (de propósito ou caiu). "imediato" = clicou em Menu.
function jogadorSaiu(socket, imediato) {
  const codigo = socket.data.sala;
  const sala = salas.get(codigo);
  const cor = socket.data.cor;
  socket.data.sala = null;
  if (!sala || !cor) return;
  const j = sala.jogadores[cor];
  if (!j || j.socket !== socket.id) return; // já reconectou por outra aba
  socket.leave(codigo);
  j.conectado = false;
  j.socket = null;

  const desistir = () => {
    if (sala.iniciada && !sala.encerrada) {
      finalizar(sala, codigo, { vencedor: outra(cor), motivo: 'abandono' });
    }
    io.to(codigo).emit('oponente-saiu');
    sala.jogadores[cor] = null;
    if (!sala.jogadores[outra(cor)]?.conectado) apagarSala(codigo);
  };

  if (imediato) return desistir();

  io.to(codigo).emit('oponente-desconectou', { segundos: ESPERA_RECONEXAO_MS / 1000 });
  clearTimeout(j.timerSaida);
  j.timerSaida = setTimeout(desistir, ESPERA_RECONEXAO_MS);
}

/* ============================================================
   CONEXÕES
============================================================ */
// Descobre se quem conectou está logado (pelo cookie da sessão)
io.use(async (socket, next) => {
  try {
    socket.data.usuario = await usuarioDaSessao(lerCookie(socket.handshake.headers.cookie));
  } catch {
    socket.data.usuario = null;
  }
  next();
});

io.on('connection', (socket) => {
  let ultimaMsg = 0;
  const usuario = socket.data.usuario;
  if (usuario) {
    socket.join(`u:${usuario.id}`);
    if (!abasDoUsuario.has(usuario.id)) abasDoUsuario.set(usuario.id, new Set());
    abasDoUsuario.get(usuario.id).add(socket.id);
  }

  // sessao = aba do navegador (para reconectar). Logado: usa o nome da conta.
  const novoJogador = (id, sessao, nome) => ({
    id: String(id || socket.id).slice(0, 64),
    usuarioId: usuario?.id || null,
    elo: usuario ? usuario.elo : null,
    sessao: String(sessao || socket.id).slice(0, 64),
    nome: usuario ? usuario.nome : limparNome(nome),
    socket: socket.id,
    conectado: true,
  });

  // Convidar um amigo para a sala em que estou esperando
  socket.on('convidar', async (amigoId) => {
    const sala = salas.get(socket.data.sala);
    if (!usuario || !sala || sala.iniciada) return;
    try {
      if (!(await saoAmigos(usuario.id, Number(amigoId)))) return;
    } catch {
      return;
    }
    avisar(Number(amigoId), 'convite', { de: usuario.nome, codigo: socket.data.sala });
    socket.emit('convite-enviado');
  });

  socket.on('criar-sala', ({ nome, id, sessao, minutos, incremento } = {}) => {
    if (socket.data.sala) jogadorSaiu(socket, true);
    tirarDaFila(socket.id);
    const { codigo, sala } = criarSala(minutos, incremento);
    const cor = Math.random() < 0.5 ? 'w' : 'b';
    sala.jogadores[cor] = novoJogador(id, sessao, nome);
    socket.join(codigo);
    socket.data.sala = codigo;
    socket.data.cor = cor;
    enviarSala(sala, codigo, cor);
  });

  // ⚡ Partida rápida: entra na fila e é juntado com alguém do mesmo relógio (de preferência ELO parecido)
  socket.on('fila-entrar', ({ nome, id, sessao, minutos, incremento } = {}) => {
    if (socket.data.sala) jogadorSaiu(socket, true);
    tirarDaFila(socket.id);
    const { min, inc } = relogioValido(minutos, incremento);
    const eu = novoJogador(id, sessao, nome);
    const candidatos = fila.filter((f) =>
      f.min === min && f.inc === inc &&
      f.jogador.sessao !== eu.sessao &&
      !(eu.usuarioId && f.jogador.usuarioId === eu.usuarioId) &&
      io.sockets.sockets.get(f.socketId));
    if (!candidatos.length) {
      fila.push({ socketId: socket.id, jogador: eu, min, inc, desde: Date.now() });
      return socket.emit('fila-aguardando');
    }
    // Escolhe o ELO mais próximo; sem ELO (convidado), quem está esperando há mais tempo
    const distancia = (f) => (eu.elo != null && f.jogador.elo != null ? Math.abs(eu.elo - f.jogador.elo) : 5000);
    candidatos.sort((a, b) => distancia(a) - distancia(b) || a.desde - b.desde);
    const outro = candidatos[0];
    tirarDaFila(outro.socketId);
    const outroSocket = io.sockets.sockets.get(outro.socketId);
    if (outroSocket.data.sala) jogadorSaiu(outroSocket, true);

    const { codigo, sala } = criarSala(min, inc);
    const minhaCor = Math.random() < 0.5 ? 'w' : 'b';
    sala.jogadores[minhaCor] = eu;
    sala.jogadores[outra(minhaCor)] = { ...outro.jogador, socket: outroSocket.id, conectado: true };
    for (const [s, cor] of [[socket, minhaCor], [outroSocket, outra(minhaCor)]]) {
      s.join(codigo);
      s.data.sala = codigo;
      s.data.cor = cor;
    }
    comecarPartida(sala, codigo);
    enviarSala(sala, codigo, 'w');
    enviarSala(sala, codigo, 'b');
  });

  socket.on('fila-sair', () => tirarDaFila(socket.id));

  // Serve tanto para entrar pela primeira vez quanto para reconectar
  socket.on('entrar-sala', ({ codigo: codigoBruto, nome, id, sessao } = {}) => {
    tirarDaFila(socket.id);
    const codigo = String(codigoBruto || '').trim().toUpperCase();
    const sala = salas.get(codigo);
    if (!sala) return socket.emit('erro-sala', 'Sala não encontrada. Ela pode ter sido encerrada.');
    const minhaSessao = String(sessao || socket.id).slice(0, 64);

    if (socket.data.sala && socket.data.sala !== codigo) jogadorSaiu(socket, true);

    // Reconexão: esta aba já tem um lugar nesta sala
    let cor = ['w', 'b'].find((c) => sala.jogadores[c]?.sessao === minhaSessao);
    if (cor) {
      const j = sala.jogadores[cor];
      if (j.socket && j.socket !== socket.id) io.sockets.sockets.get(j.socket)?.disconnect(true);
      clearTimeout(j.timerSaida);
      j.socket = socket.id;
      j.conectado = true;
      if (nome && !j.usuarioId) j.nome = limparNome(nome);
      socket.join(codigo);
      socket.data.sala = codigo;
      socket.data.cor = cor;
      enviarSala(sala, codigo, cor);
      socket.to(codigo).emit('oponente-voltou', { jogadores: infoJogadores(sala) });
      return;
    }

    if (sala.iniciada) return socket.emit('erro-sala', 'Essa partida já começou.');
    cor = !sala.jogadores.w ? 'w' : !sala.jogadores.b ? 'b' : null;
    if (!cor) return socket.emit('erro-sala', 'Essa sala já está cheia.');
    sala.jogadores[cor] = novoJogador(id, sessao, nome);
    socket.join(codigo);
    socket.data.sala = codigo;
    socket.data.cor = cor;
    if (!sala.iniciada && sala.jogadores.w && sala.jogadores.b) comecarPartida(sala, codigo);
    enviarSala(sala, codigo, 'w');
    enviarSala(sala, codigo, 'b');
  });

  socket.on('jogada', ({ from, to, promotion } = {}) => {
    const codigo = socket.data.sala;
    const sala = salas.get(codigo);
    if (!sala || !sala.iniciada || sala.encerrada) return;
    const cor = socket.data.cor;

    let jogada = null;
    if (sala.chess.turn() === cor) {
      // Conferir o relógio antes de aceitar o lance
      if (sala.base) {
        const gasto = Date.now() - sala.turnoInicio;
        if (sala.tempo[cor] - gasto <= 0) {
          sala.tempo[cor] = 0;
          return finalizar(sala, codigo, { vencedor: outra(cor), motivo: 'tempo' });
        }
      }
      try {
        jogada = sala.chess.move({ from, to, promotion });
      } catch {
        jogada = null;
      }
      if (jogada && sala.base) {
        sala.tempo[cor] -= Date.now() - sala.turnoInicio;
        sala.tempo[cor] += sala.incremento;
        sala.turnoInicio = Date.now();
      }
    }
    if (jogada) sala.ofertaDe = null;

    io.to(codigo).emit('estado', {
      historico: sala.chess.history(),
      ultima: jogada ? { from: jogada.from, to: jogada.to } : null,
      relogio: relogioAgora(sala),
    });

    if (jogada && sala.chess.isGameOver()) finalizar(sala, codigo, resultadoDoTabuleiro(sala.chess));
    else agendarTempo(sala, codigo);
  });

  function salaEmAndamento() {
    const sala = salas.get(socket.data.sala);
    if (!sala || !sala.iniciada || sala.encerrada) return null;
    return sala;
  }

  socket.on('desistir', () => {
    const sala = salaEmAndamento();
    if (!sala) return;
    finalizar(sala, socket.data.sala, { vencedor: outra(socket.data.cor), motivo: 'desistencia' });
  });

  socket.on('propor-empate', () => {
    const sala = salaEmAndamento();
    if (!sala || sala.ofertaDe) return;
    sala.ofertaDe = socket.data.cor;
    socket.to(socket.data.sala).emit('empate-proposto');
  });

  socket.on('responder-empate', (aceitou) => {
    const sala = salaEmAndamento();
    if (!sala || !sala.ofertaDe || sala.ofertaDe === socket.data.cor) return;
    sala.ofertaDe = null;
    if (aceitou === true) finalizar(sala, socket.data.sala, { vencedor: null, motivo: 'acordo' });
    else socket.to(socket.data.sala).emit('empate-recusado');
  });

  socket.on('revanche', () => {
    const codigo = socket.data.sala;
    const sala = salas.get(codigo);
    if (!sala || !sala.encerrada) return;
    if (!sala.jogadores.w?.conectado || !sala.jogadores.b?.conectado) {
      return socket.emit('erro-sala', 'O oponente não está mais na sala.');
    }
    sala.revanche.add(socket.data.cor);
    if (sala.revanche.size < 2) {
      socket.to(codigo).emit('revanche-pedida');
      return;
    }
    // Os dois aceitaram: troca as cores e recomeça
    [sala.jogadores.w, sala.jogadores.b] = [sala.jogadores.b, sala.jogadores.w];
    for (const cor of ['w', 'b']) {
      const s = io.sockets.sockets.get(sala.jogadores[cor].socket);
      if (s) s.data.cor = cor;
    }
    comecarPartida(sala, codigo);
    enviarSala(sala, codigo, 'w');
    enviarSala(sala, codigo, 'b');
  });

  socket.on('chat', (textoBruto) => {
    const codigo = socket.data.sala;
    const sala = salas.get(codigo);
    if (!sala) return;
    const agora = Date.now();
    if (agora - ultimaMsg < 400) return; // evita spam
    ultimaMsg = agora;
    const texto = String(textoBruto || '').trim().slice(0, 200);
    if (!texto) return;
    const j = sala.jogadores[socket.data.cor];
    // Guarda as últimas mensagens no servidor: a denúncia usa o texto daqui, não o que o navegador mandar
    sala.mensagens = sala.mensagens || [];
    const msg = {
      id: ++contadorMensagens,
      cor: socket.data.cor,
      nome: j?.nome || 'Jogador',
      usuarioId: j?.usuarioId || null,
      texto,
    };
    sala.mensagens.push(msg);
    if (sala.mensagens.length > 100) sala.mensagens.shift();
    io.to(codigo).emit('chat', { id: msg.id, nome: msg.nome, cor: msg.cor, texto });
  });

  // Denunciar uma mensagem do chat
  let denunciasRecentes = [];
  const jaDenunciadas = new Set();
  socket.on('denunciar', async ({ id, motivo, detalhes } = {}, responder) => {
    const ok = (texto, erro = false) => typeof responder === 'function' && responder({ erro, texto });
    const sala = salas.get(socket.data.sala);
    const msg = sala?.mensagens?.find((m) => m.id === Number(id));
    if (!msg) return ok('Não encontrei essa mensagem.', true);
    if (msg.cor === socket.data.cor) return ok('Você não pode denunciar a própria mensagem.', true);
    if (jaDenunciadas.has(msg.id)) return ok('Você já denunciou essa mensagem.', true);
    const agora = Date.now();
    denunciasRecentes = denunciasRecentes.filter((t) => agora - t < 10 * 60_000);
    if (denunciasRecentes.length >= 10) return ok('Muitas denúncias seguidas. Espere um pouco.', true);
    const eu = sala.jogadores[socket.data.cor];
    try {
      await registrarDenuncia({
        denuncianteId: eu?.usuarioId || null,
        denuncianteNome: eu?.nome || 'Jogador',
        denunciadoId: msg.usuarioId,
        denunciadoNome: msg.nome,
        mensagem: msg.texto,
        motivo,
        detalhes,
        sala: socket.data.sala,
      });
    } catch (e) {
      console.error('Erro ao salvar denúncia:', e.message);
      return ok('Não consegui enviar a denúncia agora. Tente de novo.', true);
    }
    jaDenunciadas.add(msg.id);
    denunciasRecentes.push(agora);
    // Avisa os administradores que estiverem online
    for (const s of io.sockets.sockets.values()) {
      if (s.data.usuario?.admin) s.emit('nova-denuncia', { de: eu?.nome, contra: msg.nome });
    }
    ok('Denúncia enviada. Obrigado! O administrador vai analisar. 🚩');
  });

  socket.on('sair-sala', () => {
    tirarDaFila(socket.id);
    jogadorSaiu(socket, true);
  });
  socket.on('disconnect', () => {
    tirarDaFila(socket.id);
    jogadorSaiu(socket, false);
    if (usuario) {
      const abas = abasDoUsuario.get(usuario.id);
      abas?.delete(socket.id);
      if (abas && !abas.size) abasDoUsuario.delete(usuario.id);
    }
  });
});

const PORTA = process.env.PORT || 3000;
try {
  await prepararBanco();
} catch (e) {
  console.error('Não consegui preparar o banco de dados:', e.message);
}
server.listen(PORTA, () => {
  console.log(`Xadrez rodando em http://localhost:${PORTA}`);
});
