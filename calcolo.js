'use strict';

/**
 * Motore di calcolo puro RAL -> netto.
 *
 * Nessun DOM, nessun accesso al browser: solo funzioni pure che leggono
 * i parametri fiscali/contributivi da rules-2026.json (mai numeri
 * "magici" scritti qui dentro - se un valore cambia, si cambia il JSON).
 *
 * Pipeline (vedi rules-2026.json -> pipeline_di_calcolo):
 *   RAL
 *   - contributi INPS dipendente
 *   = imponibile fiscale (al netto anche della somma esente cuneo)
 *   - IRPEF lorda (scaglioni)
 *   + detrazioni lavoro dipendente
 *   + trattamento integrativo / bonus
 *   - addizionale regionale
 *   - addizionale comunale
 *   = netto annuo
 *   / mensilita (12, 13 o 14)
 */

const fs = require('fs');
const path = require('path');

const RULES_PATH_DEFAULT = path.join(__dirname, 'rules-2026.json');

/**
 * Carica il file delle regole. Cache in memoria per evitare letture ripetute
 * da disco a ogni chiamata di calcolaNetto.
 */
let _rulesCache = null;
function caricaRegole(rulesPath) {
  if (rulesPath) {
    // Path esplicito (es. per test con regole alternative): niente cache.
    return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  }
  if (!_rulesCache) {
    _rulesCache = JSON.parse(fs.readFileSync(RULES_PATH_DEFAULT, 'utf8'));
  }
  return _rulesCache;
}

/**
 * Applica un calcolo progressivo a scaglioni (usato per IRPEF lorda e
 * addizionale regionale): ogni aliquota si applica solo alla quota di
 * base compresa nel proprio scaglione.
 * @param {number} base - imponibile su cui calcolare.
 * @param {Array<{da:number, a:number|null, aliquota:number}>} scaglioni
 * @returns {{ totale:number, dettaglio:Array }}
 */
function calcolaProgressivoScaglioni(base, scaglioni) {
  const dettaglio = [];
  let totale = 0;

  for (const scaglione of scaglioni) {
    const limiteSuperiore = scaglione.a === null ? Infinity : scaglione.a;
    if (base <= scaglione.da) break;

    const quotaInScaglione = Math.min(base, limiteSuperiore) - scaglione.da;
    const imposta = quotaInScaglione * scaglione.aliquota;

    totale += imposta;
    dettaglio.push({
      da: scaglione.da,
      a: scaglione.a,
      aliquota: scaglione.aliquota,
      quotaImponibile: quotaInScaglione,
      imposta,
    });
  }

  return { totale, dettaglio };
}

/**
 * Trova, dentro un array di "fasce" (da/a contigui, non sovrapposti),
 * quella in cui ricade il valore dato. Le fasce hanno "a: null" per
 * indicare "senza limite superiore".
 */
function trovaFascia(valore, fasce) {
  return fasce.find((f) => {
    const limiteSuperiore = f.a === null ? Infinity : f.a;
    return valore >= f.da && valore < limiteSuperiore;
  }) || fasce[fasce.length - 1];
}

/**
 * 1. Contributi INPS a carico del dipendente.
 * Aliquota IVS ordinaria (o quella "over 50 dipendenti" se richiesta via
 * opzioni), + eventuale contributo aggiuntivo 1% sulla quota eccedente la
 * prima fascia di retribuzione pensionabile, il tutto sull'imponibile
 * previdenziale capato al massimale annuo (se applicabile).
 */
