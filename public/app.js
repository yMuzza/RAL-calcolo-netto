'use strict';

/**
 * Front-end: nessuna logica di calcolo qui dentro. L'unica cosa che fa
 * questo file e' raccogliere l'input, chiamare POST /api/calcola e
 * disegnare la risposta come cascata + totali. Se calcolo.js cambia,
 * questo file non deve cambiare (finche' la forma della risposta resta
 * la stessa).
 */

const form = document.getElementById('form-calcolo');
const inputRal = document.getElementById('input-ral');
const inputMensilita = document.getElementById('input-mensilita');
const inputOver50 = document.getElementById('input-over50');
const btnCalcola = document.getElementById('btn-calcola');
const messaggioErrore = document.getElementById('messaggio-errore');
const risultatoSection = document.getElementById('risultato');
const cascataEl = document.getElementById('cascata');
const nettoAnnuoEl = document.getElementById('netto-annuo');
const nettoMensileEl = document.getElementById('netto-mensile');
const nettoMensilitaLabel = document.getElementById('netto-mensilita-label');
const btnToggleWaterfall = document.getElementById('btn-toggle-waterfall');
const waterfallContainer = document.getElementById('waterfall-container');
const waterfallSvg = document.getElementById('waterfall-svg');

const formatEuro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function euro(n) {
  return formatEuro.format(n);
}

/* ------------------------------------------------------------------
 * Formattazione del campo RAL
 *
 * Il campo e' un <input type="text"> e non un type="number" apposta:
 * con il type="number" il browser interpreta il punto come separatore
 * DECIMALE, quindi scrivere "24.000" (come si scrive in italiano)
 * significherebbe ventiquattro euro, non ventiquattromila.
 * Qui invece: il punto e' sempre separatore delle migliaia (e viene
 * messo da solo mentre si scrive), la virgola e' il separatore
 * decimale, come ci si aspetta in Italia.
 * ------------------------------------------------------------------ */

const MAX_CIFRE_INTERE = 9; // fino a 999.999.999: oltre e' rumore, non RAL

function scomponiImporto(testoGrezzo) {
  const soloValidi = testoGrezzo.replace(/[^\d,]/g, '');
  const [primaParte, ...resto] = soloValidi.split(',');
  return {
    intero: (primaParte || '').slice(0, MAX_CIFRE_INTERE),
    // null = l'utente non ha (ancora) scritto la virgola
    decimali: resto.length > 0 ? resto.join('').slice(0, 2) : null,
  };
}

function formattaImporto({ intero, decimali }) {
  const interoConPunti = intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (decimali === null) return interoConPunti;
  return `${interoConPunti},${decimali}`;
}

function valoreNumerico(testoGrezzo) {
  const { intero, decimali } = scomponiImporto(testoGrezzo);
  if (intero === '' && !decimali) return NaN;
  return Number(`${intero || '0'}.${decimali || '0'}`);
}

/**
 * Riformatta il campo a ogni battuta, rimettendo il cursore dove
 * l'utente lo aveva: senza questo, inserendo una cifra in mezzo al
 * numero il cursore salterebbe alla fine a ogni carattere.
 */
inputRal.addEventListener('input', () => {
  const posizione = inputRal.selectionStart;
  const caratteriUtiliPrimaDelCursore = inputRal.value
    .slice(0, posizione)
    .replace(/[^\d,]/g, '').length;

  const formattato = formattaImporto(scomponiImporto(inputRal.value));
  inputRal.value = formattato;

  let nuovaPosizione = 0;
  let contati = 0;
  while (nuovaPosizione < formattato.length && contati < caratteriUtiliPrimaDelCursore) {
    if (/[\d,]/.test(formattato[nuovaPosizione])) contati++;
    nuovaPosizione++;
  }
  inputRal.setSelectionRange(nuovaPosizione, nuovaPosizione);
});

function mostraErrore(msg) {
  messaggioErrore.textContent = msg;
  messaggioErrore.hidden = false;
  risultatoSection.hidden = true;
}

function nascondiErrore() {
  messaggioErrore.hidden = true;
}

