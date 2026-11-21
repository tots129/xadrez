// Filtro de palavrões do chat e das mensagens privadas.
// Troca a palavra por asteriscos (ex.: "p****"). Entende acento, maiúsculas, letras repetidas e números no lugar de letras.

// Palavras inteiras
const PALAVRAS = new Set([
  'porra', 'prr', 'caralho', 'krl', 'crl', 'merda', 'mrd', 'bosta', 'puta', 'puto', 'putaria', 'putinha',
  'foda', 'fodase', 'foder', 'fdp', 'vsf', 'vtnc', 'tnc', 'pqp', 'cu', 'cuzao', 'buceta', 'piroca',
  'viado', 'veado', 'bicha', 'otario', 'otaria', 'babaca', 'arrombado', 'arrombada', 'desgraca', 'desgracado',
  'desgracada', 'imbecil', 'retardado', 'retardada', 'corno', 'cacete', 'xoxota', 'xereca', 'punheta', 'vagabundo',
  'vagabunda', 'piranha', 'vadia', 'escroto', 'escrota', 'filhodaputa', 'fudido', 'fudida', 'fuder',
  'fuck', 'fucking', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'nigger', 'nigga', 'faggot', 'motherfucker',
]);
// Começos de palavra (pega as variações: "fodido", "caralhada", "arrombadinho"...)
const COMECOS = ['fod', 'fud', 'caralh', 'arromb', 'desgrac', 'merd', 'bucet', 'punhet', 'viadin', 'putari', 'fuck', 'filhodaput'];

const TROCA = { 4: 'a', '@': 'a', 3: 'e', 1: 'i', '!': 'i', 0: 'o', 5: 's', $: 's', 7: 't' };

function normalizar(palavra) {
  return palavra
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .replace(/[4@310!5$7]/g, (c) => TROCA[c])
    .replace(/(.)\1+/g, '$1'); // "porrrraaa" -> "pora"
}
// Compara tudo na forma "normalizada" (sem acento e com letras repetidas juntadas):
// assim "porra", "PORRAAA" e "p0rr4" viram todas "pora".
const PALAVRAS_N = new Set([...PALAVRAS].map(normalizar));
const COMECOS_N = COMECOS.map(normalizar);
function proibida(palavra) {
  const p = normalizar(palavra);
  return PALAVRAS_N.has(p) || COMECOS_N.some((c) => p.startsWith(c));
}

export function filtrarTexto(texto) {
  return String(texto).replace(/[\p{L}\d@$!]+/gu, (palavra) =>
    proibida(palavra) ? palavra[0] + '*'.repeat(Math.max(2, palavra.length - 1)) : palavra);
}
