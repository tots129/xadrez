import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { PROBLEMAS } from './problemas.js';
import { AULAS } from './aulas.js';

/* ============================================================
   CONFIGURAÇÕES (mude aqui se quiser)
============================================================ */
const ATRASO_BOT_MS = 2000;   // tempo que o bot "pensa" antes de jogar (sem relógio)
const ATRASO_BOT_RELOGIO_MS = 600; // com relógio o bot joga mais rápido
const ANIMACAO_MS = 300;      // duração da animação das peças
const GIRO_MS = 700;          // duração do giro do tabuleiro
const PAUSA_GIRO_MS = 400;    // pausa entre a jogada e o giro (modo local)
const DICA_MS = 3500;         // quanto tempo a dica fica marcada

/* ============================================================
   PEÇAS (desenho próprio em SVG)
============================================================ */
const BASE_SVG = '<rect x="11" y="34" width="23" height="5.5" rx="2.5"/>';
const PECAS_SVG = {
  p: {
    forma: '<circle cx="22.5" cy="13.5" r="5.3"/><rect x="20" y="16" width="5" height="7"/>' +
           '<ellipse cx="22.5" cy="21.8" rx="7" ry="2.4"/>' +
           '<path d="M16.5 36 C16.5 29 20 26.5 20.2 22 H24.8 C25 26.5 28.5 29 28.5 36 Z"/>',
    detalhe: '',
  },
  r: {
    forma: '<path d="M12.5 10.5 H16.7 V14 H20.5 V10.5 H24.5 V14 H28.3 V10.5 H32.5 V19.5 H12.5 Z"/>' +
           '<path d="M15.5 19 H29.5 L28 32 H17 Z"/><rect x="12" y="31.5" width="21" height="4" rx="1.5"/>',
    detalhe: '<path class="d" d="M12.5 19.5 H32.5 M15 31.5 H30"/>',
  },
  n: {
    forma: '<path d="M13.5 36 C13 30 14.5 27 18 24.5 C15.5 25 12.5 24.5 11.5 22.5 C10.8 21 11.5 19.8 12.5 19 L18 11.5 L18.5 7.5 L22 10.3 C29 10 34 15.5 33.5 24 C33.2 28 32 32 32 36 Z"/>',
    detalhe: '<circle class="dot" cx="19.6" cy="14.6" r="1.2"/><circle class="dot" cx="12.9" cy="21" r="0.8"/>' +
             '<path class="d" d="M24 12.5 C28 15 29 20 28.5 26"/>',
  },
  b: {
    forma: '<circle cx="22.5" cy="8" r="2.5"/>' +
           '<path d="M22.5 9.5 C28.5 14 30 19 27.5 23.5 C26.5 25.2 25.5 26 25.5 27.5 H19.5 C19.5 26 18.5 25.2 17.5 23.5 C15 19 16.5 14 22.5 9.5 Z"/>' +
           '<rect x="15.5" y="26.5" width="14" height="3.6" rx="1.8"/>' +
           '<path d="M18.5 30 H26.5 C27 32 28.5 34 29 36 H16 C16.5 34 18 32 18.5 30 Z"/>',
    detalhe: '<path class="d" d="M21 20.5 L25.5 15"/>',
  },
  q: {
    forma: '<path d="M12.5 15 L15 27 L17.5 12.5 L20 24.5 L22.5 11.5 L25 24.5 L27.5 12.5 L30 27 L32.5 15 L30.5 34 H14.5 Z"/>' +
           '<circle cx="12.5" cy="13" r="2.1"/><circle cx="17.5" cy="10.5" r="2.1"/><circle cx="22.5" cy="9.5" r="2.1"/>' +
           '<circle cx="27.5" cy="10.5" r="2.1"/><circle cx="32.5" cy="13" r="2.1"/>',
    detalhe: '<path class="d" d="M15.2 31 H29.8"/>',
  },
  k: {
    forma: '<path d="M21 3 H24 V5.8 H26.8 V8.6 H24 V11.5 H21 V8.6 H18.2 V5.8 H21 Z"/>' +
           '<path d="M22.5 11 C32 11 35 18 33 25 C32 28 31 31 31 34.5 H14 C14 31 13 28 12 25 C10 18 13 11 22.5 11 Z"/>',
    detalhe: '<path class="d" d="M14.5 30.5 H30.5 M22.5 14 V22"/>',
  },
};

function svgPeca(tipo) {
  const { forma, detalhe } = PECAS_SVG[tipo];
  return `<svg class="pc" viewBox="0 0 45 45" aria-hidden="true">` +
    `<g class="contorno">${forma}${BASE_SVG}</g><g class="miolo">${forma}${BASE_SVG}</g>` +
    `<g class="detalhe">${detalhe}</g></svg>`;
}

/* ============================================================
   PROBLEMAS DE XADREZ (todos conferidos com o motor)
============================================================ */
// A lista fica em problemas.js (são muitos)

/* ============================================================
   ESTADO
============================================================ */
const INICIAL = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PONTOS = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const COLUNAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const NOMES_NIVEL = { 1: 'nível 1', 2: 'nível 2', 3: 'nível 3', 4: 'nível 4', 5: 'nível 5', 6: 'nível 6', 7: 'nível 7', 8: 'nível 8', 9: 'nível 9', 10: 'nível 10' };
const NOMES_PECA = { q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo' };
const $ = (id) => document.getElementById(id);

// localStorage pode falhar (aba anônima etc.), então tudo passa por aqui
const guardar = {
  ler(chave, padrao) {
    try { const v = localStorage.getItem(chave); return v === null ? padrao : JSON.parse(v); } catch { return padrao; }
  },
  salvar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem armazenamento */ }
  },
};

let meuId = guardar.ler('xadrez-id', null);
if (!meuId) {
  meuId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  guardar.salvar('xadrez-id', meuId);
}
// Identifica esta aba (sobrevive a recarregar a página). Serve para reconectar à partida
// sem confundir duas abas abertas no mesmo navegador.
let minhaSessao = null;
try { minhaSessao = sessionStorage.getItem('xadrez-sessao'); } catch { /* ok */ }
if (!minhaSessao) {
  minhaSessao = Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { sessionStorage.setItem('xadrez-sessao', minhaSessao); } catch { /* ok */ }
}

let jogo = new Chess();
let modo = null;          // 'bot' | 'local' | 'online' | 'problema'
let minhaCor = 'w';
let orientacao = 'w';
let selecionada = null;
let destinos = [];
let ultima = null;
let dica = null;          // { from, to } marcada no tabuleiro
let ativo = false;
let pensando = false;
let escolhendoPromocao = false;
let empateEnviado = false;
let girando = false;
let autoGiro = true;
let partidaId = 0;
let nivel = 2;
let socket = null;
let fimExtra = null;      // fim que não vem do tabuleiro (tempo, desistência...)

// Relógio. Bot/local: controlado aqui. Online: o servidor manda os valores.
let relogio = { ligado: false, w: 0, b: 0, inc: 0, vez: 'w', desde: 0, rodando: false };

// Online
let salaAtual = null;
let nomesOnline = { w: null, b: null };
let revancheEnviada = false;

// Problemas
let problemaAtual = 0;
let lancesRestantes = 0;
let resolvidos = new Set(guardar.ler('xadrez-resolvidos', []));

/* ============================================================
   SONS (gerados na hora, sem arquivos)
============================================================ */
let somLigado = guardar.ler('xadrez-som', true);
let audio = null;

function bip(freq, dur, tipo = 'sine', vol = 0.2, atraso = 0) {
  if (!somLigado) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime + atraso;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(audio.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch { /* navegador sem áudio */ }
}

const SONS = {
  lance: () => { bip(330, 0.08, 'triangle', 0.3); bip(220, 0.06, 'sine', 0.15, 0.02); },
  captura: () => { bip(260, 0.07, 'square', 0.12); bip(160, 0.12, 'triangle', 0.3, 0.04); },
  xeque: () => { bip(880, 0.12, 'sine', 0.2); bip(660, 0.15, 'sine', 0.18, 0.1); },
  inicio: () => { bip(523, 0.1, 'sine', 0.15); bip(784, 0.15, 'sine', 0.15, 0.1); },
  vitoria: () => [523, 659, 784, 1047].forEach((f, i) => bip(f, 0.25, 'triangle', 0.2, i * 0.12)),
  derrota: () => [392, 330, 262].forEach((f, i) => bip(f, 0.3, 'sine', 0.18, i * 0.18)),
  empate: () => { bip(440, 0.2, 'sine', 0.15); bip(440, 0.2, 'sine', 0.15, 0.25); },
  erro: () => bip(150, 0.2, 'sawtooth', 0.08),
  msg: () => bip(1200, 0.06, 'sine', 0.12),
  tic: () => bip(1000, 0.03, 'square', 0.05),
};

function somDoUltimoLance() {
  const h = jogo.history({ verbose: true });
  const m = h[h.length - 1];
  if (!m) return;
  if (jogo.inCheck() && !jogo.isCheckmate()) SONS.xeque();
  else if (m.captured) SONS.captura();
  else SONS.lance();
}

function atualizarBotaoSom() {
  $('btn-som').textContent = somLigado ? '🔊' : '🔇';
  $('btn-som').title = somLigado ? 'Desligar sons' : 'Ligar sons';
}
$('btn-som').onclick = () => {
  somLigado = !somLigado;
  guardar.salvar('xadrez-som', somLigado);
  atualizarBotaoSom();
  SONS.lance();
};

/* ============================================================
   TEMAS DO TABULEIRO
============================================================ */
function aplicarTema(tema) {
  document.body.dataset.tema = tema;
  $('tema').value = tema;
  guardar.salvar('xadrez-tema', tema);
}
$('tema').onchange = () => {
  aplicarTema($('tema').value);
  if (conta) api('/preferencias', { tema: $('tema').value }).catch(() => {});
};

/* ============================================================
   CONFETE
============================================================ */
function confete() {
  const canvas = document.createElement('canvas');
  canvas.className = 'confete';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const W = (canvas.width = innerWidth);
  const H = (canvas.height = innerHeight);
  const cores = ['#ffd76a', '#5fb35a', '#4fa3ff', '#ff6b6b', '#c77dff', '#ffffff'];
  const pedacos = Array.from({ length: 160 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 15 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    cor: cores[Math.floor(Math.random() * cores.length)],
  }));
  const inicio = performance.now();
  function quadro(agora) {
    const t = agora - inicio;
    ctx.clearRect(0, 0, W, H);
    for (const p of pedacos) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 3500);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.cor;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 3500) requestAnimationFrame(quadro);
    else canvas.remove();
  }
  requestAnimationFrame(quadro);
}

/* ============================================================
   APELIDO
============================================================ */
$('apelido').value = guardar.ler('xadrez-nome', '');
$('apelido').oninput = () => guardar.salvar('xadrez-nome', $('apelido').value.trim());
function meuNome() {
  let nome = $('apelido').value.trim();
  if (!nome) {
    nome = 'Jogador' + Math.floor(100 + Math.random() * 900);
    $('apelido').value = nome;
    guardar.salvar('xadrez-nome', nome);
  }
  return nome.slice(0, 16);
}

/* ============================================================
   TELAS E MENU
============================================================ */
function mostrar(tela) {
  $('menu').hidden = tela !== 'menu';
  $('jogo').hidden = tela !== 'jogo';
}

function escolherModo(m) {
  document.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === m));
  $('opcoes-bot').hidden = m !== 'bot';
  $('opcoes-local').hidden = m !== 'local';
  $('opcoes-online').hidden = m !== 'online';
  $('opcoes-problema').hidden = m !== 'problema';
  if (m === 'problema') atualizarProgressoProblemas();
}
document.querySelectorAll('[data-modo]').forEach((botao) => {
  botao.onclick = () => escolherModo(botao.dataset.modo);
});

$('btn-iniciar-bot').onclick = iniciarBot;
$('btn-iniciar-local').onclick = iniciarLocal;
$('btn-iniciar-problema').onclick = () => {
  const filtro = Number($('filtro-problemas').value);
  const ok = (p, i) => !resolvidos.has(i) && (!filtro || p.n === filtro);
  const proximo = PROBLEMAS.findIndex(ok);
  iniciarProblema(proximo === -1 ? 0 : proximo);
};
$('filtro-problemas').onchange = () => atualizarProgressoProblemas();

/* ---------- Problema do dia (o mesmo para todo mundo, muda à meia-noite de Brasília) ---------- */
let problemaDoDia = false; // o problema aberto agora é o do dia?
const hojeBrasil = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
function indiceDoDia(data = hojeBrasil()) {
  let h = 0;
  for (const c of data) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % PROBLEMAS.length;
}
// Sequência de dias: da conta (se logado) ou deste aparelho
function estadoDoDia() {
  const ontem = new Date(Date.now() - 86400000);
  const ontemBr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(ontem);
  const d = conta ? { data: conta.problema_dia_data, seq: conta.problema_dia_seq } : guardar.ler('xadrez-dia', { data: null, seq: 0 });
  const feitoHoje = d.data === hojeBrasil();
  const seq = feitoHoje || d.data === ontemBr ? d.seq : 0;
  return { feitoHoje, seq };
}
function atualizarInfoDoDia() {
  const { feitoHoje, seq } = estadoDoDia();
  const p = PROBLEMAS[indiceDoDia()];
  $('dia-info').textContent = (feitoHoje ? '✅ Resolvido hoje! Volte amanhã' : `Mate em ${p.n} · resolva para manter a sequência`) +
    (seq ? ` · 🔥 ${seq} dia${seq > 1 ? 's' : ''} seguido${seq > 1 ? 's' : ''}` : '');
}
$('btn-problema-dia').onclick = () => {
  iniciarProblema(indiceDoDia());
  problemaDoDia = true;
  $('info').textContent = `📅 Problema do dia (${new Date().toLocaleDateString('pt-BR')}) · mate em ${PROBLEMAS[problemaAtual].n}`;
};
async function registrarProblemaDoDia() {
  if (conta) {
    try { conta = (await api('/progresso/problema-dia', {})).usuario; } catch { /* tenta de novo amanhã */ }
  } else {
    const { feitoHoje, seq } = estadoDoDia();
    if (!feitoHoje) guardar.salvar('xadrez-dia', { data: hojeBrasil(), seq: seq + 1 });
  }
  const { seq } = estadoDoDia();
  if (seq > 1) setTimeout(() => avisar(`🔥 ${seq} dias seguidos resolvendo o problema do dia!`), 800);
}

