import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Só estes arquivos ficam públicos (o server.js, por exemplo, não).
const ARQUIVOS_PUBLICOS = ['index.html', 'style.css', 'app.js'];

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:arquivo', (req, res, next) => {
  if (ARQUIVOS_PUBLICOS.includes(req.params.arquivo)) {
    return res.sendFile(path.join(__dirname, req.params.arquivo));
  }
  next();
});

// codigo -> { chess, jogadores: { w: socketId, b: socketId } }
const salas = new Map();

function gerarCodigo() {
  let codigo;
  do {
    codigo = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (salas.has(codigo));
  return codigo;
}

io.on('connection', (socket) => {
  socket.on('criar-sala', () => {
    const codigo = gerarCodigo();
    const cor = Math.random() < 0.5 ? 'w' : 'b';
    salas.set(codigo, { chess: new Chess(), jogadores: { [cor]: socket.id } });
    socket.join(codigo);
    socket.data.sala = codigo;
    socket.data.cor = cor;
    socket.emit('sala-criada', { codigo, cor });
  });

  socket.on('entrar-sala', (codigoBruto) => {
    const codigo = String(codigoBruto || '').trim().toUpperCase();
    const sala = salas.get(codigo);
    if (!sala) return socket.emit('erro-sala', 'Sala não encontrada.');
    if (sala.jogadores.w && sala.jogadores.b) {
      return socket.emit('erro-sala', 'Essa sala já está cheia.');
    }
    const cor = sala.jogadores.w ? 'b' : 'w';
    sala.jogadores[cor] = socket.id;
    socket.join(codigo);
    socket.data.sala = codigo;
    socket.data.cor = cor;
    socket.emit('sala-entrada', { codigo, cor });
    io.to(codigo).emit('inicio', { fen: sala.chess.fen() });
  });

  socket.on('jogada', ({ from, to, promotion } = {}) => {
    const codigo = socket.data.sala;
    const sala = salas.get(codigo);
    if (!sala || !(sala.jogadores.w && sala.jogadores.b)) return;

    // O servidor é quem manda: valida a vez e a legalidade da jogada.
    let jogada = null;
    if (sala.chess.turn() === socket.data.cor) {
      try {
        jogada = sala.chess.move({ from, to, promotion });
      } catch {
        jogada = null;
      }
    }
    io.to(codigo).emit('estado', {
      fen: sala.chess.fen(),
      ultima: jogada ? { from: jogada.from, to: jogada.to } : null,
    });
  });

  socket.on('disconnect', () => {
    const codigo = socket.data.sala;
    if (!codigo) return;
    socket.to(codigo).emit('oponente-saiu');
    salas.delete(codigo);
  });
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
  console.log(`Xadrez rodando em http://localhost:${PORTA}`);
});
