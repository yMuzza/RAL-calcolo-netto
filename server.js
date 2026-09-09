'use strict';

/**
 * Back-end minimo, zero dipendenze esterne.
 * - Serve la UI statica da /public
 * - Espone POST /api/calcola come unico punto di contatto con il motore
 *   di calcolo puro (calcolo.js): il front-end non importa mai calcolo.js
 *   direttamente, cosi' front-end e back-end restano disaccoppiati e
 *   testabili separatamente.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { calcolaNetto } = require('./calcolo');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const MAX_BODY_BYTES = 10 * 1024; // richiesta minuscola per design: RAL + poche opzioni

function inviaJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function leggiBody(req, callback) {
  let ricevuto = 0;
  const chunks = [];

  req.on('data', (chunk) => {
    ricevuto += chunk.length;
    if (ricevuto > MAX_BODY_BYTES) {
      req.destroy();
      callback(new Error('Richiesta troppo grande'));
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      callback(null, JSON.parse(raw));
    } catch (err) {
      callback(new Error('JSON non valido nel corpo della richiesta'));
    }
  });

  req.on('error', callback);
}

function gestisciApiCalcola(req, res) {
  leggiBody(req, (err, body) => {
    if (err) {
      inviaJson(res, 400, { error: err.message });
      return;
    }

    const ral = Number(body.ral);
    const opzioniInput = body.opzioni && typeof body.opzioni === 'object' ? body.opzioni : {};

    // Whitelist esplicita delle opzioni accettate dal client: il motore
    // riceve solo cio' che dichiara di supportare (mensilita, aliquota
    // INPS over 50 dipendenti). Niente altro passa dal front-end al motore.
    const opzioni = {};
    if (opzioniInput.mensilita !== undefined) opzioni.mensilita = Number(opzioniInput.mensilita);
    if (opzioniInput.aziendaOver50Dipendenti !== undefined) {
      opzioni.aziendaOver50Dipendenti = Boolean(opzioniInput.aziendaOver50Dipendenti);
    }

    try {
      const risultato = calcolaNetto(ral, opzioni);
      inviaJson(res, 200, risultato);
    } catch (calcError) {
      // calcolaNetto lancia errori descrittivi per input non validi
      // (RAL negativa, mensilita non ammessa): li restituiamo cosi' come
      // sono, sono gia' messaggi adatti a un utente.
      inviaJson(res, 400, { error: calcError.message });
    }
  });
}

function serviFileStatico(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const richiesto = urlPath === '/' ? '/index.html' : urlPath;

  // Risolve dentro PUBLIC_DIR e verifica che il path finale resti li'
  // dentro, per evitare path traversal (es. /../server.js).
  const percorsoAssoluto = path.normalize(path.join(PUBLIC_DIR, richiesto));
  if (!percorsoAssoluto.startsWith(PUBLIC_DIR)) {
    inviaJson(res, 403, { error: 'Accesso negato' });
    return;
  }

  fs.readFile(percorsoAssoluto, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Non trovato');
      return;
    }
    const ext = path.extname(percorsoAssoluto);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': data.length,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/calcola') {
    gestisciApiCalcola(req, res);
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/')) {
    inviaJson(res, 404, { error: 'Endpoint non trovato' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serviFileStatico(req, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Metodo non consentito');
});

/**
 * Elenca gli indirizzi IPv4 della macchina sulla rete locale, cosi' da
 * stampare all'avvio un indirizzo apribile anche da telefono o tablet
 * collegati alla stessa rete Wi-Fi.
 */
function indirizziDiRete() {
  const interfacce = os.networkInterfaces();
  const indirizzi = [];
  for (const nome of Object.keys(interfacce)) {
    for (const dettaglio of interfacce[nome] || []) {
      if (dettaglio.family === 'IPv4' && !dettaglio.internal) {
        indirizzi.push(dettaglio.address);
      }
    }
  }
  return indirizzi;
}

if (require.main === module) {
  // '0.0.0.0' = accetta connessioni da qualunque interfaccia, non solo
  // da questo computer: e' cio' che permette di aprire il sito dal telefono.
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  Sito avviato. Aprilo qui:\n');
    console.log(`    Su questo computer:      http://localhost:${PORT}`);
    for (const ip of indirizziDiRete()) {
      console.log(`    Da telefono o tablet:    http://${ip}:${PORT}   (stessa rete Wi-Fi)`);
    }
    console.log('\n  Per fermare il server: premi Ctrl+C in questa finestra.\n');
  });
}

module.exports = { server };