function calcolaContributiInps(ral, opzioni, regole) {
  const p = regole.previdenza;

  const aliquota = opzioni.aziendaOver50Dipendenti
    ? p.aliquota_alternativa_over50_dipendenti
    : p.aliquota_ivs_dipendente;

  const applicaMassimale = opzioni.massimaleContributivo !== false; // default true
  const imponibilePrevidenziale = applicaMassimale
    ? Math.min(ral, p.massimale_annuo.importo)
    : ral;

  const contributoBase = imponibilePrevidenziale * aliquota;

  let contributoAggiuntivo = 0;
  const ca = p.contributo_aggiuntivo_1_percento;
  if (ca && ca.attivo && imponibilePrevidenziale > ca.soglia_prima_fascia_annua) {
    contributoAggiuntivo =
      (imponibilePrevidenziale - ca.soglia_prima_fascia_annua) * ca.aliquota;
  }

  const totale = contributoBase + contributoAggiuntivo;

  return {
    aliquotaApplicata: aliquota,
    imponibilePrevidenziale,
    massimaleApplicato: applicaMassimale && ral > p.massimale_annuo.importo,
    contributoBase,
    contributoAggiuntivo,
    totale,
  };
}

/**
 * 2. Cuneo fiscale - binario 1: somma esente dalla formazione del reddito.
 * Base di calcolo = RAL (non l'imponibile fiscale). La percentuale della
 * fascia trovata si applica all'INTERO reddito da lavoro dipendente, non
 * per scaglioni progressivi.
 */
function calcolaSommaEsenteCuneo(ral, regole) {
  const binario1 = regole.cuneo_fiscale.binario_1_somma_esente;

  if (ral > binario1.soglia_massima) {
    return { importo: 0, fasciaApplicata: null };
  }

  const fascia = trovaFascia(ral, binario1.fasce);
  const importo = fascia ? ral * fascia.percentuale : 0;

  return { importo, fasciaApplicata: fascia };
}

/**
 * 3. IRPEF lorda: progressiva a scaglioni sull'imponibile fiscale.
 */
function calcolaIrpefLorda(imponibileFiscale, regole) {
  const { totale, dettaglio } = calcolaProgressivoScaglioni(
    imponibileFiscale,
    regole.irpef.scaglioni
  );
  return { totale, dettaglio };
}

/**
 * 4. Detrazione lavoro dipendente (art. 13 TUIR) + maggiorazione 65 EUR.
 * Base di calcolo = imponibile fiscale (semplificazione del modello:
 * "reddito complessivo" == imponibile fiscale, niente altri redditi).
 *
 * Le fasce "formula" nel JSON portano gia' i pezzi numerici (base,
 * incremento, ampiezza, limite_superiore_formula): la formula si ricostruisce
 * da quei campi, senza valutare la stringa "formula" come codice.
 */
function calcolaDetrazioneLavoroDipendente(imponibileFiscale, regole) {
  const cfg = regole.detrazione_lavoro_dipendente;
  const fascia = trovaFascia(imponibileFiscale, cfg.fasce);

  let importoBase = 0;
  if (fascia.tipo === 'fisso') {
    importoBase = fascia.importo;
  } else if (fascia.tipo === 'formula') {
    const limiteSuperiore = fascia.limite_superiore_formula;
    const ratio = (limiteSuperiore - imponibileFiscale) / fascia.ampiezza;
    // Le due fasce "formula" del TUIR hanno forma diversa:
    // 15.000-28.000 e' additiva (base + incremento*ratio, decresce verso 1.910),
    // 28.000-50.000 e' moltiplicativa (base*ratio, decresce verso 0).
    // Il campo "incremento" e' presente solo nella prima: usiamo la sua presenza
    // per scegliere la forma, senza hardcodare le soglie 28000/50000 nel codice.
    importoBase =
      fascia.incremento !== undefined
        ? fascia.base + fascia.incremento * ratio
        : fascia.base * ratio;
  }

  const magg = cfg.maggiorazione_art_13_comma_1bis;
  const maggiorazioneApplicata =
    magg &&
    magg.attivo &&
    imponibileFiscale >= magg.reddito_da &&
    imponibileFiscale <= magg.reddito_a;

  const maggiorazione = maggiorazioneApplicata ? magg.importo : 0;

  return {
    fasciaApplicata: fascia,
    importoBase,
    maggiorazione,
    totale: importoBase + maggiorazione,
  };
}