/* ---------- Aulas ---------- */
function abrirAula(i) {
  const aula = AULAS[i];
  document.querySelectorAll('.aula-btn').forEach((b, j) => b.classList.toggle('ativa', i === j));
  const el = $('aula-conteudo');
  el.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = `${aula.icone} ${aula.titulo}`;
  el.appendChild(h);
  for (const bloco of aula.blocos) {
    if (bloco.texto) {
      const p = document.createElement('p');
      p.textContent = bloco.texto;
      el.appendChild(p);
    } else if (bloco.tabuleiro) {
      const fig = document.createElement('figure');
      const tab = document.createElement('div');
      tab.className = 'tabuleiro-mini aula-tab';
      const { fen, casa, legenda } = bloco.tabuleiro;
      const g = new Chess(fen);
      const pontos = casa ? g.moves({ square: casa, verbose: true }).map((m) => m.to) : [];
      desenharMini(tab, fen, 'w', { pontos, destaque: casa });
      const cap = document.createElement('figcaption');
      cap.textContent = legenda;
      fig.append(tab, cap);
      el.appendChild(fig);
    } else if (bloco.abertura) {
      const b = document.createElement('button');
      b.className = 'abertura-btn';
      b.textContent = `▶ ${bloco.abertura.nome}  ·  ${bloco.abertura.lances.slice(0, 4).join(' ')}…`;
      b.onclick = () => {
        $('aulas').hidden = true;
        abrirReplay({ historico: bloco.abertura.lances, brancas: 'Brancas', pretas: 'Pretas', titulo: `📖 ${bloco.abertura.nome}` });
        irPara(0);
        $('replay-fechar').onclick = () => { $('replay').hidden = true; $('aulas').hidden = false; voltarFecharReplayPadrao(); };
      };
      el.appendChild(b);
    }
  }
  el.scrollTop = 0;
}
function voltarFecharReplayPadrao() {
  $('replay-fechar').onclick = () => {
    rp.analisando = false;
    $('replay').hidden = true;
  };
}
$('btn-aulas').onclick = () => {
  const lista = $('aulas-lista');
  if (!lista.children.length) {
    AULAS.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'aula-btn';
      b.textContent = `${a.icone} ${a.titulo}`;
      b.onclick = () => abrirAula(i);
      lista.appendChild(b);
    });
  }
  $('aulas').hidden = false;
  abrirAula(0);
};
$('aulas-fechar').onclick = () => ($('aulas').hidden = true);
/* ---------- ⚡ Partida rápida ---------- */
let naFila = null;     // o que mandamos ao servidor (para reenviar se a conexão cair)
let filaTimer = null;
$('btn-rapida').onclick = () => {
  const [minutos, incremento] = $('relogio-online').value.split('+').map(Number);
  salaAtual = null;
  naFila = { nome: meuNome(), id: meuId, sessao: minhaSessao, minutos, incremento };
  const s = conectar();
  if (s.connected) s.emit('fila-entrar', naFila);
  $('fila').hidden = false;
  const inicio = Date.now();
  const relogioTexto = minutos ? `⏱ ${minutos} min${incremento ? ` + ${incremento}s` : ''}` : 'sem relógio';
  const atualizar = () => {
    const s2 = Math.floor((Date.now() - inicio) / 1000);
    $('fila-info').textContent = `${relogioTexto} · esperando há ${s2}s` +
      (s2 > 30 ? ' · Dica: chame um amigo pelo link de convite!' : '');
  };
  atualizar();
  clearInterval(filaTimer);
  filaTimer = setInterval(atualizar, 1000);
};
function sairDaFila(avisarServidor = true) {
  if (naFila && avisarServidor && socket) socket.emit('fila-sair');
  naFila = null;
  clearInterval(filaTimer);
  $('fila').hidden = true;
}
$('fila-cancelar').onclick = () => sairDaFila(true);

$('btn-criar').onclick = () => {
  const [minutos, incremento] = $('relogio-online').value.split('+').map(Number);
  salaAtual = null;
  conectar().emit('criar-sala', { nome: meuNome(), id: meuId, sessao: minhaSessao, minutos, incremento });
};
$('btn-entrar').onclick = () => {
  const codigo = $('codigo').value.trim().toUpperCase();
  if (codigo) entrarNaSala(codigo);
};
$('codigo').onkeydown = (e) => { if (e.key === 'Enter') $('btn-entrar').click(); };

$('btn-novo').onclick = () => {
  if (modo === 'bot') iniciarBot();
  else if (modo === 'local') iniciarLocal();
  else if (modo === 'problema') iniciarProblema(problemaAtual);
};
$('btn-proximo').onclick = () => iniciarProblema((problemaAtual + 1) % PROBLEMAS.length);
$('btn-girar').onclick = () => { if (!girando) girarAnimado(); };
$('btn-auto').onclick = () => {
  autoGiro = !autoGiro;
  atualizarBotaoAuto();
  if (autoGiro && !girando) girarParaProximoJogador(0);
};
function atualizarBotaoAuto() {
  $('btn-auto').textContent = `🔄 Giro automático: ${autoGiro ? 'ligado' : 'desligado'}`;
}
$('btn-menu').onclick = voltarAoMenu;
$('btn-desistir').onclick = async () => {
  if (!ativo || jogo.isGameOver()) return;
  const r = await perguntar('Tem certeza que quer desistir?', 'Desistir', 'Continuar jogando');
  if (!r || !ativo) return;
  if (modo === 'online') socket.emit('desistir');
  else if (modo === 'bot') terminar(`Você desistiu. ${nomeDaCor(oposta(minhaCor))} venceram.`, oposta(minhaCor));
};
$('btn-empate').onclick = () => {
  if (modo !== 'online' || !ativo || empateEnviado) return;
  empateEnviado = true;
  socket.emit('propor-empate');
  avisar('Proposta de empate enviada. Aguardando resposta...');
  atualizarBotoes();
};
$('btn-revanche').onclick = () => {
  if (modo !== 'online' || revancheEnviada) return;
  revancheEnviada = true;
  socket.emit('revanche');
  avisar('Pedido de revanche enviado!');
  atualizarBotoes();
};
$('btn-desfazer').onclick = desfazer;
$('btn-dica').onclick = mostrarDica;

$('btn-copiar').onclick = async () => {
  const link = linkDaSala();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'Xadrez', text: 'Bora jogar xadrez comigo!', url: link });
      return;
    }
    await navigator.clipboard.writeText(link);
    avisar('Link copiado! Mande para seu amigo. 📋');
  } catch {
    prompt('Copie o link:', link);
  }
};

function voltarAoMenu() {
  fecharDialogo();
  if (socket) {
    socket.emit('sair-sala');
    // Com conta, a conexão continua aberta para receber convites dos amigos
    if (!conta) {
      socket.disconnect();
      socket = null;
    }
  }
  salaAtual = null;
  amigoParaConvidar = null;
  premove = null;
  sairDaFila(false);
  try { sessionStorage.removeItem('xadrez-sala'); } catch { /* ok */ }
  history.replaceState(null, '', location.pathname);
  partidaId++;
  ativo = false;
  pensando = false;
  girando = false;
  relogio.rodando = false;
  mostrar('menu');
}

function prepararTelaDeJogo() {
  selecionada = null;
  destinos = [];
  ultima = null;
  dica = null;
  pensando = false;
  girando = false;
  empateEnviado = false;
  revancheEnviada = false;
  fimExtra = null;
  ultimoVencedor = undefined;
  premove = null;
  partidaId++;
  $('btn-auto').hidden = modo !== 'local';
  $('btn-girar').hidden = modo === 'problema';
  atualizarBotaoAuto();
  $('info').textContent = '';
  $('elo-mudanca').hidden = true;
  $('convite').hidden = true;
  $('chat').hidden = modo !== 'online';
  mostrar('jogo');
}

function iniciarRelogio(valor) {
  const [min, inc] = String(valor || '0+0').split('+').map(Number);
  relogio = { ligado: min > 0, w: min * 60000, b: min * 60000, inc: (inc || 0) * 1000, vez: 'w', desde: performance.now(), rodando: min > 0 };
}

/* ============================================================
   INICIAR PARTIDAS
============================================================ */
function iniciarLocal() {
  modo = 'local';
  jogo = new Chess();
  orientacao = 'w';
  ativo = true;
  prepararTelaDeJogo();
  iniciarRelogio($('relogio-local').value);
  $('info').textContent = 'Dois jogadores no mesmo aparelho. O tabuleiro gira a cada jogada.';
  SONS.inicio();
  renderizar();
  atualizarStatus();
}

function iniciarBot() {
  modo = 'bot';
  minhaCor = $('cor-bot').value === 'aleatorio' ? (Math.random() < 0.5 ? 'w' : 'b') : $('cor-bot').value;
  nivel = Number($('nivel-bot').value);
  orientacao = minhaCor;
  jogo = new Chess();
  ativo = true;
  prepararTelaDeJogo();
  iniciarRelogio($('relogio-bot').value);
  $('info').textContent = `Você joga de ${minhaCor === 'w' ? 'brancas' : 'pretas'}.`;
  SONS.inicio();
  renderizar();
  atualizarStatus();
  if (jogo.turn() !== minhaCor) jogarBot();
}

function iniciarProblema(i) {
  modo = 'problema';
  problemaAtual = i;
  problemaDoDia = false;
  const p = PROBLEMAS[i];
  jogo = new Chess(p.fen);
  minhaCor = jogo.turn();
  orientacao = minhaCor;
  lancesRestantes = p.n;
  ativo = true;
  prepararTelaDeJogo();
  relogio = { ligado: false, rodando: false };
  $('info').textContent = `Problema ${i + 1} de ${PROBLEMAS.length}: ${p.nome} ${resolvidos.has(i) ? '✅' : ''}`;
  renderizar();
  atualizarStatus();
}

function atualizarProgressoProblemas() {
  $('progresso-problemas').textContent = `${resolvidos.size} de ${PROBLEMAS.length} resolvidos`;
  atualizarInfoDoDia();
  // Grade com todos os problemas (verde = resolvido)
  const filtro = Number($('filtro-problemas').value);
  const grade = $('grade-problemas');
  grade.innerHTML = '';
  PROBLEMAS.forEach((p, i) => {
    if (filtro && p.n !== filtro) return;
    const b = document.createElement('button');
    b.className = 'prob' + (resolvidos.has(i) ? ' feito' : '') + (p.n === 2 ? ' m2' : '');
    b.textContent = i + 1;
    b.title = `${p.nome}${resolvidos.has(i) ? ' ✅' : ''}`;
    b.onclick = () => iniciarProblema(i);
    grade.appendChild(b);
  });
}

/* ============================================================
   TABULEIRO
============================================================ */
function animacoesDoLance(from, to) {
  const lista = [{ from, to }];
  const p = jogo.get(to);
  if (p && p.type === 'k' && Math.abs(COLUNAS.indexOf(from[0]) - COLUNAS.indexOf(to[0])) === 2) {
    const linha = from[1];
    const ladoDoRei = to[0] === 'g';
    lista.push({ from: (ladoDoRei ? 'h' : 'a') + linha, to: (ladoDoRei ? 'f' : 'd') + linha });
  }
  return lista;
}

function renderizar(animacoes = []) {
  const tab = $('tabuleiro');
  const origens = animacoes.map((a) => {
    const el = tab.querySelector(`[data-casa="${a.from}"]`);
    return el ? el.getBoundingClientRect() : null;
  });

  tab.innerHTML = '';
  const linhas = orientacao === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const colunas = orientacao === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const emXeque = jogo.inCheck() ? jogo.turn() : null;

  for (const r of linhas) {
    for (const c of colunas) {
      const casa = COLUNAS[c] + r;
      const div = document.createElement('div');
      div.className = 'casa ' + ((c + r) % 2 === 1 ? 'escura' : 'clara');
      div.dataset.casa = casa;

      const peca = jogo.get(casa);
      if (casa === selecionada) div.classList.add('selecionada');
      if (ultima && (casa === ultima.from || casa === ultima.to)) div.classList.add('ultima');
      if (dica && (casa === dica.from || casa === dica.to)) div.classList.add('dica');
      if (premove && (casa === premove.from || casa === premove.to)) div.classList.add('premove');
      if (peca && peca.type === 'k' && peca.color === emXeque) div.classList.add('xeque');

      const destino = destinos.find((m) => m.to === casa);
      if (destino) {
        div.classList.add('destino');
        if (peca || destino.flags.includes('e')) div.classList.add('captura');
      }

      if (peca) {
        const span = document.createElement('span');
        span.className = 'peca ' + (peca.color === 'w' ? 'branca' : 'preta');
        span.innerHTML = svgPeca(peca.type);
        div.appendChild(span);
      }

      if (c === colunas[0]) div.appendChild(coordenada(String(r), 'rank'));
      if (r === linhas[7]) div.appendChild(coordenada(COLUNAS[c], 'file'));

      tab.appendChild(div);
    }
  }

  animacoes.forEach((a, i) => {
    const de = origens[i];
    const peca = tab.querySelector(`[data-casa="${a.to}"] .peca`);
    if (!de || !peca) return;
    const para = peca.parentElement.getBoundingClientRect();
    peca.style.transition = 'none';
    peca.style.zIndex = '20';
    peca.style.transform = `translate(${de.left - para.left}px, ${de.top - para.top}px)`;
    peca.getBoundingClientRect();
    peca.style.transition = `transform ${ANIMACAO_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1)`;
    peca.style.transform = 'translate(0, 0)';
    setTimeout(() => {
      peca.style.zIndex = '';
      peca.style.transition = '';
      peca.style.transform = '';
    }, ANIMACAO_MS + 50);
  });

  atualizarJogadores();
}

