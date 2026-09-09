'use strict';

/**
 * Test di integrazione front-end <-> back-end.
 * Non testa la UI in senso stretto (nessun browser), ma verifica che il
 * "contratto" tra le due parti funzioni davvero quando sono unite:
 * - il server serve i file statici della UI
 * - l'endpoint POST /api/calcola risponde con la stessa forma/valori del
 *   motore chiamato direttamente (calcolo.js)
 * - gli errori di input arrivano al client come JSON con status code corretto
 *
 * Richiede il server in esecuzione: node server.js (porta di default 3000,
 * sovrascrivibile con BASE_URL).
 *
 * Uso (dalla root del progetto): node test/test-integration.js
 */

const fs = require('fs');
const path = require('path');
const { calcolaNetto } = require('../calcolo');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const regole = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules-2026.json'), 'utf8'));

let passati = 0;
let falliti = 0;

function assert(condizione, descrizione) {
  if (condizione) {
    passati++;
    console.log(`  OK   ${descrizione}`);
  } else {
    falliti++;
    console.log(`  FAIL ${descrizione}`);
  }
}

async function testFileStatici() {
  console.log('\n--- File statici ---');

  const home = await fetch(`${BASE_URL}/`);
  assert(home.status === 200, 'GET / -> 200');
  assert((home.headers.get('content-type') || '').includes('text/html'), 'GET / -> Content-Type text/html');
  const homeBody = await home.text();
  assert(homeBody.includes('<form id="form-calcolo">'.slice(0, 10)), 'GET / -> contiene il markup del form');

  const css = await fetch(`${BASE_URL}/styles.css`);
  assert(css.status === 200, 'GET /styles.css -> 200');
  assert((css.headers.get('content-type') || '').includes('text/css'), 'GET /styles.css -> Content-Type text/css');

  const js = await fetch(`${BASE_URL}/app.js`);
  assert(js.status === 200, 'GET /app.js -> 200');
  assert((js.headers.get('content-type') || '').includes('javascript'), 'GET /app.js -> Content-Type javascript');

  const mancante = await fetch(`${BASE_URL}/non-esiste.html`);
  assert(mancante.status === 404, 'GET /non-esiste.html -> 404');

  const traversal = await fetch(`${BASE_URL}/../server.js`);
  assert(traversal.status === 404 || traversal.status === 403, 'GET /../server.js -> bloccato (403/404), niente path traversal');
}

async function testApiCasiDiTest() {
  console.log('\n--- POST /api/calcola sui 9 casi_di_test (confronto con calcolo.js diretto) ---');

  for (const caso of regole.casi_di_test) {
    const atteso = calcolaNetto(caso.ral, {});

    const res = await fetch(`${BASE_URL}/api/calcola`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ral: caso.ral, opzioni: {} }),
    });
    const ottenuto = await res.json();

    const statusOk = res.status === 200;
    const nettoOk = statusOk && Math.abs(ottenuto.nettoAnnuo - atteso.nettoAnnuo) < 0.005;
    const mensileOk = statusOk && Math.abs(ottenuto.nettoMensile - atteso.nettoMensile) < 0.005;

    assert(statusOk, `RAL ${caso.ral} -> HTTP 200`);
    assert(nettoOk, `RAL ${caso.ral} -> nettoAnnuo API (${ottenuto.nettoAnnuo}) === diretto (${atteso.nettoAnnuo})`);
    assert(mensileOk, `RAL ${caso.ral} -> nettoMensile API (${ottenuto.nettoMensile}) === diretto (${atteso.nettoMensile})`);
  }
}

async function testOpzioni() {
  console.log('\n--- Opzioni passate dal client (mensilita, aliquota INPS) ---');

  const res14 = await fetch(`${BASE_URL}/api/calcola`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ral: 35000, opzioni: { mensilita: 14 } }),
  });
  const data14 = await res14.json();
  assert(data14.mensilita === 14, 'mensilita=14 viene rispettata nella risposta');
  assert(Math.abs(data14.nettoMensile - data14.nettoAnnuo / 14) < 0.01, 'nettoMensile = nettoAnnuo / 14');

  const resOver50 = await fetch(`${BASE_URL}/api/calcola`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ral: 35000, opzioni: { aziendaOver50Dipendenti: true } }),
  });
  const dataOver50 = await resOver50.json();
  assert(dataOver50.contributiInps.aliquotaApplicata === regole.previdenza.aliquota_alternativa_over50_dipendenti, 'aziendaOver50Dipendenti=true applica l\'aliquota INPS 9,49%');
}

async function testErrori() {
  console.log('\n--- Gestione errori ---');

  const ralNegativa = await fetch(`${BASE_URL}/api/calcola`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ral: -100, opzioni: {} }),
  });
  assert(ralNegativa.status === 400, 'RAL negativa -> 400');
  const bodyRalNegativa = await ralNegativa.json();
  assert(typeof bodyRalNegativa.error === 'string' && bodyRalNegativa.error.length > 0, 'RAL negativa -> messaggio di errore presente');

  const mensilitaInvalida = await fetch(`${BASE_URL}/api/calcola`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ral: 35000, opzioni: { mensilita: 15 } }),
  });
  assert(mensilitaInvalida.status === 400, 'mensilita=15 (non ammessa) -> 400');

  const jsonRotto = await fetch(`${BASE_URL}/api/calcola`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ral: 35000 questo non e json valido',
  });
  assert(jsonRotto.status === 400, 'body JSON non valido -> 400');

  const metodoSbagliato = await fetch(`${BASE_URL}/api/calcola`, { method: 'GET' });
  assert(metodoSbagliato.status === 404, 'GET /api/calcola (metodo sbagliato) -> 404');

  const ralMancante = await fetch(`${BASE_URL}/api/calcola`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opzioni: {} }),
  });
  assert(ralMancante.status === 400, 'RAL mancante nel body -> 400');
}

async function main() {
  console.log(`Test di integrazione contro ${BASE_URL}`);
  try {
    await testFileStatici();
    await testApiCasiDiTest();
    await testOpzioni();
    await testErrori();
  } catch (err) {
    console.error('\nERRORE durante i test (server irraggiungibile?):', err.message);
    process.exit(1);
  }

  console.log(`\n--- Riepilogo: ${passati} passati, ${falliti} falliti ---`);
  process.exit(falliti > 0 ? 1 : 0);
}

main();