/**
 * Costruisce le righe della cascata a partire dal breakdown restituito
 * dal back-end. Le voci con importo zero (es. detrazione cuneo esaurita,
 * trattamento integrativo non spettante) vengono omesse per non
 * appesantire la lettura, tranne le voci strutturali del pipeline.
 */
function costruisciRighe(r) {
  const righe = [];

  righe.push({ label: 'RAL lorda', valore: r.input.ral, segno: 'neutro' });

  righe.push({
    label: 'Contributi INPS dipendente',
    nota: `${(r.contributiInps.aliquotaApplicata * 100).toFixed(2).replace('.', ',')}%`,
    valore: -r.contributiInps.totale,
    segno: 'negativo',
  });

  righe.push({
    label: 'Imponibile fiscale',
    valore: r.imponibileFiscale,
    segno: 'neutro',
    evidenziata: true,
  });

  righe.push({
    label: 'IRPEF lorda',
    nota: 'scaglioni 23% / 33% / 43%',
    valore: -r.irpefLorda.totale,
    segno: 'negativo',
  });

  righe.push({
    label: 'Detrazione lavoro dipendente',
    nota: r.detrazioneLavoroDipendente.maggiorazione > 0 ? 'incl. maggiorazione 65€' : undefined,
    valore: r.detrazioneLavoroDipendente.totale,
    segno: 'positivo',
  });

  if (r.detrazioneCuneo.importo > 0) {
    righe.push({
      label: 'Detrazione aggiuntiva cuneo fiscale',
      valore: r.detrazioneCuneo.importo,
      segno: 'positivo',
    });
  }

  righe.push({
    label: 'IRPEF netta',
    valore: -r.irpefNetta,
    segno: 'negativo',
    evidenziata: true,
  });

  righe.push({
    label: 'Addizionale regionale (Lombardia)',
    valore: -r.addizionaleRegionale.totale,
    segno: 'negativo',
  });

  righe.push({
    label: 'Addizionale comunale (Milano)',
    nota: r.addizionaleComunale.esente ? 'esente (imponibile ≤ 23.000€)' : undefined,
    valore: -r.addizionaleComunale.importo,
    segno: r.addizionaleComunale.importo > 0 ? 'negativo' : 'neutro',
  });

  if (r.sommaEsenteCuneo.importo > 0) {
    righe.push({
      label: 'Somma esente cuneo fiscale',
      nota: 'non concorre al reddito, non tassata',
      valore: r.sommaEsenteCuneo.importo,
      segno: 'positivo',
    });
  }

  if (r.trattamentoIntegrativo.importo > 0) {
    righe.push({
      label: 'Trattamento integrativo',
      valore: r.trattamentoIntegrativo.importo,
      segno: 'positivo',
    });
  }

  return righe;
}

function disegnaRighe(righe) {
  cascataEl.innerHTML = '';
  for (const riga of righe) {
    const li = document.createElement('li');
    if (riga.evidenziata) li.classList.add('riga-imponibile');

    const label = document.createElement('span');
    label.className = 'voce-label';
    label.textContent = riga.label;
    if (riga.nota) {
      const nota = document.createElement('span');
      nota.className = 'voce-nota';
      nota.textContent = riga.nota;
      label.appendChild(nota);
    }

    const valore = document.createElement('span');
    valore.className = `voce-valore ${riga.segno === 'positivo' ? 'positivo' : riga.segno === 'negativo' ? 'negativo' : ''}`;
    const segnoTesto = riga.segno === 'positivo' ? '+ ' : riga.segno === 'negativo' && riga.valore !== 0 ? '' : '';
    valore.textContent = segnoTesto + euro(riga.valore);

    li.appendChild(label);
    li.appendChild(valore);
    cascataEl.appendChild(li);
  }
}

const formatEuroCompatto = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

function euroCompatto(n) {
  return formatEuroCompatto.format(n);
}

const formatNumeroCompatto = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

function numeroCompatto(n) {
  return formatNumeroCompatto.format(n);
}

/**
 * Riduce il breakdown completo ai pochi passaggi della waterfall
 * descritta in claude.md (RAL -> INPS -> IRPEF -> addizionali -> netto).
 * La cascata testuale sopra ha gia' ogni dettaglio: qui l'obiettivo e'
 * la lettura d'insieme in un colpo d'occhio, non un duplicato.
 */