function girarAnimado() {
  const id = partidaId;
  const tab = $('tabuleiro');
  girando = true;
  const opcoes = { duration: GIRO_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' };
  const giro = tab.animate(
    [
      { transform: 'rotate(0deg) scale(1)' },
      { transform: 'rotate(90deg) scale(0.72)', offset: 0.5 },
      { transform: 'rotate(180deg) scale(1)' },
    ],
    opcoes
  );
  tab.querySelectorAll('.peca').forEach((p) =>
    p.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-180deg)' }], opcoes));
  tab.querySelectorAll('.coord').forEach((c) =>
    c.animate([{ opacity: 1 }, { opacity: 0 }], opcoes));

  return new Promise((resolve) => {
    giro.onfinish = () => {
      if (id === partidaId) {
        orientacao = orientacao === 'w' ? 'b' : 'w';
        renderizar();
        girando = false;
      }
      giro.cancel();
      resolve();
    };
  });
}

async function girarParaProximoJogador(pausa) {
  if (modo !== 'local' || !autoGiro || !ativo || jogo.isGameOver() || orientacao === jogo.turn()) return;
  const id = partidaId;
  girando = true;
  await new Promise((r) => setTimeout(r, pausa));
  if (id !== partidaId) return;
  if (!autoGiro) {
    girando = false;
    return;
  }
  await girarAnimado();
}

function coordenada(texto, tipo) {
  const s = document.createElement('span');
  s.className = 'coord ' + tipo;
  s.textContent = texto;
  return s;
}

/* ---------- Ligas de ELO (todo mundo começa com 0, como Iniciante) ---------- */
const LIGAS = [
  { min: 0, nome: 'Iniciante', icone: '🪵' },
  { min: 100, nome: 'Bronze', icone: '🥉' },
  { min: 300, nome: 'Prata', icone: '🥈' },
  { min: 600, nome: 'Ouro', icone: '🥇' },
  { min: 1000, nome: 'Platina', icone: '💠' },
  { min: 1500, nome: 'Diamante', icone: '💎' },
  { min: 2000, nome: 'Mestre', icone: '👑' },
];
const liga = (elo) => [...LIGAS].reverse().find((l) => elo >= l.min) || LIGAS[0];
const eloTexto = (elo) => `${liga(elo).icone} ${elo}`;

const oposta = (cor) => (cor === 'w' ? 'b' : 'w');
const nomeDaCor = (cor) => (cor === 'w' ? 'Brancas' : 'Pretas');

function nomeDoJogador(cor) {
  const eu = $('apelido').value.trim() || 'Você';
  if (modo === 'bot') return cor === minhaCor ? eu : `🤖 Bot (${NOMES_NIVEL[nivel]})`;
  if (modo === 'online') {
    const vazio = jogo.history().length || fimExtra ? 'Saiu da sala' : 'Aguardando...';
    const j = nomesOnline[cor];
    const n = (j?.nome || (cor === minhaCor ? eu : vazio)) + (j && !j.conta ? ' (convidado)' : '');
    const elo = j?.conta && j.elo != null ? ` · ${eloTexto(j.elo)}` : '';
    return (cor === minhaCor ? `${n} (você)` : n) + elo;
  }
  if (modo === 'problema') return cor === minhaCor ? eu : 'Defesa';
  return nomeDaCor(cor);
}

function analisarMaterial() {
  const cont = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const linha of jogo.board()) {
    for (const c of linha) if (c && c.type !== 'k') cont[c.color][c.type]++;
  }
  const res = {};
  for (const cor of ['w', 'b']) {
    const c = cont[cor];
    let promovidas = 0;
    for (const t of ['n', 'b', 'r', 'q']) promovidas += Math.max(0, c[t] - INICIAL[t]);
    const perdidas = [];
    for (const t of ['q', 'r', 'b', 'n']) {
      for (let i = 0; i < Math.max(0, INICIAL[t] - c[t]); i++) perdidas.push(t);
    }
    for (let i = 0; i < Math.max(0, INICIAL.p - c.p - promovidas); i++) perdidas.push('p');
    const pontos = Object.keys(PONTOS).reduce((soma, t) => soma + c[t] * PONTOS[t], 0);
    res[cor] = { perdidas, pontos };
  }
  return res;
}

function emAndamento() {
  return ativo && !jogo.isGameOver();
}

function atualizarBotoes() {
  const online = modo === 'online';
  const terminou = !emAndamento();
  $('btn-novo').hidden = online;
  $('btn-novo').textContent = modo === 'problema' ? '↻ Tentar de novo' : '↻ Novo jogo';
  $('btn-proximo').hidden = modo !== 'problema';
  $('btn-rever').hidden = !(terminou && modo !== 'problema' && jogo.history().length > 0);
  $('btn-desfazer').hidden = online || modo === 'problema';
  $('btn-dica').hidden = online;
  $('btn-dica').disabled = terminou || pensando;
  $('btn-desistir').hidden = !(online || modo === 'bot');
  $('btn-desistir').disabled = terminou;
  $('btn-empate').hidden = !online;
  $('btn-empate').disabled = terminou || empateEnviado;
  const podeRevanche = online && salaAtual && terminou && nomesOnline.w && nomesOnline.b && jogo.history().length + (fimExtra ? 1 : 0) > 0;
  $('btn-revanche').hidden = !podeRevanche;
  $('btn-revanche').disabled = revancheEnviada;
}

function atualizarJogadores() {
  const topo = orientacao === 'w' ? 'b' : 'w';
  const material = analisarMaterial();
  for (const [id, cor] of [['jog-topo', topo], ['jog-base', orientacao]]) {
    const el = $(id);
    const op = oposta(cor);
    el.dataset.cor = cor;
    el.dataset.modo = modo;
    el.dataset.bot = modo === 'bot' && cor !== minhaCor ? '1' : '0';
    el.querySelector('.nome').textContent = nomeDoJogador(cor);
    // No online, clicar no nome de quem tem conta abre o perfil
    const jog = modo === 'online' ? nomesOnline[cor] : null;
    el.querySelector('.nome').classList.toggle('clicavel', !!jog?.conta);
    el.querySelector('.nome').onclick = jog?.conta ? () => abrirPerfilPublico(jog.nome) : null;
    el.classList.toggle('vez', emAndamento() && jogo.turn() === cor);
    el.classList.toggle('offline', modo === 'online' && nomesOnline[cor] && !nomesOnline[cor].conectado);
    el.querySelector('.capturadas').innerHTML = material[op].perdidas
      .map((t) => `<span class="peca mini ${op === 'w' ? 'branca' : 'preta'}">${svgPeca(t)}</span>`)
      .join('');
    const vantagem = material[cor].pontos - material[op].pontos;
    el.querySelector('.vantagem').textContent = vantagem > 0 ? `+${vantagem}` : '';
  }
  desenharRelogios();
  atualizarBotoes();
}

/* ============================================================
   RELÓGIO
============================================================ */
function tempoDe(cor) {
  if (!relogio.ligado) return null;
  let t = relogio[cor];
  if (relogio.rodando && relogio.vez === cor) t -= performance.now() - relogio.desde;
  return Math.max(0, t);
}

function formatarTempo(ms) {
  const s = Math.ceil(ms / 1000);
  if (ms < 10000) return (ms / 1000).toFixed(1);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let ultimoTic = 0;
function desenharRelogios() {
  for (const id of ['jog-topo', 'jog-base']) {
    const el = $(id);
    const span = el.querySelector('.relogio');
    const t = tempoDe(el.dataset.cor);
    span.hidden = t === null;
    if (t === null) continue;
    span.textContent = formatarTempo(t);
    span.classList.toggle('pouco', t < 20000);
    span.classList.toggle('correndo', relogio.rodando && relogio.vez === el.dataset.cor);
  }
}

// Depois de um lance (bot/local): desconta o tempo de quem jogou e passa a vez
function trocarRelogio() {
  if (!relogio.ligado || !relogio.rodando) return;
  const agora = performance.now();
  const quem = relogio.vez;
  relogio[quem] = Math.max(0, relogio[quem] - (agora - relogio.desde)) + relogio.inc;
  relogio.vez = jogo.turn();
  relogio.desde = agora;
}

function pararRelogio() {
  if (!relogio.ligado || !relogio.rodando) return;
  relogio[relogio.vez] = tempoDe(relogio.vez);
  relogio.rodando = false;
}

setInterval(() => {
  if (!relogio.ligado || $('jogo').hidden) return;
  desenharRelogios();
  if (!relogio.rodando || !ativo) return;
  const t = tempoDe(relogio.vez);
  // tique-taque nos últimos 10 segundos de quem está jogando aqui
  const souEu = modo === 'local' || relogio.vez === minhaCor;
  if (souEu && t < 10000 && t > 0 && Math.ceil(t / 1000) !== ultimoTic) {
    ultimoTic = Math.ceil(t / 1000);
    SONS.tic();
  }
  if (t <= 0 && modo !== 'online') {
    const perdeu = relogio.vez;
    terminar(`Tempo esgotado! ${nomeDaCor(oposta(perdeu))} venceram. ⏰`, oposta(perdeu));
  }
}, 100);

/* ---------- Janelas de pergunta e avisos ---------- */
let fecharDialogo = () => {};

function perguntar(texto, textoSim, textoNao) {
  return new Promise((resolve) => {
    fecharDialogo();
    $('dialogo-texto').textContent = texto;
    $('dialogo-sim').textContent = textoSim;
    $('dialogo-nao').textContent = textoNao;
    const fechar = (resposta) => {
      $('dialogo').hidden = true;
      fecharDialogo = () => {};
      resolve(resposta);
    };
    $('dialogo-sim').onclick = () => fechar(true);
    $('dialogo-nao').onclick = () => fechar(false);
    fecharDialogo = () => fechar(null);
    $('dialogo').hidden = false;
  });
}

let temporizadorAviso;
function avisar(texto) {
  const el = $('aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (el.hidden = true), 3500);
}

function minhaVez() {
  return modo === 'local' || jogo.turn() === minhaCor;
}

/* ============================================================
   JOGADAS
============================================================ */
/* ---------- Pré-lance: marcar a próxima jogada enquanto o oponente pensa ---------- */
let premove = null; // { from, to }
const podePremove = () => (modo === 'online' || modo === 'bot') && ativo && !jogo.isGameOver() && jogo.turn() !== minhaCor;

// Lances da minha peça como se fosse a minha vez (para escolher o pré-lance)
function lancesSeFosseMinhaVez(casa) {
  const partes = jogo.fen().split(' ');
  partes[1] = minhaCor;
  partes[3] = '-';
  try {
    return new Chess(partes.join(' ')).moves({ square: casa, verbose: true });
  } catch {
    return [];
  }
}

function cliqueDePremove(casa) {
  if (selecionada && destinos.some((m) => m.to === casa)) {
    premove = { from: selecionada, to: casa };
    selecionada = null;
    destinos = [];
  } else if (jogo.get(casa)?.color === minhaCor && casa !== selecionada) {
    premove = null;
    selecionada = casa;
    destinos = lancesSeFosseMinhaVez(casa);
  } else {
    premove = null;
    selecionada = null;
    destinos = [];
  }
  renderizar();
}

// Chegou a minha vez: se tinha pré-lance e ele é válido, joga na hora
function tentarPremove() {
  if (!premove) return;
  const p = premove;
  premove = null;
  if (!ativo || jogo.isGameOver() || !minhaVez()) return renderizar();
  const valido = jogo.moves({ square: p.from, verbose: true }).find((m) => m.to === p.to);
  if (!valido) return renderizar();
  setTimeout(() => {
    if (ativo && minhaVez() && !jogo.isGameOver()) executar(p.from, p.to, valido.promotion ? 'q' : undefined);
  }, ANIMACAO_MS + 30);
}

async function aoClicar(casa) {
  if (!ativo || girando || escolhendoPromocao || jogo.isGameOver()) return;
  if (!minhaVez() || (pensando && modo === 'bot')) {
    if (podePremove()) cliqueDePremove(casa);
    return;
  }
  if (pensando) return;

  if (selecionada) {
    const alvo = destinos.filter((m) => m.to === casa);
    if (alvo.length) {
      let promocao;
      if (alvo[0].promotion) {
        escolhendoPromocao = true;
        promocao = await pedirPromocao(jogo.turn());
        escolhendoPromocao = false;
      }
      return executar(alvo[0].from, casa, promocao);
    }
  }

  const peca = jogo.get(casa);
  if (peca && peca.color === jogo.turn()) {
    selecionada = casa;
    destinos = jogo.moves({ square: casa, verbose: true });
  } else {
    selecionada = null;
    destinos = [];
  }
  renderizar();
}

/* ---------- Clicar ou ARRASTAR as peças (mouse e dedo) ---------- */
let arraste = null; // { origem, fantasma, x0, y0, moveu }
const casaNoPonto = (x, y) => document.elementFromPoint(x, y)?.closest?.('#tabuleiro .casa')?.dataset.casa || null;

$('tabuleiro').addEventListener('pointerdown', async (e) => {
  if (e.button !== 0) return;
  const casa = e.target.closest('.casa')?.dataset.casa;
  if (!casa) return;
  e.preventDefault();
  await aoClicar(casa);
  // Começa a arrastar se a peça clicada ficou selecionada
  if (selecionada !== casa) return;
  const peca = $('tabuleiro').querySelector(`[data-casa="${casa}"] .peca`);
  if (!peca) return;
  const r = peca.getBoundingClientRect();
  const fantasma = peca.cloneNode(true);
  fantasma.classList.add('fantasma');
  fantasma.style.width = r.width + 'px';
  fantasma.style.height = r.height + 'px';
  fantasma.style.left = e.clientX - r.width / 2 + 'px';
  fantasma.style.top = e.clientY - r.height / 2 + 'px';
  fantasma.hidden = true; // só aparece se o dedo/mouse andar um pouco
  document.body.appendChild(fantasma);
  arraste = { origem: casa, fantasma, x0: e.clientX, y0: e.clientY, moveu: false, peca };
});

window.addEventListener('pointermove', (e) => {
  if (!arraste) return;
  if (!arraste.moveu && Math.hypot(e.clientX - arraste.x0, e.clientY - arraste.y0) > 6) {
    arraste.moveu = true;
    arraste.fantasma.hidden = false;
    arraste.peca.style.opacity = '0.3';
  }
  if (arraste.moveu) {
    const f = arraste.fantasma;
    f.style.left = e.clientX - f.offsetWidth / 2 + 'px';
    f.style.top = e.clientY - f.offsetHeight / 2 + 'px';
  }
});

window.addEventListener('pointerup', (e) => {
  if (!arraste) return;
  const { origem, fantasma, moveu, peca } = arraste;
  arraste = null;
  fantasma.remove();
  peca.style.opacity = '';
  if (!moveu) return; // foi só um clique: a peça continua selecionada
  const destino = casaNoPonto(e.clientX, e.clientY);
  if (destino && destino !== origem && destinos.some((m) => m.to === destino)) aoClicar(destino);
  else renderizar();
});

// Botão direito no tabuleiro cancela o pré-lance
$('tabuleiro').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (premove || (selecionada && !minhaVez())) {
    premove = null;
    selecionada = null;
    destinos = [];
    renderizar();
  }
});

function pedirPromocao(cor) {
  return new Promise((resolve) => {
    const lista = $('promo-opcoes');
    lista.innerHTML = '';
    for (const tipo of ['q', 'r', 'b', 'n']) {
      const b = document.createElement('button');
      b.className = 'promo-btn ' + (cor === 'w' ? 'branca' : 'preta');
      b.title = NOMES_PECA[tipo];
      b.innerHTML = svgPeca(tipo);
      b.onclick = () => {
        $('promocao').hidden = true;
        resolve(tipo);
      };
      lista.appendChild(b);
    }
    $('promocao').hidden = false;
  });
}

function executar(from, to, promotion) {
  const r = jogo.move({ from, to, promotion });
  ultima = { from: r.from, to: r.to };
  selecionada = null;
  destinos = [];
  dica = null;

  if (modo === 'online') socket.emit('jogada', { from, to, promotion });
  else trocarRelogio();

  renderizar(animacoesDoLance(r.from, r.to));
  somDoUltimoLance();

  if (modo === 'problema') return conferirProblema();

  atualizarStatus();
  if (modo === 'bot' && !jogo.isGameOver()) jogarBot();
  if (modo === 'local') girarParaProximoJogador(ANIMACAO_MS + PAUSA_GIRO_MS);
}

