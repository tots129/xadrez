import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';

/* ============================================================
   CONFIGURAÇÕES (mude aqui se quiser)
============================================================ */
const ATRASO_BOT_MS = 2000;   // tempo que o bot "pensa" antes de jogar
const ANIMACAO_MS = 300;      // duração da animação das peças

/* ============================================================
   ESTADO
============================================================ */
const GLIFOS = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const COLUNAS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const NOMES_NIVEL = { 1: 'fácil', 2: 'médio', 3: 'difícil' };
const NOMES_PECA = { q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo' };
const $ = (id) => document.getElementById(id);

let jogo = new Chess();
let modo = null;          // 'bot' | 'local' | 'online'
let minhaCor = 'w';       // 'w' ou 'b' (bot e online)
let orientacao = 'w';     // lado que fica embaixo
let selecionada = null;   // casa selecionada, ex.: 'e2'
let destinos = [];        // jogadas possíveis da peça selecionada
let ultima = null;        // última jogada { from, to }
let ativo = false;        // partida em andamento?
let pensando = false;     // bot está calculando?
let escolhendoPromocao = false;
let partidaId = 0;        // evita o bot jogar numa partida antiga
let nivel = 2;
let socket = null;

/* ============================================================
   TELAS E MENU
============================================================ */
function mostrar(tela) {
  $('menu').hidden = tela !== 'menu';
  $('jogo').hidden = tela !== 'jogo';
}

document.querySelectorAll('[data-modo]').forEach((botao) => {
  botao.onclick = () => {
    const m = botao.dataset.modo;
    document.querySelectorAll('[data-modo]').forEach((b) => b.classList.toggle('ativo', b === botao));
    $('opcoes-bot').hidden = m !== 'bot';
    $('opcoes-online').hidden = m !== 'online';
    if (m === 'local') iniciarLocal();
  };
});

$('btn-iniciar-bot').onclick = iniciarBot;
$('btn-criar').onclick = () => conectar().emit('criar-sala');
$('btn-entrar').onclick = () => {
  const codigo = $('codigo').value.trim();
  if (codigo) conectar().emit('entrar-sala', codigo);
};
$('btn-novo').onclick = () => (modo === 'bot' ? iniciarBot() : iniciarLocal());
$('btn-girar').onclick = () => {
  orientacao = orientacao === 'w' ? 'b' : 'w';
  renderizar();
};
$('btn-menu').onclick = voltarAoMenu;
$('btn-desfazer').onclick = desfazer;

function voltarAoMenu() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  partidaId++;
  ativo = false;
  pensando = false;
  mostrar('menu');
}

function prepararTelaDeJogo() {
  selecionada = null;
  destinos = [];
  ultima = null;
  pensando = false;
  partidaId++;
  $('btn-novo').hidden = modo === 'online';
  $('btn-desfazer').hidden = modo === 'online';
  $('info').textContent = '';
  mostrar('jogo');
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
  $('info').textContent = 'Dois jogadores no mesmo computador. Use "Girar tabuleiro" se quiser.';
  renderizar();
  atualizarStatus();
}

function iniciarBot() {
  modo = 'bot';
  minhaCor = $('cor-bot').value;
  nivel = Number($('nivel-bot').value);
  orientacao = minhaCor;
  jogo = new Chess();
  ativo = true;
  prepararTelaDeJogo();
  $('info').textContent = `Você joga de ${minhaCor === 'w' ? 'brancas' : 'pretas'}.`;
  renderizar();
  atualizarStatus();
  if (jogo.turn() !== minhaCor) jogarBot();
}

/* ============================================================
   TABULEIRO (desenho, animação e cliques)
============================================================ */