function costruisciPassiWaterfall(r) {
  const passi = [{ tipo: 'totale', label: 'RAL', valore: r.input.ral }];
  let corrente = r.input.ral;

  const aggiungiPasso = (label, delta) => {
    if (delta === 0) return;
    const da = corrente;
    corrente += delta;
    passi.push({ tipo: delta > 0 ? 'positivo' : 'negativo', label, delta, da, a: corrente });
  };

  aggiungiPasso('INPS', -r.contributiInps.totale);
  aggiungiPasso('IRPEF netta', -r.irpefNetta);
  aggiungiPasso('Addizionali', -(r.addizionaleRegionale.totale + r.addizionaleComunale.importo));
  aggiungiPasso('Bonus fiscale', r.sommaEsenteCuneo.importo + r.trattamentoIntegrativo.importo);

  passi.push({ tipo: 'totale', label: 'Netto', valore: corrente });
  return passi;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function creaElementoSvg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const chiave of Object.keys(attrs)) el.setAttribute(chiave, attrs[chiave]);
  return el;
}

/**
 * Disegna il grafico a cascata come SVG puro (nessuna libreria di
 * grafici): una barra "totale" per RAL e Netto, una barra fluttuante
 * per ogni passaggio intermedio, con connettori tratteggiati fra una
 * barra e la successiva, sullo stile classico dei waterfall chart.
 */