function desfazer() {
  if (pensando || girando || modo === 'online' || modo === 'problema' || !ativo) return;
  if (jogo.history().length === 0) return;
  jogo.undo();
  if (modo === 'bot' && jogo.turn() !== minhaCor) jogo.undo();
  ultima = null;
  selecionada = null;
  destinos = [];
  dica = null;
  if (relogio.ligado) {
    relogio.vez = jogo.turn();
    relogio.desde = performance.now();
  }
  renderizar();
  atualizarStatus();
  if (modo === 'bot' && !jogo.isGameOver() && jogo.turn() !== minhaCor) jogarBot();
  if (modo === 'local') girarParaProximoJogador(150);
}

// Fim por motivo de fora do tabuleiro (tempo, desistência). vencedor = 'w' | 'b' | null
function terminar(texto, vencedor) {
  ativo = false;
  pararRelogio();
  fimExtra = texto;
  fecharDialogo();
  atualizarStatus();
  comemorar(vencedor);
}

function comemorar(vencedor) {
  ultimoVencedor = vencedor;
  const euVenci = modo === 'local' ? vencedor !== null : vencedor === minhaCor;
  // Salva o resultado contra o bot na conta
  if (modo === 'bot' && conta) {
    const resultado = vencedor === null ? 'e' : euVenci ? 'v' : 'd';
    api('/progresso/bot', { resultado, nivel }).then((r) => (conta = r.usuario)).catch(() => {});
  }
  if (vencedor === null) SONS.empate();
  else if (euVenci) {
    SONS.vitoria();
    confete();
  } else SONS.derrota();
}

function atualizarStatus() {
  const vez = jogo.turn() === 'w' ? 'brancas' : 'pretas';
  let texto;
  let fim = false;

  if (fimExtra) {
    texto = fimExtra;
    fim = true;
  } else if (jogo.isCheckmate()) {
    const vencedor = oposta(jogo.turn());
    const nomeVencedor = modo === 'online' ? nomesOnline[vencedor]?.nome || 'O oponente' : nomeDoJogador(vencedor);
    if (modo === 'bot' || modo === 'online') texto = vencedor === minhaCor ? 'Xeque-mate! Você venceu! 🏆' : `Xeque-mate! ${nomeVencedor} venceu.`;
    else texto = `Xeque-mate! ${nomeDaCor(vencedor)} venceram. 🏆`;
    fim = true;
  } else if (jogo.isStalemate()) { texto = 'Empate por afogamento.'; fim = true; }
  else if (jogo.isThreefoldRepetition()) { texto = 'Empate por repetição de posição.'; fim = true; }
  else if (jogo.isInsufficientMaterial()) { texto = 'Empate por material insuficiente.'; fim = true; }
  else if (jogo.isDraw()) { texto = 'Empate.'; fim = true; }
  else if (modo === 'problema') {
    texto = `${nomeDaCor(minhaCor)} jogam e dão mate em ${lancesRestantes}.`;
  } else if (modo === 'online' && !ativo) {
    texto = 'Aguardando o oponente entrar...';
  } else if (modo === 'online') {
    texto = jogo.turn() === minhaCor ? 'Sua vez!' + (jogo.inCheck() ? ' Xeque!' : '') : 'Aguardando o oponente...';
  } else {
    texto = `Vez das ${vez}.` + (jogo.inCheck() ? ' Xeque!' : '');
  }

  // Fim de jogo pelo tabuleiro nos modos locais: para o relógio e comemora uma vez
  if (fim && !fimExtra && ativo && modo !== 'online' && modo !== 'problema') {
    ativo = false;
    pararRelogio();
    comemorar(jogo.isCheckmate() ? oposta(jogo.turn()) : null);
  }

  $('status').textContent = texto;
  $('status').className = fim ? 'fim' : '';
  atualizarHistorico();
  atualizarJogadores();
}

function atualizarHistorico() {
  const el = $('historico');
  const lances = jogo.history();
  el.hidden = lances.length === 0 || modo === 'problema';
  let html = '';
  for (let i = 0; i < lances.length; i += 2) {
    html += `<span class="n">${i / 2 + 1}.</span><span class="l">${lances[i]}</span>`;
    if (lances[i + 1]) html += `<span class="l">${lances[i + 1]}</span>`;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

/* ============================================================
   DICA
============================================================ */
function mostrarDica() {
  if (!emAndamento() || pensando || girando || !minhaVez() || modo === 'online') return;
  $('status').textContent = 'Procurando uma boa jogada... 💡';
  $('status').className = 'pensando';
  setTimeout(async () => {
    const copia = new Chess(jogo.fen());
    let san;
    if (modo === 'problema') san = copia.moves().find((m) => { copia.move(m); const ok = copia.isCheckmate() || (lancesRestantes > 1 && defesaPerde(copia, lancesRestantes - 1)); copia.undo(); return ok; });
    else {
      const r = await perguntarStockfish(jogo.fen(), { skill: 20, depth: 12, tempo: 1500 });
      san = r ? r.lance : escolherJogadaDoBot(copia, 3);
    }
    if (!san) return atualizarStatus();
    const m = copia.move(san);
    dica = { from: m.from, to: m.to };
    const id = partidaId;
    atualizarStatus();
    renderizar();
    avisar(`💡 Dica: ${m.san}`);
    setTimeout(() => {
      if (id === partidaId && dica && dica.from === m.from) {
        dica = null;
        renderizar();
      }
    }, DICA_MS);
  }, 30);
}

/* ============================================================
   PROBLEMAS
============================================================ */
// O lado da vez consegue dar mate em até n lances, não importa a defesa?
function mateEm(g, n) {
  for (const m of g.moves()) {
    g.move(m);
    const ok = g.isCheckmate() || (n > 1 && !g.isGameOver() && defesaPerde(g, n - 1));
    g.undo();
    if (ok) return true;
  }
  return false;
}
// Quem defende (lado da vez) leva mate em n, qualquer que seja a resposta?
function defesaPerde(g, n) {
  if (g.isGameOver()) return false;
  return g.moves().every((r) => {
    g.move(r);
    const x = mateEm(g, n);
    g.undo();
    return x;
  });
}

function conferirProblema() {
  const id = partidaId;
  if (jogo.isCheckmate()) {
    ativo = false;
    resolvidos.add(problemaAtual);
    guardar.salvar('xadrez-resolvidos', [...resolvidos]);
    if (conta) api('/progresso/problemas', { resolvidos: [problemaAtual] }).then((r) => (conta = r.usuario)).catch(() => {});
    $('status').textContent = 'Resolvido! Muito bem! ✅';
    $('status').className = 'fim';
    $('info').textContent = `Problema ${problemaAtual + 1} de ${PROBLEMAS.length}: ${PROBLEMAS[problemaAtual].nome} ✅`;
    if (problemaDoDia) {
      $('info').textContent = '📅 Problema do dia resolvido! ✅ Volte amanhã para um novo.';
      registrarProblemaDoDia();
    }
    SONS.vitoria();
    confete();
    atualizarJogadores();
    return;
  }

  const copia = new Chess(jogo.fen());
  if (lancesRestantes > 1 && defesaPerde(copia, lancesRestantes - 1)) {
    // Lance certo! A defesa responde com qualquer lance (todos perdem)
    lancesRestantes--;
    pensando = true;
    $('status').textContent = 'Boa! Agora a defesa responde...';
    $('status').className = 'pensando';
    setTimeout(() => {
      if (id !== partidaId) return;
      const respostas = jogo.moves();
      const r = jogo.move(respostas[Math.floor(Math.random() * respostas.length)]);
      ultima = { from: r.from, to: r.to };
      pensando = false;
      renderizar(animacoesDoLance(r.from, r.to));
      somDoUltimoLance();
      atualizarStatus();
    }, 700);
    return;
  }

  // Lance errado: volta
  pensando = true;
  SONS.erro();
  $('status').textContent = 'Não é esse lance. Tente de novo! ❌';
  $('status').className = '';
  atualizarJogadores();
  setTimeout(() => {
    if (id !== partidaId) return;
    jogo.undo();
    ultima = null;
    pensando = false;
    renderizar();
    atualizarStatus();
  }, 900);
}

/* ============================================================
   BOT (minimax com poda alfa-beta)
============================================================ */
const VALOR = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function avaliar(g) {
  let total = 0;
  const tab = g.board();
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const p = tab[i][j];
      if (!p) continue;
      let v = VALOR[p.type];
      const centro = 3.5 - Math.abs(3.5 - j) + (3.5 - Math.abs(3.5 - i));
      if (p.type === 'n' || p.type === 'b') v += centro * 4;
      if (p.type === 'p') {
        const avanco = p.color === 'w' ? 7 - i : i;
        v += centro * 2 + avanco * 5;
      }
      total += p.color === 'w' ? v : -v;
    }
  }
  return total;
}

function ordenar(jogadas) {
  const peso = (m) => (m.includes('x') ? 2 : 0) + (m.includes('+') ? 1 : 0);
  return jogadas.sort((a, b) => peso(b) - peso(a));
}

function minimax(g, profundidade, alfa, beta) {
  const jogadas = g.moves();
  if (jogadas.length === 0) {
    if (!g.inCheck()) return 0;
    return g.turn() === 'w' ? -100000 - profundidade : 100000 + profundidade;
  }
  if (profundidade === 0) return avaliar(g);

  ordenar(jogadas);
  if (g.turn() === 'w') {
    let melhor = -Infinity;
    for (const m of jogadas) {
      g.move(m);
      melhor = Math.max(melhor, minimax(g, profundidade - 1, alfa, beta));
      g.undo();
      alfa = Math.max(alfa, melhor);
      if (beta <= alfa) break;
    }
    return melhor;
  }
  let melhor = Infinity;
  for (const m of jogadas) {
    g.move(m);
    melhor = Math.min(melhor, minimax(g, profundidade - 1, alfa, beta));
    g.undo();
    beta = Math.min(beta, melhor);
    if (beta <= alfa) break;
  }
  return melhor;
}