// Lista de peças que precisam deslizar depois de um lance (inclui a torre no roque).
// Chame DEPOIS de aplicar o lance em "jogo".
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

  // Guarda onde cada peça estava ANTES de redesenhar
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
      if (peca && peca.type === 'k' && peca.color === emXeque) div.classList.add('xeque');

      const destino = destinos.find((m) => m.to === casa);
      if (destino) {
        div.classList.add('destino');
        if (peca || destino.flags.includes('e')) div.classList.add('captura');
      }

      if (peca) {
        const span = document.createElement('span');
        span.className = 'peca ' + (peca.color === 'w' ? 'branca' : 'preta');
        span.textContent = GLIFOS[peca.type] + '︎'; // ︎ evita virar emoji
        div.appendChild(span);
      }

      // Coordenadas nas bordas
      if (c === colunas[0]) div.appendChild(coordenada(String(r), 'rank'));
      if (r === linhas[7]) div.appendChild(coordenada(COLUNAS[c], 'file'));

      div.onclick = () => aoClicar(casa);
      tab.appendChild(div);
    }
  }

  // Animação: a peça nasce na casa de origem e desliza até a casa de destino
  animacoes.forEach((a, i) => {
    const de = origens[i];
    const peca = tab.querySelector(`[data-casa="${a.to}"] .peca`);
    if (!de || !peca) return;
    const para = peca.parentElement.getBoundingClientRect();
    peca.style.transition = 'none';
    peca.style.zIndex = '20';
    peca.style.transform = `translate(${de.left - para.left}px, ${de.top - para.top}px)`;
    peca.getBoundingClientRect(); // força o navegador a aplicar o ponto de partida
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

function coordenada(texto, tipo) {
  const s = document.createElement('span');
  s.className = 'coord ' + tipo;
  s.textContent = texto;
  return s;
}

function nomeDoJogador(cor) {
  if (modo === 'bot') return cor === minhaCor ? 'Você' : `Bot (${NOMES_NIVEL[nivel]})`;
  if (modo === 'online') return cor === minhaCor ? 'Você' : 'Oponente';
  return cor === 'w' ? 'Brancas' : 'Pretas';
}

function atualizarJogadores() {
  const topo = orientacao === 'w' ? 'b' : 'w';
  for (const [id, cor] of [['jog-topo', topo], ['jog-base', orientacao]]) {
    const el = $(id);
    el.dataset.cor = cor;
    el.dataset.modo = modo;
    el.dataset.bot = modo === 'bot' && cor !== minhaCor ? '1' : '0';
    el.querySelector('.nome').textContent = nomeDoJogador(cor);
    el.classList.toggle('vez', ativo && !jogo.isGameOver() && jogo.turn() === cor);
  }
}

function minhaVez() {
  return modo === 'local' || jogo.turn() === minhaCor;
}

async function aoClicar(casa) {
  if (!ativo || pensando || escolhendoPromocao || jogo.isGameOver() || !minhaVez()) return;

  // Já tem peça selecionada e clicou num destino válido → joga
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

  // Senão, tenta selecionar uma peça da vez
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

// Janelinha bonita para escolher a peça da promoção (devolve 'q', 'r', 'b' ou 'n')
function pedirPromocao(cor) {
  return new Promise((resolve) => {
    const lista = $('promo-opcoes');
    lista.innerHTML = '';
    for (const tipo of ['q', 'r', 'b', 'n']) {
      const b = document.createElement('button');
      b.className = 'promo-btn ' + (cor === 'w' ? 'branca' : 'preta');
      b.title = NOMES_PECA[tipo];
      b.textContent = GLIFOS[tipo] + '︎';
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

  if (modo === 'online') socket.emit('jogada', { from, to, promotion });

  renderizar(animacoesDoLance(r.from, r.to));
  atualizarStatus();
  if (modo === 'bot' && !jogo.isGameOver()) jogarBot();
}

function desfazer() {
  if (pensando || modo === 'online') return;
  jogo.undo();
  if (modo === 'bot' && jogo.turn() !== minhaCor) jogo.undo(); // desfaz a jogada do bot também
  ultima = null;
  selecionada = null;
  destinos = [];
  renderizar();
  atualizarStatus();
  if (modo === 'bot' && !jogo.isGameOver() && jogo.turn() !== minhaCor) jogarBot();
}

function atualizarStatus() {
  const vez = jogo.turn() === 'w' ? 'brancas' : 'pretas';
  const vencedor = jogo.turn() === 'w' ? 'Pretas' : 'Brancas';
  let texto;

  if (jogo.isCheckmate()) texto = `Xeque-mate! ${vencedor} venceram. 🏆`;
  else if (jogo.isStalemate()) texto = 'Empate por afogamento.';
  else if (jogo.isThreefoldRepetition()) texto = 'Empate por repetição de posição.';
  else if (jogo.isInsufficientMaterial()) texto = 'Empate por material insuficiente.';
  else if (jogo.isDraw()) texto = 'Empate.';
  else {
    texto = `Vez das ${vez}.` + (jogo.inCheck() ? ' Xeque!' : '');
    if (modo === 'online' && jogo.turn() === minhaCor) texto = 'Sua vez! ' + (jogo.inCheck() ? 'Xeque!' : '');
    if (modo === 'online' && jogo.turn() !== minhaCor) texto = 'Aguardando o oponente...';
  }
  $('status').textContent = texto;
  $('status').className = jogo.isGameOver() ? 'fim' : '';
  atualizarHistorico();
  atualizarJogadores();
}

function atualizarHistorico() {
  const el = $('historico');
  const lances = modo === 'online' ? [] : jogo.history(); // online reconstrói o jogo a cada lance
  el.hidden = lances.length === 0;
  let html = '';
  for (let i = 0; i < lances.length; i += 2) {
    html += `<span class="n">${i / 2 + 1}.</span><span class="l">${lances[i]}</span>`;
    if (lances[i + 1]) html += `<span class="l">${lances[i + 1]}</span>`;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

/* ============================================================
   BOT (minimax com poda alfa-beta)
============================================================ */
const VALOR = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Pontuação positiva = vantagem das brancas
function avaliar(g) {
  let total = 0;
  const tab = g.board();
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const p = tab[i][j];
      if (!p) continue;
      let v = VALOR[p.type];
      const centro = 3.5 - Math.abs(3.5 - j) + (3.5 - Math.abs(3.5 - i)); // quanto mais ao centro, maior
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
  // Capturas e xeques primeiro → poda mais cortes
  const peso = (m) => (m.includes('x') ? 2 : 0) + (m.includes('+') ? 1 : 0);
  return jogadas.sort((a, b) => peso(b) - peso(a));
}

function minimax(g, profundidade, alfa, beta) {
  const jogadas = g.moves();
  if (jogadas.length === 0) {
    if (!g.inCheck()) return 0; // afogamento
    return g.turn() === 'w' ? -100000 - profundidade : 100000 + profundidade; // xeque-mate
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

function jogarBot() {
  const id = partidaId;
  const inicio = Date.now();
  pensando = true;
  $('status').textContent = 'Bot pensando... 🤔';
  $('status').className = 'pensando';
  atualizarJogadores();

  // O pequeno atraso deixa o navegador mostrar "pensando" antes do cálculo pesado
  setTimeout(() => {
    if (id !== partidaId) return; // partida foi reiniciada enquanto pensava
    const san = escolherJogadaDoBot(jogo, nivel);

    // Espera o que faltar para completar ATRASO_BOT_MS no total
    const resto = Math.max(0, ATRASO_BOT_MS - (Date.now() - inicio));
    setTimeout(() => {
      if (id !== partidaId) return;
      const r = jogo.move(san);
      ultima = { from: r.from, to: r.to };
      pensando = false;
      renderizar(animacoesDoLance(r.from, r.to));
      atualizarStatus();
    }, resto);
  }, 60);
}

/* ============================================================
   ONLINE (Socket.IO)
============================================================ */
function conectar() {
  if (socket) return socket;
  socket = io();

  socket.on('sala-criada', ({ codigo, cor }) => {
    modo = 'online';
    minhaCor = cor;
    orientacao = cor;
    jogo = new Chess();
    ativo = false;
    prepararTelaDeJogo();
    $('info').textContent = `Código da sala: ${codigo} — passe para seu amigo. Você joga de ${cor === 'w' ? 'brancas' : 'pretas'}.`;
    renderizar();
    atualizarHistorico();
    $('status').textContent = 'Aguardando o oponente entrar...';
    $('status').className = '';
  });

  socket.on('sala-entrada', ({ codigo, cor }) => {
    modo = 'online';
    minhaCor = cor;
    orientacao = cor;
    jogo = new Chess();
    ativo = false;
    prepararTelaDeJogo();
    $('info').textContent = `Sala ${codigo} — você joga de ${cor === 'w' ? 'brancas' : 'pretas'}.`;
    renderizar();
    atualizarHistorico();
  });

  socket.on('inicio', ({ fen }) => {
    jogo = new Chess(fen);
    ativo = true;
    ultima = null;
    renderizar();
    atualizarStatus();
  });

  socket.on('estado', ({ fen, ultima: u }) => {
    // O servidor repete a minha própria jogada: já está na tela, não redesenha
    // (redesenhar cortaria a animação no meio).
    if (fen === jogo.fen()) {
      atualizarStatus();
      return;
    }
    jogo = new Chess(fen);
    if (u) ultima = u;
    selecionada = null;
    destinos = [];
    // Anima só quando foi o oponente que jogou (agora é a minha vez)
    const animar = u && jogo.turn() === minhaCor ? animacoesDoLance(u.from, u.to) : [];
    renderizar(animar);
    atualizarStatus();
  });

  socket.on('oponente-saiu', () => {
    ativo = false;
    $('status').textContent = 'Seu oponente saiu da partida.';
    $('status').className = 'fim';
    atualizarJogadores();
  });

  socket.on('erro-sala', (mensagem) => alert(mensagem));

  return socket;
}

mostrar('menu');
