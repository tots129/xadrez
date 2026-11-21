// Banco de dados (Postgres no Neon).
// O endereço do banco vem da variável de ambiente DATABASE_URL, configurada no Render.
// Sem DATABASE_URL (rodando no seu computador), usa um banco de teste em memória, se estiver instalado.

let executar = null;
export let tipoBanco = 'nenhum';

if (process.env.DATABASE_URL) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  pool.on('error', (e) => console.error('Erro no banco:', e.message));
  executar = (texto, params) => pool.query(texto, params);
  tipoBanco = 'postgres';
} else if (process.env.RENDER) {
  // No Render sem DATABASE_URL: não inventa um banco temporário (as contas sumiriam)
  console.warn('DATABASE_URL não configurada no Render: contas desativadas.');
} else {
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    executar = (texto, params) => db.query(texto, params);
    tipoBanco = 'teste (memória)';
  } catch {
    console.warn('Sem DATABASE_URL: contas desativadas.');
  }
}

export const bancoAtivo = () => executar !== null;

export async function q(texto, params = []) {
  if (!executar) throw new Error('Banco de dados não configurado');
  const r = await executar(texto, params);
  return r.rows;
}

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    senha_hash TEXT NOT NULL,
    elo REAL NOT NULL DEFAULT 1200,
    vitorias INT NOT NULL DEFAULT 0,
    derrotas INT NOT NULL DEFAULT 0,
    empates INT NOT NULL DEFAULT 0,
    bot_vitorias INT NOT NULL DEFAULT 0,
    bot_derrotas INT NOT NULL DEFAULT 0,
    bot_empates INT NOT NULL DEFAULT 0,
    problemas INT[] NOT NULL DEFAULT '{}',
    tema TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS usuarios_nome_idx ON usuarios (lower(nome))`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_idx ON usuarios (lower(email))`,
  // Todo mundo começa com 1700 de ELO (contas que ainda não jogaram online também sobem para 1700)
  `ALTER TABLE usuarios ALTER COLUMN elo SET DEFAULT 1700`,
  `UPDATE usuarios SET elo = 1700 WHERE elo = 1200 AND vitorias + derrotas + empates = 0`,
  `CREATE TABLE IF NOT EXISTS denuncias (
    id SERIAL PRIMARY KEY,
    denunciante_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    denunciante_nome TEXT NOT NULL,
    denunciado_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    denunciado_nome TEXT NOT NULL,
    mensagem TEXT NOT NULL,
    motivo TEXT NOT NULL,
    detalhes TEXT,
    sala TEXT,
    estado TEXT NOT NULL DEFAULT 'aberta',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolvido_em TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS logins (
    id SERIAL PRIMARY KEY,
    usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
    email TEXT,
    sucesso BOOLEAN NOT NULL,
    tipo TEXT NOT NULL,
    ip TEXT,
    navegador TEXT,
    quando TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessoes (
    token TEXT PRIMARY KEY,
    usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS amizades (
    de INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    para INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    aceita BOOLEAN NOT NULL DEFAULT false,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (de, para)
  )`,
  `CREATE TABLE IF NOT EXISTS partidas (
    id SERIAL PRIMARY KEY,
    branco INT REFERENCES usuarios(id) ON DELETE SET NULL,
    preto INT REFERENCES usuarios(id) ON DELETE SET NULL,
    branco_nome TEXT NOT NULL,
    preto_nome TEXT NOT NULL,
    vencedor TEXT,
    motivo TEXT NOT NULL,
    lances INT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

// Mudanças que devem rodar UMA vez só (ficam anotadas na tabela "migracoes")
const MIGRACOES = [
  // Pedido do dono: todas as contas existentes voltam para 1700 de ELO (vitórias/derrotas continuam salvas)
  ['elo-1700-todas-as-contas', 'UPDATE usuarios SET elo = 1700'],
];

export async function prepararBanco() {
  if (!executar) return;
  for (const comando of ESQUEMA) await q(comando);
  await q('CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, feita_em TIMESTAMPTZ NOT NULL DEFAULT now())');
  for (const [nome, comando] of MIGRACOES) {
    const feita = await q('SELECT 1 FROM migracoes WHERE nome = $1', [nome]);
    if (feita.length) continue;
    await q(comando);
    await q('INSERT INTO migracoes (nome) VALUES ($1)', [nome]);
    console.log(`Migração feita: ${nome}`);
  }
  await q('DELETE FROM sessoes WHERE expira_em < now()');
  await q("DELETE FROM logins WHERE quando < now() - interval '90 days'"); // guarda só 90 dias
  console.log(`Banco de dados pronto (${tipoBanco}).`);
}