function embaralhar(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

function escolherJogadaDoBot(g, nivelBot) {
  const jogadas = g.moves();
  if (nivelBot === 1) return jogadas[Math.floor(Math.random() * jogadas.length)];

  const profundidade = nivelBot === 2 ? 2 : 3;
  const brancas = g.turn() === 'w';
  let melhorJogada = null;
  let melhorValor = brancas ? -Infinity : Infinity;

  for (const m of ordenar(embaralhar(jogadas))) {
    g.move(m);
    const valor = minimax(g, profundidade - 1, -Infinity, Infinity);
    g.undo();
    if (brancas ? valor > melhorValor : valor < melhorValor) {
      melhorValor = valor;
      melhorJogada = m;
    }
  }
  return melhorJogada;
}

/* ---------- Stockfish (motor de xadrez de verdade, roda no navegador) ---------- */
const STOCKFISH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
// Nível 1 = jogadas aleatórias; 2 a 10 = Stockfish ficando cada vez mais forte
const NIVEIS_SF = {
  2: { skill: 0, depth: 1, tempo: 300 }, 3: { skill: 2, depth: 2, tempo: 400 }, 4: { skill: 4, depth: 3, tempo: 500 },
  5: { skill: 6, depth: 5, tempo: 700 }, 6: { skill: 9, depth: 7, tempo: 900 }, 7: { skill: 12, depth: 9, tempo: 1200 },
  8: { skill: 15, depth: 11, tempo: 1600 }, 9: { skill: 18, depth: 13, tempo: 2200 }, 10: { skill: 20, depth: 16, tempo: 3000 },
};
let sfPromessa = null;
let sfFila = Promise.resolve();

function iniciarStockfish() {
  if (sfPromessa) return sfPromessa;
  sfPromessa = new Promise((resolve, reject) => {
    try {
      const blob = new Blob([`importScripts('${STOCKFISH_URL}');`], { type: 'application/javascript' });
      const w = new Worker(URL.createObjectURL(blob));
      const desistir = setTimeout(() => reject(new Error('Stockfish demorou para carregar')), 20000);
      w.onmessage = (e) => {
        if (String(e.data).startsWith('uciok')) {
          clearTimeout(desistir);
          resolve(w);
        }
      };
      w.onerror = (e) => {
        clearTimeout(desistir);
        reject(e);
      };
      w.postMessage('uci');
    } catch (e) {
      reject(e);
    }
  });
  sfPromessa.catch(() => (sfPromessa = null)); // tenta de novo numa próxima vez
  return sfPromessa;
}

// Pergunta ao Stockfish. Devolve { lance: {from,to,promotion}, aval: {cp|mate} do ponto de vista de quem joga } ou null
function perguntarStockfish(fen, { skill = 20, depth = 12, tempo = 1500 } = {}) {
  const tarefa = sfFila.then(async () => {
    let w;
    try {
      w = await iniciarStockfish();
    } catch {
      return null;
    }
    return new Promise((resolve) => {
      let aval = null;
      const limite = setTimeout(() => w.postMessage('stop'), tempo + 4000);
      w.onmessage = (e) => {
        const linha = String(e.data);
        const m = linha.match(/score (cp|mate) (-?\d+)/);
        if (linha.startsWith('info') && m && !linha.includes('lowerbound') && !linha.includes('upperbound')) {
          aval = { tipo: m[1], valor: Number(m[2]) };
        }
        if (linha.startsWith('bestmove')) {
          clearTimeout(limite);
          const uci = linha.split(' ')[1];
          if (!uci || uci === '(none)') return resolve(null);
          resolve({ lance: { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }, aval });
        }
      };
      w.postMessage(`setoption name Skill Level value ${skill}`);
      w.postMessage(`position fen ${fen}`);
      w.postMessage(`go depth ${depth} movetime ${tempo}`);
    });
  });
  sfFila = tarefa.catch(() => null);
  return tarefa;
}

// Escolhe o lance do bot (Stockfish; se não carregar, usa o bot simples daqui)
async function lanceDoBot(fen, nivelBot) {
  const g = new Chess(fen);
  if (nivelBot <= 1) {
    const lista = g.moves({ verbose: true });
    return lista[Math.floor(Math.random() * lista.length)];
  }
  const r = await perguntarStockfish(fen, NIVEIS_SF[nivelBot] || NIVEIS_SF[5]);
  if (r) return r.lance;
  const san = escolherJogadaDoBot(g, nivelBot >= 6 ? 3 : 2);
  return g.move(san);
}

function jogarBot() {
  const id = partidaId;
  const inicio = Date.now();
  const atraso = relogio.ligado ? ATRASO_BOT_RELOGIO_MS : ATRASO_BOT_MS;
  pensando = true;
  $('status').textContent = 'Bot pensando... 🤔';
  $('status').className = 'pensando';
  atualizarJogadores();

  setTimeout(async () => {
    if (id !== partidaId || !ativo) return;
    const lance = await lanceDoBot(jogo.fen(), nivel);
    const resto = Math.max(0, atraso - (Date.now() - inicio));
    setTimeout(() => {
      if (id !== partidaId || !ativo || !lance) return;
      const r = jogo.move({ from: lance.from, to: lance.to, promotion: lance.promotion });
      ultima = { from: r.from, to: r.to };
      pensando = false;
      selecionada = null;
      destinos = [];
      trocarRelogio();
      renderizar(animacoesDoLance(r.from, r.to));
      somDoUltimoLance();
      atualizarStatus();
      tentarPremove();
    }, resto);
  }, 60);
}

/* ============================================================
   ONLINE (Socket.IO)
============================================================ */
function linkDaSala() {
  return `${location.origin}${location.pathname}?sala=${salaAtual}`;
}

function entrarNaSala(codigo) {
  salaAtual = codigo;
  const s = conectar();
  if (s.connected) s.emit('entrar-sala', { codigo, nome: meuNome(), id: meuId, sessao: minhaSessao });
}

// Monta o jogo a partir da lista de lances (assim a lista de jogadas e as regras de empate funcionam)
function jogoDoHistorico(historico) {
  const g = new Chess();
  for (const san of historico) g.move(san);
  return g;
}

function relogioDoServidor(r) {
  if (!r) return;
  relogio = { ligado: r.ligado, w: r.w, b: r.b, inc: 0, vez: r.vez, desde: performance.now(), rodando: r.rodando };
}

const TEXTOS_FIM = {
  mate: null, // o próprio tabuleiro explica
  afogamento: null,
  repeticao: null,
  material: null,
  empate: null,
  tempo: (v, eu) => (v === eu ? 'O tempo do oponente acabou. Você venceu! ⏰🏆' : 'Seu tempo acabou. ⏰'),
  desistencia: (v, eu) => (v === eu ? 'Seu oponente desistiu. Você venceu! 🏆' : 'Você desistiu.'),
  acordo: () => 'Empate por acordo. 🤝',
  abandono: (v, eu) => (v === eu ? 'Seu oponente abandonou a partida. Você venceu! 🏆' : 'Você abandonou a partida.'),
};

function conectar() {
  if (socket) return socket;
  socket = io();

  socket.on('connect', () => {
    $('conexao').hidden = true; // conexão nova (o servidor nunca reconecta sozinho quem ele derrubou)
    if (salaAtual) socket.emit('entrar-sala', { codigo: salaAtual, nome: meuNome(), id: meuId, sessao: minhaSessao });
    else if (naFila) socket.emit('fila-entrar', naFila); // caiu a conexão enquanto esperava: volta para a fila
  });

  socket.on('fila-aguardando', () => {
    $('fila').hidden = false;
  });

  socket.on('disconnect', (motivo) => {
    // O servidor derrubou a conexão de propósito (ex.: conta bloqueada pelo administrador)
    if (motivo === 'io server disconnect') {
      $('conexao').textContent = '⛔ Você foi desconectado pelo servidor. Recarregue a página.';
      $('conexao').hidden = false;
      return;
    }
    $('conexao').textContent = '⚠️ Conexão perdida. Tentando reconectar...';
    if (socket && salaAtual) $('conexao').hidden = false;
  });

  socket.on('sala', (s) => {
    sairDaFila(false);
    const novaSala = salaAtual !== s.codigo || modo !== 'online' || $('jogo').hidden;
    const novaPartida = novaSala || minhaCor !== s.cor || s.historico.length < jogo.history().length;
    modo = 'online';
    salaAtual = s.codigo;
    try { sessionStorage.setItem('xadrez-sala', s.codigo); } catch { /* ok */ }
    history.replaceState(null, '', `?sala=${s.codigo}`);
    minhaCor = s.cor;
    nomesOnline = s.jogadores;

    if (novaSala) {
      prepararTelaDeJogo();
      $('chat-msgs').innerHTML = '';
    } else if (novaPartida) {
      // revanche: limpa o estado da partida mas mantém o chat
      fimExtra = null;
      $('elo-mudanca').hidden = true;
      empateEnviado = false;
      revancheEnviada = false;
      ultima = null;
      partidaId++;
    }
    if (novaPartida) orientacao = s.cor;

    jogo = jogoDoHistorico(s.historico);
    ativo = s.iniciada && !s.encerrada;
    relogioDoServidor(s.relogio);
    fimExtra = null;
    if (s.encerrada && s.resultado) aplicarFimOnline(s.resultado, false);

    const esperando = !s.iniciada;
    $('convite').hidden = !esperando;
    if (esperando) {
      if (amigoParaConvidar) {
        socket.emit('convidar', amigoParaConvidar.id);
        avisar(`Convite enviado para ${amigoParaConvidar.nome}! 📨`);
        amigoParaConvidar = null;
      }
      mostrarAmigosParaConvidar();
    }
    $('codigo-sala').textContent = s.codigo;
    const tempo = s.base ? ` · ⏱ ${s.base / 60000} min${s.incremento ? ` + ${s.incremento / 1000}s` : ''}` : '';
    $('info').textContent = `Sala ${s.codigo} · Você joga de ${s.cor === 'w' ? 'brancas' : 'pretas'}${tempo}`;

    renderizar();
    atualizarStatus();
    if (s.iniciada && !s.encerrada && s.historico.length === 0) {
      SONS.inicio();
      if (novaPartida && !novaSala) avisar('Revanche! As cores foram trocadas. 🔁');
    }
  });

  socket.on('estado', ({ historico, ultima: u, relogio: r }) => {
    relogioDoServidor(r);
    const atual = jogo.history();
    const igual = historico.length === atual.length && historico.every((m, i) => m === atual[i]);
    if (igual) {
      atualizarStatus();
      return;
    }
    jogo = jogoDoHistorico(historico);
    if (u) ultima = u;
    selecionada = null;
    destinos = [];
    const doOponente = u && jogo.turn() === minhaCor;
    renderizar(doOponente ? animacoesDoLance(u.from, u.to) : []);
    if (doOponente) somDoUltimoLance();
    atualizarStatus();
    if (doOponente) tentarPremove();
  });

  socket.on('empate-proposto', async () => {
    if (!ativo) return;
    SONS.msg();
    const r = await perguntar('Seu oponente propôs empate. Você aceita?', 'Aceitar', 'Recusar');
    if (r !== null) socket.emit('responder-empate', r);
  });

  socket.on('empate-recusado', () => {
    empateEnviado = false;
    avisar('O oponente recusou o empate.');
    atualizarBotoes();
  });

  socket.on('fim', (resultado) => {
    relogioDoServidor(resultado.relogio);
    if (resultado.jogadores) nomesOnline = resultado.jogadores;
    aplicarFimOnline(resultado, true);
  });

  socket.on('revanche-pedida', () => {
    SONS.msg();
    avisar('Seu oponente quer revanche! 🔁');
    $('btn-revanche').textContent = '🔁 Aceitar revanche';
  });

  socket.on('oponente-desconectou', ({ segundos }) => {
    nomesOnline[oposta(minhaCor)] = { ...(nomesOnline[oposta(minhaCor)] || {}), conectado: false };
    avisar(`Seu oponente caiu. Esperando ele voltar (até ${segundos}s)...`);
    atualizarJogadores();
  });

  socket.on('oponente-voltou', ({ jogadores }) => {
    nomesOnline = jogadores;
    avisar('Seu oponente voltou! 👋');
    atualizarJogadores();
  });

  socket.on('oponente-saiu', () => {
    fecharDialogo();
    const op = oposta(minhaCor);
    nomesOnline[op] = null;
    if (ativo) ativo = false;
    avisar('Seu oponente saiu da sala.');
    atualizarStatus();
  });

  socket.on('chat', ({ id, nome, cor, texto }) => {
    const div = document.createElement('div');
    div.className = 'msg' + (cor === minhaCor ? ' minha' : '');
    const b = document.createElement('b');
    b.textContent = nome + ': ';
    const span = document.createElement('span');
    span.className = 'msg-texto';
    span.textContent = texto;
    div.append(b, span);
    if (cor !== minhaCor && id) {
      const btn = document.createElement('button');
      btn.className = 'denunciar';
      btn.title = 'Denunciar mensagem';
      btn.textContent = '🚩';
      btn.onclick = () => abrirDenuncia({ id, nome, texto, botao: btn });
      div.appendChild(btn);
    }
    $('chat-msgs').appendChild(div);
    $('chat-msgs').scrollTop = $('chat-msgs').scrollHeight;
    if (cor !== minhaCor) SONS.msg();
  });

  // Só chega para o administrador
  // Ganhou uma conquista nova!
  socket.on('conquista', ({ icone, nome, desc }) => {
    SONS.vitoria();
    confete();
    mostrarConquista(icone, nome, desc);
  });

  socket.on('nova-denuncia', ({ de, contra }) => {
    SONS.msg();
    avisar(`🚩 Nova denúncia: ${de} denunciou ${contra}.`);
    if (!$('admin').hidden) carregarAdmin();
    else atualizarBadgeAdmin();
  });

  // Fim de partida valendo ELO: mostra quanto ganhou/perdeu
  socket.on('elo', (mudanca) => {
    for (const cor of ['w', 'b']) {
      if (nomesOnline[cor] && mudanca[cor]) nomesOnline[cor].elo = mudanca[cor].elo;
    }
    const meu = mudanca[minhaCor];
    if (meu) {
      const antes = meu.elo - meu.delta;
      const el = $('elo-mudanca');
      const sinal = meu.delta > 0 ? '+' : meu.delta < 0 ? '−' : '±';
      el.textContent = `${sinal}${Math.abs(meu.delta)} ELO  →  ${eloTexto(meu.elo)} (${liga(meu.elo).nome})`;
      el.className = meu.delta > 0 ? 'ganhou' : meu.delta < 0 ? 'perdeu' : '';
      el.hidden = false;
      if (liga(meu.elo).min > liga(antes).min) {
        setTimeout(() => avisar(`Você subiu para a liga ${liga(meu.elo).icone} ${liga(meu.elo).nome}! 🎉`), 600);
      } else if (liga(meu.elo).min < liga(antes).min) {
        setTimeout(() => avisar(`Você caiu para a liga ${liga(meu.elo).icone} ${liga(meu.elo).nome}.`), 600);
      }
      if (conta) {
        conta.elo = meu.elo;
        aplicarConta(conta);
      }
    }
    atualizarJogadores();
  });

  socket.on('amigos-mudou', ({ texto } = {}) => {
    if (texto) {
      avisar(texto);
      SONS.msg();
    }
    if (!$('perfil').hidden) carregarAmigos();
    if (!$('convite').hidden) mostrarAmigosParaConvidar();
  });

  socket.on('convite', async ({ de, codigo }) => {
    SONS.msg();
    if (emAndamento() && modo !== 'problema') {
      avisar(`${de} te convidou para jogar, mas você está numa partida.`);
      return;
    }
    const r = await perguntar(`${de} te convidou para uma partida online! ♟️`, 'Jogar', 'Agora não');
    if (!r) return;
    if (salaAtual && salaAtual !== codigo) socket.emit('sair-sala');
    escolherModo('online');
    entrarNaSala(codigo);
  });

  socket.on('erro-sala', (mensagem) => {
    avisar(mensagem);
    SONS.erro();
    if (!$('jogo').hidden && modo === 'online') return;
    // não conseguiu entrar: volta ao menu limpo
    salaAtual = null;
    try { sessionStorage.removeItem('xadrez-sala'); } catch { /* ok */ }
    history.replaceState(null, '', location.pathname);
    mostrar('menu');
  });

  return socket;
}

function aplicarFimOnline({ vencedor, motivo }, comemorarAgora) {
  ultimoVencedor = vencedor;
  const wasAtivo = ativo;
  ativo = false;
  relogio.rodando = false;
  empateEnviado = false;
  revancheEnviada = false;
  $('btn-revanche').textContent = '🔁 Revanche';
  fecharDialogo();
  const f = TEXTOS_FIM[motivo];
  fimExtra = f ? f(vencedor, minhaCor) : null;
  atualizarStatus();
  if (comemorarAgora && (wasAtivo || motivo !== 'abandono')) comemorar(vencedor);
}

// Denúncia de mensagem do chat
let denunciaAtual = null;
function abrirDenuncia(d) {
  denunciaAtual = d;
  $('denuncia-msg').textContent = `${d.nome}: ${d.texto}`;
  $('denuncia-form').reset();
  $('denuncia').hidden = false;
}
$('denuncia-cancelar').onclick = () => ($('denuncia').hidden = true);
$('denuncia-form').onsubmit = (e) => {
  e.preventDefault();
  const d = denunciaAtual;
  $('denuncia').hidden = true;
  if (!d || !socket) return;
  socket.emit('denunciar', { id: d.id, motivo: $('denuncia-motivo').value, detalhes: $('denuncia-detalhes').value }, (r) => {
    avisar(r?.texto || 'Denúncia enviada.');
    if (r && !r.erro) {
      d.botao.disabled = true;
      d.botao.title = 'Denunciada';
    }
  });
};

// Chat
$('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const texto = $('chat-texto').value.trim();
  if (!texto || !socket) return;
  socket.emit('chat', texto);
  $('chat-texto').value = '';
};

/* ============================================================
   RANKING
============================================================ */
// Link que abre o perfil público de alguém
function linkPerfil(nome) {
  const a = document.createElement('a');
  a.href = '#';
  a.className = 'link-perfil';
  a.textContent = nome;
  a.onclick = (e) => {
    e.preventDefault();
    abrirPerfilPublico(nome);
  };
  return a;
}

const NOMES_MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const nomeMes = (t) => `${NOMES_MESES[Number(t.slice(5, 7)) - 1]}/${t.slice(0, 4)}`;

let abaRanking = 'geral';
document.querySelectorAll('.aba-rk').forEach((b) => (b.onclick = () => {
  abaRanking = b.dataset.aba;
  carregarRanking();
}));

async function carregarRanking() {
  document.querySelectorAll('.aba-rk').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === abaRanking));
  const corpo = $('ranking-lista');
  const cab = $('ranking-cabecalho');
  const cabecalhos = {
    geral: ['', 'Jogador', 'ELO', 'Partidas'],
    mes: ['', 'Jogador', 'ELO ganho no mês', 'Partidas'],
    campeoes: ['Mês', 'Lugar', 'Jogador', 'ELO ganho'],
  }[abaRanking];
  cab.innerHTML = '';
  for (const c of cabecalhos) {
    const th = document.createElement('th');
    th.textContent = c;
    cab.appendChild(th);
  }
  const mensagem = (t) => (corpo.innerHTML = `<tr><td colspan="4">${t}</td></tr>`);
  mensagem('Carregando...');
  try {
    const url = abaRanking === 'campeoes' ? '/api/temporadas' : abaRanking === 'mes' ? '/api/ranking?periodo=mes' : '/api/ranking';
    const lista = await (await fetch(url)).json();
    if (!lista.length) {
      return mensagem(abaRanking === 'campeoes' ? 'Nenhum mês terminou ainda. O pódio aparece aqui no começo de cada mês.' : 'Ninguém no ranking ainda. Jogue uma partida online!');
    }
    corpo.innerHTML = '';
    lista.forEach((j, i) => {
      const tr = document.createElement('tr');
      const medalha = (p) => ['🥇', '🥈', '🥉'][p] || `${p + 1}º`;
      const celulas = abaRanking === 'geral' ? [medalha(i), linkPerfil(j.nome), eloTexto(j.elo), `${j.v}V ${j.e}E ${j.d}D`]
        : abaRanking === 'mes' ? [medalha(i), linkPerfil(j.nome), `+${j.pontos}`, j.partidas]
          : [nomeMes(j.temporada), medalha(j.posicao - 1), linkPerfil(j.nome), `+${j.pontos}`];
      for (const valor of celulas) {
        const td = document.createElement('td');
        if (valor instanceof Node) td.appendChild(valor);
        else td.textContent = valor;
        tr.appendChild(td);
      }
      corpo.appendChild(tr);
    });
  } catch {
    mensagem('Não foi possível carregar o ranking.');
  }
}