/**
 * 5. Cuneo fiscale - binario 2: detrazione aggiuntiva d'imposta.
 * Base di calcolo = RAL. Fascia fissa 20.000-32.000, poi decrescenza
 * lineare fino a 40.000. L'ampiezza della fascia "formula" si ricava dai
 * suoi stessi da/a (JSON-driven, nessun numero fisso nel codice); il
 * valore di partenza e' l'importo fisso della fascia precedente.
 */
function calcolaDetrazioneCuneo(ral, regole) {
  const binario2 = regole.cuneo_fiscale.binario_2_detrazione_aggiuntiva;
  const fascia = trovaFascia(ral, binario2.fasce);

  if (!fascia || fascia.da > ral) {
    return { importo: 0, fasciaApplicata: null };
  }

  let importo = 0;
  if (fascia.tipo === 'fisso') {
    importo = fascia.importo;
  } else if (fascia.tipo === 'formula') {
    const fasciaFissaPrecedente = binario2.fasce.find((f) => f.tipo === 'fisso');
    const importoPieno = fasciaFissaPrecedente ? fasciaFissaPrecedente.importo : 0;
    const ampiezza = fascia.a - fascia.da;
    importo = (importoPieno * (fascia.a - ral)) / ampiezza;
  }

  return { importo: Math.max(0, importo), fasciaApplicata: fascia };
}

/**
 * 6. Trattamento integrativo (ex bonus Renzi).
 * Nel profilo di default (no carichi, no oneri) ha effetto quasi sempre
 * nullo sopra i 15.000 EUR, ma la logica e' implementata per intero.
 */
function calcolaTrattamentoIntegrativo(imponibileFiscale, irpefLorda, detrazioneLavoroDipendente, regole) {
  const cfg = regole.trattamento_integrativo;

  if (imponibileFiscale > cfg.soglia_massima_reddito) {
    return { importo: 0, motivazione: 'reddito oltre soglia massima' };
  }

  if (imponibileFiscale <= 15000) {
    const spetta = irpefLorda > detrazioneLavoroDipendente;
    return {
      importo: spetta ? cfg.importo_massimo : 0,
      motivazione: spetta
        ? 'irpef lorda > detrazione lavoro dipendente'
        : 'irpef lorda <= detrazione lavoro dipendente: non spetta',
    };
  }

  // 15.000 < imponibile < 28.000
  const sommaDetrazioniQualificate = detrazioneLavoroDipendente;
  if (sommaDetrazioniQualificate > irpefLorda) {
    const importo = Math.min(cfg.importo_massimo, sommaDetrazioniQualificate - irpefLorda);
    return { importo, motivazione: 'detrazioni qualificate > irpef lorda' };
  }

  return { importo: 0, motivazione: 'detrazioni qualificate <= irpef lorda: non spetta' };
}

/**
 * 7. Addizionale regionale (Lombardia): progressiva a scaglioni
 * sull'imponibile fiscale, stessa meccanica dell'IRPEF.
 */
function calcolaAddizionaleRegionale(imponibileFiscale, regole) {
  const { totale, dettaglio } = calcolaProgressivoScaglioni(
    imponibileFiscale,
    regole.addizionale_regionale.scaglioni
  );
  return { totale, dettaglio };
}

/**
 * 8. Addizionale comunale (Milano): aliquota unica con soglia di
 * esenzione "a gradino" - sotto soglia zero, sopra soglia si applica
 * sull'INTERO imponibile (non solo sull'eccedenza).
 */
function calcolaAddizionaleComunale(imponibileFiscale, regole) {
  const cfg = regole.addizionale_comunale;
  const esente = imponibileFiscale <= cfg.soglia_esenzione;
  const importo = esente ? 0 : imponibileFiscale * cfg.aliquota;
  return { importo, esente };
}

/**
 * Funzione principale: RAL + opzioni -> breakdown completo.
 *
 * @param {number} ral - Retribuzione Annua Lorda.
 * @param {Object} [opzioni]
 * @param {number} [opzioni.mensilita] - 12, 13 o 14. Default da rules JSON.
 * @param {boolean} [opzioni.aziendaOver50Dipendenti] - usa l'aliquota INPS del 9,49% invece del 9,19%.
 * @param {boolean} [opzioni.massimaleContributivo] - se false, disattiva il cap del massimale INPS (iscritti ante-1996). Default true.
 * @param {string} [opzioni.rulesPath] - path alternativo a un file di regole (utile nei test).
 * @returns {Object} breakdown completo di tutte le voci intermedie, non solo il netto.
 */
