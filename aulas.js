// Aulas curtas para quem está começando.
// Cada aula tem blocos: { texto }, { tabuleiro: { fen, casa?, legenda } } (mostra os lances da peça na "casa")
// ou { abertura: { nome, lances } } (abre a abertura no replay, lance a lance).
export const AULAS = [
  {
    icone: '♟️',
    titulo: 'Como cada peça anda',
    blocos: [
      { texto: 'O xadrez tem 6 tipos de peça. Os pontinhos mostram para onde cada uma pode ir. Uma peça captura indo para a casa de uma peça inimiga.' },
      { tabuleiro: { fen: '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1', casa: 'd4', legenda: '♜ Torre: anda em linha reta (para frente, para trás e para os lados), quantas casas quiser.' } },
      { tabuleiro: { fen: '4k3/8/8/8/3B4/8/8/4K3 w - - 0 1', casa: 'd4', legenda: '♝ Bispo: anda na diagonal, quantas casas quiser. Fica sempre na mesma cor de casa.' } },
      { tabuleiro: { fen: '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1', casa: 'd4', legenda: '♛ Dama: a peça mais forte. Anda como torre E como bispo juntos.' } },
      { tabuleiro: { fen: '4k3/8/8/8/3N4/8/8/4K3 w - - 0 1', casa: 'd4', legenda: '♞ Cavalo: anda em "L" (2 casas para um lado e 1 para o outro). É a única peça que PULA por cima das outras.' } },
      { tabuleiro: { fen: '8/8/8/3k4/8/8/8/4K3 w - - 0 1', casa: 'e1', legenda: '♚ Rei: anda 1 casa para qualquer lado. Nunca pode ir para uma casa atacada.' } },
      { tabuleiro: { fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', casa: 'e2', legenda: '♟ Peão: anda 1 casa para frente (ou 2 na primeira jogada). Captura na diagonal, 1 casa à frente.' } },
    ],
  },
  {
    icone: '🏰',
    titulo: 'Roque',
    blocos: [
      { texto: 'O roque é um lance especial que protege o rei e coloca a torre em jogo. O rei anda 2 casas para o lado da torre, e a torre pula para o outro lado do rei.' },
      { texto: 'Só pode rocar se: o rei e essa torre nunca se mexeram; não há peças entre eles; o rei NÃO está em xeque; e o rei não passa nem para em casa atacada.' },
      { tabuleiro: { fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', casa: 'e1', legenda: 'Aqui as brancas podem rocar: clique no rei e depois em g1 (roque pequeno).' } },
    ],
  },
  {
    icone: '👻',
    titulo: 'En passant',
    blocos: [
      { texto: 'Quando um peão anda 2 casas de uma vez e para AO LADO de um peão inimigo, esse peão inimigo pode capturá-lo "de passagem", como se ele tivesse andado só 1 casa.' },
      { texto: 'Atenção: isso só vale no lance logo em seguida. Se não capturar na hora, perde a chance.' },
      { tabuleiro: { fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', casa: 'e5', legenda: 'As pretas acabaram de jogar d7-d5. O peão branco em e5 pode capturar en passant indo para d6.' } },
    ],
  },
  {
    icone: '👑',
    titulo: 'Promoção',
    blocos: [
      { texto: 'Quando um peão chega na última fileira do outro lado, ele vira a peça que você quiser (menos rei e peão). Quase sempre escolhemos a dama, a peça mais forte.' },
      { tabuleiro: { fen: '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', casa: 'b7', legenda: 'O peão em b7 vai para b8 e vira dama (ou torre, bispo ou cavalo).' } },
    ],
  },
  {
    icone: '⚔️',
    titulo: 'Xeque, xeque-mate e afogamento',
    blocos: [
      { texto: 'Xeque: o rei está sendo atacado. Você é OBRIGADO a tirar o rei do ataque (fugindo, bloqueando ou capturando a peça que ataca).' },
      { texto: 'Xeque-mate: o rei está em xeque e não tem como escapar. Fim de jogo: quem deu o mate venceu!' },
      { tabuleiro: { fen: 'R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1', legenda: 'Xeque-mate! A torre ataca o rei e os próprios peões das pretas bloqueiam a fuga (o famoso "mate do corredor").' } },
      { texto: 'Afogamento: o jogador da vez NÃO está em xeque, mas não tem nenhum lance permitido. Aí é EMPATE. Cuidado para não afogar quando estiver ganhando!' },
      { tabuleiro: { fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', legenda: 'Afogamento: é a vez das pretas, o rei não está em xeque, mas todas as casas estão atacadas. Empate!' } },
    ],
  },
  {
    icone: '💰',
    titulo: 'Quanto vale cada peça',
    blocos: [
      { texto: 'Para saber se uma troca é boa, use estes valores aproximados: Peão = 1 · Cavalo = 3 · Bispo = 3 · Torre = 5 · Dama = 9. O rei não tem valor: perder o rei é perder o jogo.' },
      { texto: 'Exemplo: trocar seu cavalo (3) pela torre dele (5) é bom para você. Trocar sua dama (9) por uma torre (5) é ruim.' },
      { texto: 'No jogo, o número "+3" ao lado do nome mostra quantos pontos de material você tem a mais.' },
    ],
  },
  {
    icone: '🧭',
    titulo: 'Dicas para a abertura',
    blocos: [
      { texto: '1. Controle o centro: jogue peões em e4/d4 (ou e5/d5) logo no começo.' },
      { texto: '2. Desenvolva as peças: tire cavalos e bispos de casa antes de mexer muito em peões.' },
      { texto: '3. Proteja o rei: faça o roque cedo.' },
      { texto: '4. Não saia com a dama cedo demais: ela vira alvo e você perde tempo fugindo.' },
      { texto: '5. Não mova a mesma peça várias vezes sem motivo, e não entregue peças de graça.' },
      { texto: 'Cuidado com o Mate do Pastor! Veja como ele acontece (e lembre: defender f7 com o cavalo em f6 ou a dama em e7 resolve):' },
      { abertura: { nome: 'Mate do Pastor (armadilha)', lances: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'] } },
    ],
  },
  {
    icone: '📖',
    titulo: 'Aberturas famosas',
    blocos: [
      { texto: 'Clique numa abertura para ver os lances no tabuleiro, um por um.' },
      { abertura: { nome: 'Abertura Italiana', lances: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6'] } },
      { abertura: { nome: 'Ruy Lopez (Abertura Espanhola)', lances: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'] } },
      { abertura: { nome: 'Defesa Siciliana', lances: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'] } },
      { abertura: { nome: 'Defesa Francesa', lances: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'Bg5'] } },
      { abertura: { nome: 'Defesa Caro-Kann', lances: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'] } },
      { abertura: { nome: 'Gambito da Dama', lances: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5'] } },
      { abertura: { nome: 'Defesa Índia do Rei', lances: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6'] } },
      { abertura: { nome: 'Abertura Inglesa', lances: ['c4', 'e5', 'Nc3', 'Nf6', 'g3', 'd5'] } },
    ],
  },
];