function disegnaWaterfall(risultato) {
  const passi = costruisciPassiWaterfall(risultato);

  // Su schermi stretti (telefono) si disegna la stessa cascata dentro un
  // viewBox piu' stretto: cosi' tutte le barre restano visibili senza
  // scorrimento orizzontale e le etichette non diventano illeggibili.
  const stretto = window.innerWidth < 520;
  waterfallSvg.classList.toggle('waterfall-svg--stretto', stretto);

  const larghezza = stretto ? 380 : 640;
  const altezza = 300;
  const padTop = 34;
  const padBottom = 46;
  const padLato = stretto ? 12 : 24;
  const areaAltezza = altezza - padTop - padBottom;
  const areaLarghezza = larghezza - padLato * 2;
  const gap = stretto ? 7 : 14;
  const barraLarghezza = (areaLarghezza - gap * (passi.length - 1)) / passi.length;

  const massimo = Math.max(
    risultato.input.ral,
    ...passi.map((p) => Math.max(p.valore || 0, p.a || 0, p.da || 0))
  ) * 1.08;

  const yFor = (v) => padTop + areaAltezza * (1 - v / massimo);
  const yBase = yFor(0);

  waterfallSvg.innerHTML = '';
  waterfallSvg.setAttribute('viewBox', `0 0 ${larghezza} ${altezza}`);

  const defs = creaElementoSvg('defs', {});
  const grad = creaElementoSvg('linearGradient', { id: 'waterfall-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.appendChild(creaElementoSvg('stop', { offset: '0%', 'stop-color': 'var(--accent-1)' }));
  grad.appendChild(creaElementoSvg('stop', { offset: '100%', 'stop-color': 'var(--accent-2)' }));
  defs.appendChild(grad);
  waterfallSvg.appendChild(defs);

  waterfallSvg.appendChild(creaElementoSvg('line', {
    x1: padLato, y1: yBase, x2: larghezza - padLato, y2: yBase,
    stroke: 'var(--border)', 'stroke-width': 1,
  }));

  passi.forEach((passo, i) => {
    const x = padLato + i * (barraLarghezza + gap);

    // su schermo stretto si omette il simbolo di valuta nelle etichette
    // delle barre: lo spazio e' poco e i totali sotto lo riportano gia'.
    const formatta = stretto ? numeroCompatto : euroCompatto;

    let y0, y1, colore, valoreMostrato;
    if (passo.tipo === 'totale') {
      y0 = yFor(passo.valore);
      y1 = yBase;
      colore = 'url(#waterfall-grad)';
      valoreMostrato = formatta(passo.valore);
    } else {
      const yDa = yFor(passo.da);
      const yA = yFor(passo.a);
      y0 = Math.min(yDa, yA);
      y1 = Math.max(yDa, yA);
      colore = passo.tipo === 'positivo' ? 'var(--accent-2)' : 'var(--danger)';
      valoreMostrato = (passo.delta > 0 ? '+' : '−') + formatta(Math.abs(passo.delta));
    }
    const altezzaBarra = Math.max(2, y1 - y0);

    if (i > 0) {
      const precedente = passi[i - 1];
      const yConnettore = yFor(precedente.tipo === 'totale' ? precedente.valore : precedente.a);
      waterfallSvg.appendChild(creaElementoSvg('line', {
        class: 'waterfall-connettore',
        x1: x - gap, y1: yConnettore, x2: x, y2: yConnettore,
      }));
    }

    const rect = creaElementoSvg('rect', { x, y: y0, width: barraLarghezza, height: altezzaBarra, rx: 4, fill: colore });
    const title = creaElementoSvg('title', {});
    title.textContent = `${passo.label}: ${valoreMostrato}`;
    rect.appendChild(title);
    waterfallSvg.appendChild(rect);

    const testoValore = creaElementoSvg('text', {
      x: x + barraLarghezza / 2, y: Math.max(12, y0 - 8),
      'text-anchor': 'middle', class: 'waterfall-barra-valore',
    });
    testoValore.textContent = valoreMostrato;
    waterfallSvg.appendChild(testoValore);

    const testoLabel = creaElementoSvg('text', {
      x: x + barraLarghezza / 2, y: altezza - padBottom + 18,
      'text-anchor': 'middle', class: 'waterfall-barra-etichetta',
    });
    testoLabel.textContent = passo.label;
    waterfallSvg.appendChild(testoLabel);
  });
}

// Ultimo risultato ricevuto dal server: serve a ridisegnare il grafico
// quando cambia lo spazio disponibile (rotazione del telefono, finestra
// ridimensionata) senza dover rifare la chiamata di calcolo.
let ultimoRisultato = null;

btnToggleWaterfall.addEventListener('click', () => {
  const staDiventandoVisibile = waterfallContainer.hidden;
  waterfallContainer.hidden = !staDiventandoVisibile;
  btnToggleWaterfall.setAttribute('aria-expanded', String(staDiventandoVisibile));
  btnToggleWaterfall.textContent = staDiventandoVisibile
    ? 'Nascondi andamento a cascata'
    : 'Mostra andamento a cascata';
  if (staDiventandoVisibile && ultimoRisultato) disegnaWaterfall(ultimoRisultato);
});

let timerRidisegno = null;
window.addEventListener('resize', () => {
  if (!ultimoRisultato || waterfallContainer.hidden) return;
  clearTimeout(timerRidisegno);
  timerRidisegno = setTimeout(() => disegnaWaterfall(ultimoRisultato), 150);
});

async function calcola(ral, opzioni) {
  const res = await fetch('/api/calcola', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ral, opzioni }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Errore sconosciuto dal server');
  }
  return data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  nascondiErrore();

  const ral = valoreNumerico(inputRal.value);
  if (!Number.isFinite(ral) || ral < 0) {
    mostraErrore('Inserisci una RAL valida, per esempio 35.000.');
    return;
  }

  const opzioni = {
    mensilita: Number(inputMensilita.value),
    aziendaOver50Dipendenti: inputOver50.checked,
  };

  btnCalcola.disabled = true;
  btnCalcola.querySelector('.btn-label').textContent = 'Calcolo in corso…';

  try {
    const risultato = await calcola(ral, opzioni);
    ultimoRisultato = risultato;
    disegnaRighe(costruisciRighe(risultato));
    disegnaWaterfall(risultato);
    nettoAnnuoEl.textContent = euro(risultato.nettoAnnuo);
    nettoMensileEl.textContent = euro(risultato.nettoMensile);
    nettoMensilitaLabel.textContent = `su ${risultato.mensilita} mensilità`;
    risultatoSection.hidden = false;
  } catch (err) {
    mostraErrore(err.message || 'Impossibile completare il calcolo. Riprova.');
  } finally {
    btnCalcola.disabled = false;
    btnCalcola.querySelector('.btn-label').textContent = 'Calcola il netto';
  }
});