$('btn-ranking').onclick = () => {
  $('ranking').hidden = false;
  $('ligas').textContent = LIGAS.map((l) => `${l.icone} ${l.nome} ${l.min ? l.min + '+' : ''}`.trim()).join('  ·  ');
  carregarRanking();
};

/* ---------- Perfil público ---------- */
async function abrirPerfilPublico(nome) {
  let p;
  try {
    p = await api('/perfil/' + encodeURIComponent(nome));
  } catch (err) {
    return avisar(err.message);
  }
  document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true));
  $('perfil-pub').hidden = false;
  const lg = liga(p.elo);
  $('pp-nome').textContent = `👤 ${p.nome}`;
  $('pp-sub').textContent = `${p.jogando ? '🟡 jogando agora' : p.online ? '🟢 online' : '⚪ offline'} · jogando desde ${new Date(p.criado_em).toLocaleDateString('pt-BR')}`;
  $('pp-elo').textContent = eloTexto(p.elo);
  $('pp-liga').textContent = `ELO · liga ${lg.nome}`;
  $('pp-online').textContent = `${p.vitorias}/${p.empates}/${p.derrotas}`;
  $('pp-seq').textContent = p.sequencia >= 3 ? `🔥 ${p.sequencia}` : p.sequencia;
  $('pp-problemas').textContent = p.problemas;

  // Títulos de temporada (pódio de meses passados)
  const tit = $('pp-titulos');
  tit.innerHTML = '';
  for (const t of p.titulos) {
    const s = document.createElement('span');
    s.className = 'titulo';
    s.textContent = `${['🥇', '🥈', '🥉'][t.posicao - 1]} ${t.posicao}º lugar · ${nomeMes(t.temporada)}`;
    tit.appendChild(s);
  }

  // Ações: adicionar amigo / desafiar
  const acoes = $('pp-acoes');
  acoes.innerHTML = '';
  if (conta && !p.souEu) {
    if (!p.amizade) {
      acoes.appendChild(botaoAdmin('➕ Adicionar amigo', async () => {
        try { avisar((await api('/amigos/pedir', { nome: p.nome })).texto); } catch (err) { avisar(err.message); }
        abrirPerfilPublico(p.nome);
      }, 'destaque'));
    } else {
      const s = document.createElement('span');
      s.className = 'nota';
      s.textContent = { amigos: '✅ Vocês são amigos', enviado: '⏳ Pedido de amizade enviado', recebido: '📩 Essa pessoa te mandou um pedido (veja em Minha conta)' }[p.amizade];
      acoes.appendChild(s);
    }
  }

  desenharGraficoElo($('pp-grafico'), p.historicoElo);

  const conqEl = $('pp-conquistas');
  conqEl.innerHTML = '';
  const todas = await todasConquistas();
  const tem = new Map(p.conquistas.map((c) => [c.codigo, c]));
  $('pp-conq-n').textContent = `${p.conquistas.length} de ${Object.keys(todas).length}`;
  for (const [codigo, c] of Object.entries(todas)) {
    const d = document.createElement('div');
    const ganha = tem.get(codigo);
    d.className = 'conquista' + (ganha ? ' ganha' : '');
    d.title = c.desc + (ganha ? ` — conquistada em ${new Date(ganha.criado_em).toLocaleDateString('pt-BR')}` : ' — ainda não conquistada');
    const i = document.createElement('span');
    i.className = 'ic';
    i.textContent = c.icone;
    const n = document.createElement('small');
    n.textContent = c.nome;
    d.append(i, n);
    conqEl.appendChild(d);
  }

  const part = $('pp-partidas');
  part.innerHTML = '';
  if (!p.partidas.length) part.textContent = 'Nenhuma partida online ainda.';
  for (const x of p.partidas) {
    const div = document.createElement('div');
    div.className = 'partida ' + x.resultado;
    const s = document.createElement('span');
    const icone = { vitoria: '🏆 Vitória', derrota: '❌ Derrota', empate: '🤝 Empate' }[x.resultado];
    s.textContent = `${icone} contra ${x.oponente} · ${MOTIVOS[x.motivo] || x.motivo} · ${new Date(x.quando).toLocaleDateString('pt-BR')}`;
    div.appendChild(s);
    if (x.temReplay) div.appendChild(botaoReplay(x.id, x.cor));
    part.appendChild(div);
  }
}
$('pp-fechar').onclick = () => ($('perfil-pub').hidden = true);

// Cartão "Conquista desbloqueada!" que aparece por alguns segundos
function mostrarConquista(icone, nome, desc) {
  const d = document.createElement('div');
  d.className = 'toast-conquista';
  const i = document.createElement('span');
  i.className = 'ic';
  i.textContent = icone;
  const t = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = `Conquista desbloqueada: ${nome}`;
  const s = document.createElement('small');
  s.textContent = desc;
  t.append(b, s);
  d.append(i, t);
  document.body.appendChild(d);
  setTimeout(() => d.classList.add('saindo'), 5000);
  setTimeout(() => d.remove(), 5600);
}

let cacheConquistas = null;
async function todasConquistas() {
  if (!cacheConquistas) cacheConquistas = await api('/conquistas');
  return cacheConquistas;
}

function desenharGraficoElo(svg, pontos) {
  if (!pontos.length) {
    svg.innerHTML = '<text x="200" y="64" text-anchor="middle" class="g-texto">Jogue partidas online para ver o gráfico</text>';
    return;
  }
  const valores = [pontos[0].elo - pontos[0].delta, ...pontos.map((p) => p.elo)];
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const faixa = Math.max(20, max - min);
  const x = (i) => 8 + (i / Math.max(1, valores.length - 1)) * 384;
  const y = (v) => 108 - ((v - min) / faixa) * 92;
  const linha = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  svg.innerHTML =
    `<polyline points="${linha}" class="g-linha"/>` +
    valores.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" class="g-ponto"><title>${v}</title></circle>`).join('') +
    `<text x="4" y="12" class="g-texto">${max}</text><text x="4" y="118" class="g-texto">${min}</text>`;
}

$('btn-meu-perfil').onclick = () => conta && abrirPerfilPublico(conta.nome);
$('ranking-fechar').onclick = () => ($('ranking').hidden = true);

/* ============================================================
   REVER PARTIDA: replay lance a lance, análise do Stockfish e PGN
============================================================ */
const rp = {
  historico: [], posicoes: [], lances: [], indice: 0, orientacao: 'w',
  brancas: 'Brancas', pretas: 'Pretas', resultado: '*', data: new Date(),
  aval: [], analise: [], analisando: false,
};

// Desenha um tabuleiro "de enfeite" (sem cliques) num elemento
function desenharMini(el, fen, orient, marcas = {}) {
  const g = new Chess(fen);
  el.innerHTML = '';
  const linhas = orient === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const colunas = orient === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  for (const r of linhas) {
    for (const c of colunas) {
      const casa = COLUNAS[c] + r;
      const div = document.createElement('div');
      div.className = 'casa ' + ((c + r) % 2 === 1 ? 'escura' : 'clara');
      if (marcas.ultima && (casa === marcas.ultima.from || casa === marcas.ultima.to)) div.classList.add('ultima');
      if (marcas.melhor && (casa === marcas.melhor.from || casa === marcas.melhor.to)) div.classList.add('dica');
      if (marcas.destaque === casa) div.classList.add('selecionada');
      const p = g.get(casa);
      if (marcas.pontos?.includes(casa)) div.classList.add('destino', ...(p ? ['captura'] : []));
      if (p && p.type === 'k' && g.inCheck() && p.color === g.turn()) div.classList.add('xeque');
      if (p) {
        const span = document.createElement('span');
        span.className = 'peca ' + (p.color === 'w' ? 'branca' : 'preta');
        span.innerHTML = svgPeca(p.type);
        div.appendChild(span);
      }
      if (c === colunas[0]) div.appendChild(coordenada(String(r), 'rank'));
      if (r === linhas[7]) div.appendChild(coordenada(COLUNAS[c], 'file'));
      el.appendChild(div);
    }
  }
}

function abrirReplay({ historico, brancas, pretas, resultado = '*', data = new Date(), orientacao = 'w', titulo }) {
  const g = new Chess();
  rp.posicoes = [g.fen()];
  rp.lances = [];
  for (const san of historico) {
    const m = g.move(san);
    rp.lances.push(m);
    rp.posicoes.push(g.fen());
  }
  Object.assign(rp, { historico, brancas, pretas, resultado, data, orientacao, indice: historico.length, aval: [], analise: [], analisando: false });
  $('replay-titulo').textContent = titulo || `🔍 ${brancas} × ${pretas}`;
  $('replay-resumo').hidden = true;
  $('replay-grafico').setAttribute('hidden', '');
  $('replay-progresso').hidden = true;
  $('replay-barra').style.visibility = 'hidden';
  $('rp-analisar').disabled = false;
  $('rp-analisar').textContent = '🔬 Analisar com Stockfish';
  $('replay').hidden = false;
  desenharListaReplay();
  irPara(rp.indice);
}

const SIMBOLOS = { grave: '??', erro: '?', imprecisao: '?!', melhor: '★' };
const NOMES_CLASSE = { grave: 'Erro grave', erro: 'Erro', imprecisao: 'Imprecisão', melhor: 'Melhor lance' };