function calcolaNetto(ral, opzioni = {}) {
  if (typeof ral !== 'number' || !Number.isFinite(ral) || ral < 0) {
    throw new Error(`RAL non valida: ${ral}`);
  }

  const regole = caricaRegole(opzioni.rulesPath);

  const mensilitaAmmesse = regole.mensilita.valori_ammessi;
  const mensilita = opzioni.mensilita !== undefined ? opzioni.mensilita : regole.mensilita.default;
  if (!mensilitaAmmesse.includes(mensilita)) {
    throw new Error(`Mensilita non valida: ${mensilita}. Valori ammessi: ${mensilitaAmmesse.join(', ')}`);
  }

  // 1. Contributi INPS dipendente
  const contributi = calcolaContributiInps(ral, opzioni, regole);

  // 2. Somma esente cuneo fiscale (binario 1) - non concorre all'imponibile
  const sommaEsenteCuneo = calcolaSommaEsenteCuneo(ral, regole);

  // 3. Imponibile fiscale
  const imponibileFiscale = ral - contributi.totale - sommaEsenteCuneo.importo;

  // 4. IRPEF lorda
  const irpefLorda = calcolaIrpefLorda(imponibileFiscale, regole);

  // 5. Detrazione lavoro dipendente (+ maggiorazione 65 EUR)
  const detrazioneLavoroDipendente = calcolaDetrazioneLavoroDipendente(imponibileFiscale, regole);

  // 6. Detrazione aggiuntiva cuneo fiscale (binario 2)
  const detrazioneCuneo = calcolaDetrazioneCuneo(ral, regole);

  // 7. IRPEF netta
  const irpefNetta = Math.max(
    0,
    irpefLorda.totale - detrazioneLavoroDipendente.totale - detrazioneCuneo.importo
  );

  // 8. Trattamento integrativo
  const trattamentoIntegrativo = calcolaTrattamentoIntegrativo(
    imponibileFiscale,
    irpefLorda.totale,
    detrazioneLavoroDipendente.totale,
    regole
  );

  // 9. Addizionale regionale
  const addizionaleRegionale = calcolaAddizionaleRegionale(imponibileFiscale, regole);

  // 10. Addizionale comunale
  const addizionaleComunale = calcolaAddizionaleComunale(imponibileFiscale, regole);

  // 11. Netto annuo
  const nettoAnnuo =
    imponibileFiscale -
    irpefNetta -
    addizionaleRegionale.totale -
    addizionaleComunale.importo +
    sommaEsenteCuneo.importo +
    trattamentoIntegrativo.importo;

  // 12. Netto mensile
  const nettoMensile = nettoAnnuo / mensilita;

  return {
    input: { ral, opzioni: { ...opzioni, mensilita } },
    contributiInps: contributi,
    sommaEsenteCuneo,
    imponibileFiscale,
    irpefLorda,
    detrazioneLavoroDipendente,
    detrazioneCuneo,
    irpefNetta,
    trattamentoIntegrativo,
    addizionaleRegionale,
    addizionaleComunale,
    nettoAnnuo,
    mensilita,
    nettoMensile,
  };
}

module.exports = {
  calcolaNetto,
  // esportate per eventuale riuso/test mirati sulle singole voci
  _internals: {
    caricaRegole,
    calcolaProgressivoScaglioni,
    trovaFascia,
    calcolaContributiInps,
    calcolaSommaEsenteCuneo,
    calcolaIrpefLorda,
    calcolaDetrazioneLavoroDipendente,
    calcolaDetrazioneCuneo,
    calcolaTrattamentoIntegrativo,
    calcolaAddizionaleRegionale,
    calcolaAddizionaleComunale,
  },
};
