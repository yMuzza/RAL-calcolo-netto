'use strict';

/**
 * Test manuale del motore di calcolo (punto 2 della scaletta operativa).
 * Esegue calcolaNetto() su tutti i casi_di_test presenti in rules-2026.json
 * e stampa il breakdown per ciascuno, cosi' da poter validare l'ordine di
 * grandezza prima di costruire qualunque UI.
 *
 * Uso (dalla root del progetto): node test/test.js
 */

const path = require('path');
const fs = require('fs');
const { calcolaNetto } = require('../calcolo');

const regole = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules-2026.json'), 'utf8'));

function euro(n) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

console.log(`Casi di test (${regole.casi_di_test.length}) - anno imposta ${regole.meta.anno_imposta}\n`);

const risultati = [];

for (const caso of regole.casi_di_test) {
  const r = calcolaNetto(caso.ral, {});
  risultati.push({ ral: caso.ral, nota: caso.nota, risultato: r });

  console.log(`RAL ${euro(caso.ral)} - ${caso.nota}`);
  console.log(`  Contributi INPS:            ${euro(r.contributiInps.totale)}`);
  console.log(`  Somma esente cuneo:         ${euro(r.sommaEsenteCuneo.importo)}`);
  console.log(`  Imponibile fiscale:         ${euro(r.imponibileFiscale)}`);
  console.log(`  IRPEF lorda:                ${euro(r.irpefLorda.totale)}`);
  console.log(`  Detrazione lav. dipendente: ${euro(r.detrazioneLavoroDipendente.totale)}`);
  console.log(`  Detrazione cuneo:           ${euro(r.detrazioneCuneo.importo)}`);
  console.log(`  IRPEF netta:                ${euro(r.irpefNetta)}`);
  console.log(`  Trattamento integrativo:    ${euro(r.trattamentoIntegrativo.importo)}`);
  console.log(`  Addizionale regionale:      ${euro(r.addizionaleRegionale.totale)}`);
  console.log(`  Addizionale comunale:       ${euro(r.addizionaleComunale.importo)} ${r.addizionaleComunale.esente ? '(esente)' : ''}`);
  console.log(`  => NETTO ANNUO:             ${euro(r.nettoAnnuo)}`);
  console.log(`  => NETTO MENSILE (x${r.mensilita}):    ${euro(r.nettoMensile)}`);
  console.log('');
}

// Sanity check: il netto deve sempre crescere (o restare uguale) al crescere della RAL,
// tranne nei punti di salto noti e dichiarati (es. 49.999 -> 50.001, azzeramento detrazione).
console.log('--- Controlli di coerenza ---');
for (let i = 1; i < risultati.length; i++) {
  const prev = risultati[i - 1];
  const curr = risultati[i];
  if (curr.ral > prev.ral && curr.risultato.nettoAnnuo < prev.risultato.nettoAnnuo) {
    console.log(`ATTENZIONE: netto annuo scende passando da RAL ${prev.ral} a RAL ${curr.ral} (${euro(prev.risultato.nettoAnnuo)} -> ${euro(curr.risultato.nettoAnnuo)})`);
  }
}

// Output machine-readable per confronto esterno
fs.writeFileSync(
  path.join(__dirname, 'test-results.json'),
  JSON.stringify(risultati.map((r) => ({
    ral: r.ral,
    nota: r.nota,
    nettoAnnuo: Math.round(r.risultato.nettoAnnuo * 100) / 100,
    nettoMensile: Math.round(r.risultato.nettoMensile * 100) / 100,
    mensilita: r.risultato.mensilita,
  })), null, 2)
);
console.log('\nRisultati salvati anche in test-results.json');