function desenharListaReplay() {
  const el = $('replay-lances');
  el.innerHTML = '';
  rp.lances.forEach((m, i) => {
    if (i % 2 === 0) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${i / 2 + 1}.`;
      el.appendChild(n);
    }
    const b = document.createElement('button');
    b.className = 'lance-rp';
    b.dataset.i = i + 1;
    const a = rp.analise[i];
    b.textContent = m.san + (a?.classe ? SIMBOLOS[a.classe] : '');
    if (a?.classe) b.classList.add(a.classe);
    b.onclick = () => irPara(i + 1);
    el.appendChild(b);
  });
}

// Avaliação em "centipeões" do ponto de vista das BRANCAS (+ = brancas melhor)
function avalTexto(cp) {
  if (Math.abs(cp) >= 9000) return (cp > 0 ? '+' : '-') + 'M';
  return (cp > 0 ? '+' : '') + (cp / 100).toFixed(1);
}

function irPara(i) {
  rp.indice = Math.max(0, Math.min(rp.posicoes.length - 1, i));
  const lance = rp.lances[rp.indice - 1];
  const a = rp.analise[rp.indice - 1];
  desenharMini($('replay-tabuleiro'), rp.posicoes[rp.indice], rp.orientacao, {
    ultima: lance ? { from: lance.from, to: lance.to } : null,
    melhor: a && a.classe && a.classe !== 'melhor' ? a.melhor : null,
  });
  document.querySelectorAll('.lance-rp').forEach((b) => b.classList.toggle('atual', Number(b.dataset.i) === rp.indice));
  document.querySelector('.lance-rp.atual')?.scrollIntoView({ block: 'nearest' });

  // Barra de avaliação
  const av = rp.aval[rp.indice];
  if (av !== undefined) {
    $('replay-barra').style.visibility = 'visible';
    const pct = 50 + 50 * Math.tanh(av / 600);
    $('replay-barra-branca').style.height = pct + '%';
    $('replay-barra').classList.toggle('girada', rp.orientacao === 'b');
    $('replay-barra-num').textContent = avalTexto(av);
  }

  // Comentário do lance
  const c = $('replay-comentario');
  if (!lance) c.textContent = 'Posição inicial. Use ◀ ▶ (ou as setas do teclado) para andar pelos lances.';
  else {
    const quem = lance.color === 'w' ? rp.brancas : rp.pretas;
    let t = `${Math.ceil(rp.indice / 2)}${lance.color === 'w' ? '.' : '...'} ${lance.san} — ${quem}`;
    if (a?.classe === 'melhor') t += ' · ★ Melhor lance!';
    else if (a?.classe) {
      const quanto = a.perda >= 900 ? 'deixou o jogo perdido' : `perdeu ${(a.perda / 100).toFixed(1)} peões de vantagem`;
      t += ` · ${SIMBOLOS[a.classe]} ${NOMES_CLASSE[a.classe]} (${quanto}). Melhor era ${a.melhorSan} (marcado em verde).`;
    }
    else if (a) t += ' · Bom lance.';
    if (rp.indice === rp.posicoes.length - 1 && rp.resultado !== '*') t += `  Resultado: ${rp.resultado}`;
    c.textContent = t;
  }
}

$('rp-inicio').onclick = () => irPara(0);
$('rp-voltar').onclick = () => irPara(rp.indice - 1);
$('rp-avancar').onclick = () => irPara(rp.indice + 1);
$('rp-fim').onclick = () => irPara(rp.posicoes.length - 1);
$('rp-girar').onclick = () => {
  rp.orientacao = rp.orientacao === 'w' ? 'b' : 'w';
  irPara(rp.indice);
};
$('replay-fechar').onclick = () => {
  rp.analisando = false;
  $('replay').hidden = true;
};
document.addEventListener('keydown', (e) => {
  if ($('replay').hidden || e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') irPara(rp.indice - 1);
  else if (e.key === 'ArrowRight') irPara(rp.indice + 1);
  else if (e.key === 'Home') irPara(0);
  else if (e.key === 'End') irPara(rp.posicoes.length - 1);
  else return;
  e.preventDefault();
});

// Avalia cada posição com o Stockfish e classifica os lances
$('rp-analisar').onclick = async () => {
  if (rp.analisando || !rp.lances.length) return;
  rp.analisando = true;
  $('rp-analisar').disabled = true;
  $('replay-progresso').hidden = false;
  const total = rp.posicoes.length;
  const melhores = [];
  for (let i = 0; i < total; i++) {
    if (!rp.analisando) return; // fechou a janela
    $('replay-progresso').textContent = `Analisando posição ${i + 1} de ${total}... ⏳`;
    const g = new Chess(rp.posicoes[i]);
    if (g.isCheckmate()) { rp.aval[i] = g.turn() === 'w' ? -10000 : 10000; continue; }
    if (g.isDraw() || g.isStalemate()) { rp.aval[i] = 0; continue; }
    const r = await perguntarStockfish(rp.posicoes[i], { skill: 20, depth: 11, tempo: 700 });
    if (!r) {
      $('replay-progresso').textContent = 'Não consegui carregar o Stockfish. Verifique a internet e tente de novo.';
      rp.analisando = false;
      $('rp-analisar').disabled = false;
      return;
    }
    let v = 0;
    if (r.aval) v = r.aval.tipo === 'mate' ? (r.aval.valor > 0 ? 10000 - r.aval.valor : -10000 - r.aval.valor) : r.aval.valor;
    rp.aval[i] = g.turn() === 'w' ? v : -v;
    melhores[i] = r.lance;
    if (i === rp.indice) irPara(rp.indice);
  }

  // Classifica: quanto o lance piorou a posição para quem jogou
  const limitar = (x) => Math.max(-1500, Math.min(1500, x));
  const contagem = { w: { grave: 0, erro: 0, imprecisao: 0, perda: 0, n: 0 }, b: { grave: 0, erro: 0, imprecisao: 0, perda: 0, n: 0 } };
  rp.lances.forEach((m, i) => {
    const sinal = m.color === 'w' ? 1 : -1;
    const perda = Math.max(0, (limitar(rp.aval[i]) - limitar(rp.aval[i + 1])) * sinal);
    const melhor = melhores[i];
    const jogouOMelhor = melhor && melhor.from === m.from && melhor.to === m.to;
    let classe = null;
    if (perda >= 300) classe = 'grave';
    else if (perda >= 150) classe = 'erro';
    else if (perda >= 70) classe = 'imprecisao';
    else if (jogouOMelhor) classe = 'melhor';
    let melhorSan = '';
    if (melhor && classe && classe !== 'melhor') {
      try { melhorSan = new Chess(rp.posicoes[i]).move(melhor).san; } catch { /* ok */ }
    }
    rp.analise[i] = { classe, perda, melhor, melhorSan };
    const ct = contagem[m.color];
    ct.n++;
    ct.perda += Math.min(perda, 1000);
    if (classe && classe !== 'melhor') ct[classe]++;
  });

  // Precisão (0 a 100%) de cada lado, a partir da perda média
  const precisao = (ct) => (ct.n ? Math.max(0, Math.round(100 * Math.exp(-ct.perda / ct.n / 120))) : 100);
  const resumo = $('replay-resumo');
  resumo.innerHTML = '';
  for (const [cor, nome] of [['w', rp.brancas], ['b', rp.pretas]]) {
    const ct = contagem[cor];
    const d = document.createElement('div');
    d.textContent = `${cor === 'w' ? '⚪' : '⚫'} ${nome}: precisão ${precisao(ct)}% · ${ct.grave} ?? · ${ct.erro} ? · ${ct.imprecisao} ?!`;
    resumo.appendChild(d);
  }
  resumo.hidden = false;
  $('replay-progresso').hidden = true;
  desenharGraficoReplay();
  desenharListaReplay();
  irPara(rp.indice);
  rp.analisando = false;
  $('rp-analisar').textContent = '✅ Analisada';
};

function desenharGraficoReplay() {
  const svg = $('replay-grafico');
  const n = rp.aval.length;
  if (n < 2) return;
  const pts = rp.aval.map((v, i) => `${(i / (n - 1)) * 300},${40 - 38 * Math.tanh(v / 600)}`);
  svg.innerHTML = `<rect x="0" y="0" width="300" height="80" class="g-fundo"/>` +
    `<polygon points="0,40 ${pts.join(' ')} 300,40" class="g-area"/>` +
    `<line x1="0" y1="40" x2="300" y2="40" class="g-meio"/>`;
  svg.removeAttribute('hidden'); // em SVG, "svg.hidden = false" não funciona
  svg.onclick = (e) => {
    const r = svg.getBoundingClientRect();
    irPara(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
  };
}

// PGN: formato padrão de partidas de xadrez (abre no Lichess, Chess.com etc.)
$('rp-pgn').onclick = () => {
  const g = new Chess();
  const d = rp.data;
  const data = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  g.header('Event', 'Partida no Xadrez', 'Site', location.origin, 'Date', data, 'White', rp.brancas, 'Black', rp.pretas, 'Result', rp.resultado);
  for (const san of rp.historico) g.move(san);
  const texto = g.pgn() + (rp.resultado !== '*' && !g.pgn().trim().endsWith(rp.resultado) ? ' ' + rp.resultado : '') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'application/x-chess-pgn' }));
  a.download = `xadrez_${rp.brancas}_x_${rp.pretas}_${data}.pgn`.replace(/[^\w.\-]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

// Resultado no formato PGN da partida que acabou de terminar
function resultadoAtualPgn() {
  if (jogo.isCheckmate()) return jogo.turn() === 'w' ? '0-1' : '1-0';
  if (jogo.isDraw() || jogo.isStalemate()) return '1/2-1/2';
  if (ultimoVencedor === 'w') return '1-0';
  if (ultimoVencedor === 'b') return '0-1';
  if (ultimoVencedor === null && fimExtra) return '1/2-1/2';
  return '*';
}
let ultimoVencedor; // guardado quando a partida termina por tempo/desistência

// Botão "▶ Rever" para uma partida salva no servidor
function botaoReplay(id, orientacao = 'w') {
  const b = document.createElement('button');
  b.className = 'mini-btn';
  b.textContent = '▶ Rever';
  b.onclick = async () => {
    try {
      const p = await api('/partida/' + id);
      const resultado = p.vencedor === 'w' ? '1-0' : p.vencedor === 'b' ? '0-1' : '1/2-1/2';
      document.querySelectorAll('.overlay:not(#replay)').forEach((o) => (o.hidden = true));
      abrirReplay({ historico: p.historico, brancas: p.branco_nome, pretas: p.preto_nome, resultado, data: new Date(p.criado_em), orientacao });
    } catch (err) {
      avisar(err.message);
    }
  };
  return b;
}

$('btn-rever').onclick = () => {
  const nome = (cor) => (modo === 'online' ? nomesOnline[cor]?.nome || nomeDaCor(cor) : nomeDoJogador(cor).replace(/^🤖 /, ''));
  abrirReplay({
    historico: jogo.history(),
    brancas: nome('w'),
    pretas: nome('b'),
    resultado: resultadoAtualPgn(),
    orientacao: modo === 'local' ? 'w' : minhaCor,
  });
};

/* ============================================================
   CONTAS, PROGRESSO E AMIGOS
============================================================ */
let conta = null;            // perfil do usuário logado (ou null)
let amigoParaConvidar = null; // { id, nome } para convidar quando a sala for criada

async function api(caminho, corpo) {
  const opcoes = corpo === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) };
  const resp = await fetch('/api' + caminho, opcoes);
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(dados.erro || 'Algo deu errado. Tente de novo.');
  return dados;
}

// Depois de entrar/sair: a conexão online precisa saber quem é você
function renovarConexao() {
  if (socket && !salaAtual) {
    socket.disconnect();
    socket = null;
  }
  if (conta) conectar();
}

async function aplicarConta(usuario) {
  conta = usuario;
  $('btn-conta').textContent = conta ? `👤 ${conta.nome} · ${eloTexto(conta.elo)}` : '👤 Entrar';
  $('btn-admin').hidden = !conta?.admin;
  if (conta?.admin) atualizarBadgeAdmin();
  $('apelido').disabled = !!conta;
  $('apelido').parentElement.title = conta ? 'Seu nome é o da sua conta' : '';
  if (!conta) return;
  $('apelido').value = conta.nome;
  if (conta.tema) aplicarTema(conta.tema);
  // Junta os problemas resolvidos neste aparelho com os da conta
  const daConta = new Set(conta.problemas || []);
  const soAqui = [...resolvidos].filter((i) => !daConta.has(i));
  resolvidos = new Set([...resolvidos, ...daConta]);
  guardar.salvar('xadrez-resolvidos', [...resolvidos]);
  if (soAqui.length) {
    try { conta = (await api('/progresso/problemas', { resolvidos: soAqui })).usuario; } catch { /* tenta de novo depois */ }
  }
  if (!$('opcoes-problema').hidden) atualizarProgressoProblemas();
}

async function carregarConta() {
  try {
    const r = await api('/eu');
    $('btn-conta').hidden = !r.contas;
    await aplicarConta(r.usuario);
    if (conta) conectar();
  } catch {
    $('btn-conta').hidden = true;
  }
}

/* ---------- Tela de entrar / criar conta ---------- */
let abaLogin = 'entrar';
function trocarAbaLogin(aba) {
  abaLogin = aba;
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  const cadastro = aba === 'cadastrar';
  $('login-nome-label').hidden = !cadastro;
  $('login-nome').required = cadastro;
  $('login-email').autocomplete = cadastro ? 'email' : 'username';
  $('login-confirmar-label').hidden = !cadastro;
  $('login-dica').hidden = !cadastro;
  $('login-senha').autocomplete = cadastro ? 'new-password' : 'current-password';
  $('login-enviar').textContent = cadastro ? 'Criar conta' : 'Entrar';
  $('login-erro').hidden = true;
}
document.querySelectorAll('.aba').forEach((b) => (b.onclick = () => trocarAbaLogin(b.dataset.aba)));

$('btn-conta').onclick = () => {
  if (conta) return abrirPerfil();
  trocarAbaLogin('entrar');
  $('login-form').reset();
  $('login').hidden = false;
  $('login-email').focus();
};
$('login-fechar').onclick = () => ($('login').hidden = true);

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const email = $('login-email').value.trim();
  const nome = $('login-nome').value.trim();
  const senha = $('login-senha').value;
  const erro = (t) => {
    $('login-erro').textContent = t;
    $('login-erro').hidden = false;
  };
  if (abaLogin === 'cadastrar' && senha !== $('login-confirmar').value) return erro('As senhas não são iguais.');
  $('login-enviar').disabled = true;
  try {
    const r = abaLogin === 'cadastrar'
      ? await api('/cadastrar', { email, nome, senha })
      : await api('/entrar', { email, senha });
    $('login').hidden = true;
    $('login-form').reset();
    await aplicarConta(r.usuario);
    renovarConexao();
    avisar(abaLogin === 'cadastrar' ? `Conta criada! Bem-vindo, ${conta.nome}! 🎉` : `Olá de novo, ${conta.nome}! 👋`);
  } catch (err) {
    erro(err.message);
  } finally {
    $('login-enviar').disabled = false;
  }
};

/* ---------- Minha conta ---------- */
async function abrirPerfil() {
  $('perfil').hidden = false;
  try {
    conta = (await api('/eu')).usuario || conta;
  } catch { /* mostra o que já tem */ }
  if (!conta) {
    $('perfil').hidden = true;
    return aplicarConta(null);
  }
  $('perfil-nome').textContent = conta.nome;
  $('perfil-email').textContent = conta.email || '';
  $('email-form').hidden = !!conta.email;
  $('st-elo').textContent = eloTexto(conta.elo);
  const proxima = LIGAS.find((l) => l.min > conta.elo);
  $('st-elo-liga').textContent = `ELO · ${liga(conta.elo).nome}` + (proxima ? ` (faltam ${proxima.min - conta.elo} p/ ${proxima.nome})` : '');
  $('st-online').textContent = `${conta.vitorias}/${conta.empates}/${conta.derrotas}`;
  $('st-bot').textContent = `${conta.bot_vitorias}/${conta.bot_empates}/${conta.bot_derrotas}`;
  $('st-problemas').textContent = `${resolvidos.size}/${PROBLEMAS.length}`;
  carregarAmigos();
  carregarPartidas();
}
$('perfil-fechar').onclick = () => ($('perfil').hidden = true);

$('btn-sair-conta').onclick = async () => {
  try { await api('/sair', {}); } catch { /* sai mesmo assim */ }
  $('perfil').hidden = true;
  $('apelido').value = '';
  guardar.salvar('xadrez-nome', '');
  await aplicarConta(null);
  renovarConexao();
  avisar('Você saiu da conta.');
};

$('senha-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/trocar-senha', { atual: $('senha-atual').value, nova: $('senha-nova').value });
    $('senha-form').reset();
    avisar('Senha trocada! 🔑');
  } catch (err) {
    avisar(err.message);
  }
};

const MOTIVOS = { mate: 'xeque-mate', tempo: 'tempo', desistencia: 'desistência', abandono: 'abandono', acordo: 'acordo', afogamento: 'afogamento', repeticao: 'repetição', material: 'material insuficiente', empate: 'empate' };

async function carregarPartidas() {
  const el = $('partidas-lista');
  el.textContent = 'Carregando...';
  try {
    const lista = await api('/partidas');
    el.innerHTML = '';
    if (!lista.length) el.textContent = 'Nenhuma partida online ainda.';
    for (const p of lista) {
      const div = document.createElement('div');
      div.className = 'partida ' + p.resultado;
      const icone = { vitoria: '🏆 Vitória', derrota: '❌ Derrota', empate: '🤝 Empate' }[p.resultado];
      const data = new Date(p.quando).toLocaleDateString('pt-BR');
      const span = document.createElement('span');
      span.textContent = `${icone} contra ${p.oponente} · ${MOTIVOS[p.motivo] || p.motivo} · ${data}`;
      div.appendChild(span);
      if (p.temReplay) div.appendChild(botaoReplay(p.id, p.cor));
      el.appendChild(div);
    }
  } catch {
    el.textContent = 'Não foi possível carregar.';
  }
}

function linhaAmigo(texto, botoes, nome) {
  const div = document.createElement('div');
  div.className = 'amigo';
  const span = document.createElement('span');
  if (nome) span.append(linkPerfil(nome), document.createTextNode(texto));
  else span.textContent = texto;
  div.appendChild(span);
  for (const [rotulo, acao, destaque] of botoes) {
    const b = document.createElement('button');
    b.textContent = rotulo;
    if (destaque) b.className = 'destaque';
    b.onclick = acao;
    div.appendChild(b);
  }
  return div;
}

async function acaoAmigo(caminho, id) {
  try {
    await api(caminho, { id });
  } catch (err) {
    avisar(err.message);
  }
  carregarAmigos();
}

function desafiar(amigo) {
  $('perfil').hidden = true;
  amigoParaConvidar = amigo;
  const [minutos, incremento] = $('relogio-online').value.split('+').map(Number);
  salaAtual = null;
  conectar().emit('criar-sala', { nome: meuNome(), id: meuId, sessao: minhaSessao, minutos, incremento });
}

async function carregarAmigos() {
  const lista = $('amigos-lista');
  const recebidos = $('amigos-recebidos');
  const enviados = $('amigos-enviados');
  try {
    const r = await api('/amigos');
    recebidos.innerHTML = '';
    lista.innerHTML = '';
    enviados.innerHTML = '';
    for (const a of r.recebidos) {
      recebidos.appendChild(linhaAmigo(`📩 ${a.nome} quer ser seu amigo`, [
        ['Aceitar', () => acaoAmigo('/amigos/aceitar', a.id), true],
        ['Recusar', () => acaoAmigo('/amigos/remover', a.id)],
      ]));
    }
    if (!r.amigos.length) {
      const p = document.createElement('p');
      p.className = 'nota';
      p.textContent = 'Você ainda não tem amigos aqui. Adicione pelo nome de usuário!';
      lista.appendChild(p);
    }
    for (const a of r.amigos) {
      const estado = a.jogando ? '🟡 jogando' : a.online ? '🟢 online' : '⚪ offline';
      const botoes = [];
      if (a.online && !a.jogando) botoes.push(['⚔️ Desafiar', () => desafiar(a), true]);
      botoes.push(['✕', async () => {
        const ok = await perguntarPorCima(`Desfazer a amizade com ${a.nome}?`);
        if (ok) acaoAmigo('/amigos/remover', a.id);
      }]);
      const linha = linhaAmigo(` · ${eloTexto(a.elo)} ELO · ${estado}`, botoes, a.nome);
      linha.lastChild.title = 'Desfazer amizade';
      lista.appendChild(linha);
    }
    for (const a of r.enviados) {
      enviados.appendChild(linhaAmigo(`⏳ Pedido enviado para ${a.nome}`, [['Cancelar', () => acaoAmigo('/amigos/remover', a.id)]]));
    }
  } catch (err) {
    lista.textContent = err.message;
  }
}

// O diálogo de pergunta fica por baixo do perfil; esconde o perfil enquanto pergunta
async function perguntarPorCima(texto) {
  $('perfil').hidden = true;
  const r = await perguntar(texto, 'Sim', 'Não');
  $('perfil').hidden = false;
  return r;
}

$('amigo-form').onsubmit = async (e) => {
  e.preventDefault();
  const nome = $('amigo-nome').value.trim();
  if (!nome) return;
  try {
    const r = await api('/amigos/pedir', { nome });
    $('amigo-nome').value = '';
    avisar(r.texto);
  } catch (err) {
    avisar(err.message);
  }
  carregarAmigos();
};

$('email-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    conta = (await api('/email', { email: $('email-novo').value.trim() })).usuario;
    await aplicarConta(conta);
    avisar('E-mail salvo! Agora você entra com ele. ✉️');
    abrirPerfil();
  } catch (err) {
    avisar(err.message);
  }
};

$('troca-email-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api('/trocar-email', { email: $('troca-email-novo').value.trim(), senha: $('troca-email-senha').value });
    $('troca-email-form').reset();
    $('trocar-email').open = false;
    await aplicarConta(r.usuario);
    avisar(conta.admin ? 'E-mail trocado! Você agora tem acesso ao painel de admin. 🛠️' : 'E-mail trocado! ✉️');
    abrirPerfil();
  } catch (err) {
    avisar(err.message);
  }
};

/* ---------- Painel do administrador ---------- */
let abaAdmin = 'resumo';
const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

// Monta uma tabela com segurança (textContent, nunca HTML vindo do banco)
function tabela(colunas, linhas) {
  const t = document.createElement('table');
  t.className = 'admin-tabela';
  const cab = t.createTHead().insertRow();
  for (const c of colunas) {
    const th = document.createElement('th');
    th.textContent = c;
    cab.appendChild(th);
  }
  const corpo = t.createTBody();
  for (const celulas of linhas) {
    const tr = corpo.insertRow();
    for (const valor of celulas) {
      const td = tr.insertCell();
      if (valor instanceof Node) td.appendChild(valor);
      else td.textContent = valor ?? '—';
    }
  }
  if (!linhas.length) {
    const td = corpo.insertRow().insertCell();
    td.colSpan = colunas.length;
    td.textContent = 'Nada por aqui ainda.';
  }
  return t;
}

function botaoAdmin(texto, acao, classe = '') {
  const b = document.createElement('button');
  b.textContent = texto;
  b.className = classe;
  b.onclick = acao;
  return b;
}

async function acaoAdmin(caminho, corpo, confirmacao) {
  $('admin').hidden = true;
  const ok = confirmacao ? await perguntar(confirmacao, 'Confirmar', 'Cancelar') : true;
  $('admin').hidden = false;
  if (!ok) return;
  try {
    const r = await api(caminho, corpo);
    avisar(r.texto || 'Feito!');
  } catch (err) {
    avisar(err.message);
  }
  carregarAdmin();
}

async function carregarAdmin() {
  const el = $('admin-conteudo');
  document.querySelectorAll('.aba-admin').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === abaAdmin));
  el.textContent = 'Carregando...';
  try {
    if (abaAdmin === 'resumo') {
      const r = await api('/admin/resumo');
      el.innerHTML = '';
      const grade = document.createElement('div');
      grade.className = 'stats admin-stats';
      const itens = [
        [r.contas, 'contas'], [r.contas_hoje, 'contas novas (24h)'], [r.usuarios_online, 'contas online agora'],
        [r.conexoes, 'pessoas no site agora'], [r.logins_hoje, 'logins (24h)'], [r.falhas_hoje, 'logins errados (24h)'],
        [r.salas.filter((s) => s.estado === 'jogando').length, 'partidas acontecendo'], [r.partidas_hoje, 'partidas (24h)'],
        [r.partidas_total, 'partidas no total'], [r.bloqueadas, 'contas bloqueadas'],
        [r.denuncias_abertas, 'denúncias para analisar'],
      ];
      mostrarBadge(r.denuncias_abertas);
      for (const [n, rotulo] of itens) {
        const d = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = n;
        const s = document.createElement('small');
        s.textContent = rotulo;
        d.append(b, s);
        grade.appendChild(d);
      }
      el.appendChild(grade);
    } else if (abaAdmin === 'denuncias') {
      const lista = await api('/admin/denuncias');
      mostrarBadge(lista.filter((d) => d.estado === 'aberta').length);
      const MOT = { ofensa: 'Ofensa', assedio: 'Assédio/ameaça', spam: 'Spam', trapaca: 'Trapaça', outro: 'Outro' };
      const EST = { aberta: '🔴 aberta', bloqueado: '⛔ bloqueado', ignorada: '⚪ ignorada' };
      el.innerHTML = '';
      el.appendChild(tabela(
        ['Quando', 'Estado', 'Denunciado', 'Mensagem', 'Motivo', 'Detalhes', 'Quem denunciou', 'Ações'],
        lista.map((d) => {
          const acoes = document.createElement('div');
          acoes.className = 'acoes';
          if (d.estado === 'aberta') {
            if (d.denunciado_id && !d.denunciado_admin && !d.ja_bloqueado) {
              acoes.appendChild(botaoAdmin('⛔ Bloquear', () =>
                acaoAdmin('/admin/denuncias/resolver', { id: d.id, acao: 'bloquear' }, `Bloquear ${d.denunciado_nome}? A pessoa sai na hora e não consegue mais entrar.`), 'perigo'));
            }
            acoes.appendChild(botaoAdmin('Ignorar', () => acaoAdmin('/admin/denuncias/resolver', { id: d.id, acao: 'ignorar' })));
          } else {
            acoes.textContent = d.resolvido_em ? dataHora(d.resolvido_em) : '';
          }
          const quem = d.denunciado_nome + (d.denunciado_id ? '' : ' (convidado)') + (d.total_contra > 1 ? ` · ${d.total_contra} denúncias` : '');
          const msg = document.createElement('span');
          msg.className = 'msg-denunciada';
          msg.textContent = `“${d.mensagem}”`;
          return [dataHora(d.criado_em), EST[d.estado] || d.estado, quem, msg, MOT[d.motivo] || d.motivo, d.detalhes, d.denunciante_nome, acoes];
        })
      ));
    } else if (abaAdmin === 'contas') {
      el.innerHTML = '';
      const busca = document.createElement('input');
      busca.placeholder = 'Buscar por apelido ou e-mail...';
      busca.className = 'admin-busca';
      busca.value = carregarAdmin.busca || '';
      busca.onkeydown = (e) => {
        if (e.key === 'Enter') {
          carregarAdmin.busca = busca.value;
          carregarAdmin();
        }
      };
      el.appendChild(busca);
      const lista = await api('/admin/usuarios?busca=' + encodeURIComponent(carregarAdmin.busca || ''));
      el.appendChild(tabela(
        ['Apelido', 'E-mail', 'Status', 'ELO', 'Online V/E/D', 'Bot V/E/D', 'Probl.', 'Amigos', 'Criada', 'Último login', 'Ações'],
        lista.map((u) => {
          const acoes = document.createElement('div');
          acoes.className = 'acoes';
          if (!u.admin) {
            acoes.append(
              botaoAdmin(u.bloqueado ? 'Desbloquear' : 'Bloquear', () =>
                acaoAdmin('/admin/bloquear', { id: u.id, bloquear: !u.bloqueado }, u.bloqueado ? null : `Bloquear ${u.nome}? A pessoa sai na hora e não consegue mais entrar.`)),
              botaoAdmin('Nova senha', async () => {
                $('admin').hidden = true;
                const nova = prompt(`Nova senha para ${u.nome} (mínimo 6 caracteres):`);
                $('admin').hidden = false;
                if (nova) acaoAdmin('/admin/senha', { id: u.id, nova });
              }),
              botaoAdmin('Excluir', () =>
                acaoAdmin('/admin/excluir', { id: u.id }, `Excluir a conta de ${u.nome} para sempre? Isso não pode ser desfeito.`), 'perigo'),
            );
          } else {
            acoes.textContent = '👑 admin';
          }
          const status = u.bloqueado ? '⛔ bloqueada' : u.jogando ? '🟡 jogando' : u.online ? '🟢 online' : '⚪ offline';
          return [u.nome, u.email, status, eloTexto(u.elo), `${u.vitorias}/${u.empates}/${u.derrotas}`,
            `${u.bot_vitorias}/${u.bot_empates}/${u.bot_derrotas}`, u.problemas, u.amigos, dataHora(u.criado_em), dataHora(u.ultimo_login), acoes];
        })
      ));
    } else if (abaAdmin === 'logins') {
      const lista = await api('/admin/logins');
      const TIPOS = { login: 'login', cadastro: 'criou conta', 'troca-email': 'trocou e-mail', 'senha-errada': 'senha errada', 'conta-bloqueada': 'conta bloqueada', 'bloqueado-tentativas': 'muitas tentativas' };
      el.innerHTML = '';
      el.appendChild(tabela(
        ['Quando', 'Resultado', 'Conta', 'E-mail digitado', 'IP', 'Navegador'],
        lista.map((l) => [dataHora(l.quando), (l.sucesso ? '✅ ' : '❌ ') + (TIPOS[l.tipo] || l.tipo), l.nome, l.email, l.ip, l.navegador])
      ));
    } else if (abaAdmin === 'salas') {
      const lista = await api('/admin/salas');
      const nomeJ = (j) => (j ? `${j.nome}${j.conta ? '' : ' (convidado)'}${j.conectado ? '' : ' ⚠️'}` : '—');
      const ESTADOS = { esperando: '⏳ esperando', jogando: '♟️ jogando', terminada: '🏁 terminada' };
      el.innerHTML = '';
      el.appendChild(tabela(
        ['Código', 'Estado', 'Brancas', 'Pretas', 'Lances', 'Relógio'],
        lista.map((s) => [s.codigo, ESTADOS[s.estado], nomeJ(s.brancas), nomeJ(s.pretas), s.lances, s.relogio])
      ));
    } else if (abaAdmin === 'partidas') {
      const lista = await api('/admin/partidas');
      el.innerHTML = '';
      el.appendChild(tabela(
        ['Quando', 'Brancas', 'Pretas', 'Resultado', 'Motivo', 'Lances'],
        lista.map((p) => [dataHora(p.criado_em), p.branco_nome, p.preto_nome,
          p.vencedor === 'w' ? 'Brancas venceram' : p.vencedor === 'b' ? 'Pretas venceram' : 'Empate', MOTIVOS[p.motivo] || p.motivo, p.lances])
      ));
    }
  } catch (err) {
    el.textContent = err.message;
  }
}

// Número de denúncias abertas no botão Admin e na aba
function mostrarBadge(n) {
  $('admin-badge').textContent = n;
  $('admin-badge').hidden = !n;
  $('btn-admin').textContent = n ? `🛠️ Admin · 🚩${n}` : '🛠️ Admin';
}
async function atualizarBadgeAdmin() {
  if (!conta?.admin) return;
  try { mostrarBadge((await api('/admin/resumo')).denuncias_abertas); } catch { /* sem badge */ }
}

document.querySelectorAll('.aba-admin').forEach((b) => (b.onclick = () => {
  abaAdmin = b.dataset.aba;
  carregarAdmin();
}));
$('btn-admin').onclick = () => {
  $('admin').hidden = false;
  carregarAdmin();
};
$('admin-fechar').onclick = () => ($('admin').hidden = true);
$('admin-atualizar').onclick = carregarAdmin;

// Na sala de espera: botões para chamar amigos online
async function mostrarAmigosParaConvidar() {
  const el = $('convite-amigos');
  el.hidden = true;
  if (!conta) return;
  try {
    const { amigos } = await api('/amigos');
    const livres = amigos.filter((a) => a.online && !a.jogando);
    el.innerHTML = '';
    if (!livres.length) return;
    const t = document.createElement('small');
    t.textContent = 'Amigos online:';
    el.appendChild(t);
    for (const a of livres) {
      const b = document.createElement('button');
      b.textContent = `📨 ${a.nome}`;
      b.onclick = () => {
        socket.emit('convidar', a.id);
        b.disabled = true;
        b.textContent = `✓ ${a.nome}`;
      };
      el.appendChild(b);
    }
    el.hidden = false;
  } catch { /* sem amigos para mostrar */ }
}

/* ============================================================
   INÍCIO
============================================================ */
aplicarTema(guardar.ler('xadrez-tema', 'madeira'));
atualizarBotaoSom();
mostrar('menu');
await carregarConta();

// Abriu um link de convite (?sala=XXXX) ou recarregou a página no meio de uma partida
const salaDoLink = new URLSearchParams(location.search).get('sala');
if (salaDoLink) {
  const codigo = salaDoLink.trim().toUpperCase().slice(0, 4);
  let recarregou = false;
  try { recarregou = sessionStorage.getItem('xadrez-sala') === codigo; } catch { /* ok */ }
  escolherModo('online');
  $('codigo').value = codigo;
  if (recarregou || $('apelido').value.trim()) {
    entrarNaSala(codigo);
  } else {
    $('convite-recebido').hidden = false;
    $('apelido').focus();
  }
}
