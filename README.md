# Da RAL a netto — prototipo (anno d'imposta 2026)

Un piccolo sito che risponde a una domanda sola: **se il mio contratto dice 35.000 € lordi
all'anno, quanto mi arriva davvero in banca ogni mese?**

Non si limita a dare il numero finale: mostra **ogni singolo passaggio** che porta dal lordo al
netto — contributi, tasse, detrazioni, addizionali — perché il valore sta nel capire *dove
finiscono i soldi*, non solo quanti ne restano.

Profilo simulato: **impiegato, tempo indeterminato, full-time, residente a Milano**, senza
familiari a carico. Le semplificazioni sono tutte dichiarate più avanti, nella sezione
[Le semplificazioni fatte](#le-semplificazioni-fatte-e-perché).

---

## Come farlo partire

Servono cinque minuti e nessuna conoscenza di programmazione.

### 1. Installare Node.js

Il sito ha bisogno di Node.js per funzionare (è il programma che "fa girare" il codice).
Si scarica gratuitamente da **<https://nodejs.org>** — scegliere la versione **LTS** e
installarla lasciando tutte le opzioni predefinite.

Per verificare che sia installato, aprire il terminale e scrivere `node --version`:
deve rispondere con un numero di versione (es. `v24.19.0`).

> **Come si apre il terminale**
> **Windows** — tasto destro sulla cartella del progetto → *Apri nel terminale*
> (oppure: menu Start → cerca `PowerShell` → poi `cd` seguito dal percorso della cartella).
> **Mac** — tasto destro sulla cartella → *Servizi* → *Nuovo terminale nella cartella*.

### 2. Avviare il sito

Dal terminale, **dentro la cartella del progetto**, scrivere:

```bash
npm start
```

Comparirà qualcosa del genere:

```
  Sito avviato. Aprilo qui:

    Su questo computer:      http://localhost:3000
    Da telefono o tablet:    http://[iP]:3000   (stessa rete Wi-Fi)

  Per fermare il server: premi Ctrl+C in questa finestra.
```

### 3. Aprire il sito

- **Sul computer**: aprire il browser su **<http://localhost:3000>**
- **Sul telefono o tablet**: collegarsi alla **stessa rete Wi-Fi** del computer e aprire nel
  browser l'indirizzo `http://192.168...:3000` stampato dal terminale (l'indirizzo esatto
  cambia da rete a rete: usare quello che compare sullo schermo).

> Se dal telefono non si apre, quasi sempre è il **firewall** del computer che blocca la
> connessione: alla prima esecuzione Windows mostra un avviso — scegliere *Consenti accesso*
> per le reti private. Il sito funziona comunque sul computer.

Per **fermare** il sito: `Ctrl+C` nella finestra del terminale.

---

## Cosa fa il sito

1. Si scrive la **RAL** (la retribuzione annua lorda, quella scritta sul contratto).
2. Si preme **Calcola il netto**.
3. Compare la **cascata completa**: da quanto si parte, quanto va all'INPS, quanto all'IRPEF,
   quanto tornano indietro le detrazioni, quanto se ne vanno le addizionali di Regione e
   Comune, e cosa resta — sia annuo che mensile.
4. Il pulsante **Mostra andamento a cascata** apre un grafico che riassume gli stessi numeri
   a colpo d'occhio.

Sotto **Opzioni avanzate** si può cambiare il numero di mensilità (12, 13 o 14) e indicare se
l'azienda ha più di 50 dipendenti (cambia l'aliquota INPS dal 9,19% al 9,49%).

---

## Cosa c'è dentro la cartella

| File | A cosa serve |
|---|---|
| `calcolo.js` | **Il cervello.** Contiene tutta la matematica del calcolo e nient'altro: non sa che esiste un sito web, non tocca la pagina. Si può usare da solo. |
| `rules-2026.json` | **I numeri di legge.** Aliquote, scaglioni, soglie, detrazioni, con la fonte normativa di ogni blocco. Nel codice non c'è nemmeno un numero fiscale scritto a mano: se cambia una legge, si cambia solo questo file. |
| `server.js` | **Il cameriere.** Consegna la pagina al browser e passa le richieste di calcolo a `calcolo.js`. |
| `public/index.html` | La pagina che si vede. |
| `public/styles.css` | L'aspetto grafico della pagina. |
| `public/app.js` | Quello che succede nel browser: legge il campo RAL, chiede il calcolo al server, disegna la cascata e il grafico. **Non fa nessun calcolo fiscale.** |
| `package.json` | La carta d'identità del progetto: dice come si avvia (`npm start`) e come si lanciano i test. |
| `test/test.js` | Verifica il motore di calcolo da solo, sui 9 casi limite definiti in `rules-2026.json`. |
| `test/test-integration.js` | Verifica che sito e motore funzionino **insieme**: 45 controlli su pagina, calcoli via web e gestione degli errori. |
| `test/test-results.json` | I risultati dell'ultima esecuzione dei test (si rigenera da solo). |
| `report-verifica-calcolo.txt` | Il report del confronto con calcolatori esterni: quanto siamo d'accordo e dove no, con il perché. |

**La scelta di fondo:** il calcolo sta in **un solo posto** (`calcolo.js`), i parametri di legge
in **un solo posto** (`rules-2026.json`), e la pagina web non ha alcuna logica fiscale. Così
l'aggiornamento normativo dell'anno prossimo non richiede di rimettere le mani nel sito, e il
motore può essere riutilizzato altrove (un'app, un gestionale, un import massivo) senza portarsi
dietro l'interfaccia.

Il progetto **non usa nessuna libreria esterna**: niente da installare oltre a Node.js, niente
dipendenze che invecchiano o che introducono vulnerabilità. Anche il grafico è disegnato a mano
in SVG.

---

## La pipeline di calcolo, spiegata

Esempio reale con **RAL 35.000 €**, 13 mensilità, Milano (sono i numeri che il sito produce
davvero):

| # | Passaggio | Importo | In parole povere |
|---|---|---|---|
| 1 | RAL | `35.000,00` | quello che c'è scritto sul contratto |
| 2 | − Contributi INPS (9,19%) | `−3.216,50` | la quota di pensione a carico del lavoratore |
| 3 | = Imponibile fiscale | `31.783,50` | su questo, e non sulla RAL, si calcolano le tasse |
| 4 | − IRPEF lorda | `−7.688,56` | 23% fino a 28.000, 33% sulla parte eccedente |
| 5 | + Detrazione lavoro dipendente | `+1.646,52` | sconto d'imposta che spetta a chi è dipendente |
| 6 | + Detrazione cuneo fiscale | `+625,00` | il "taglio del cuneo", che a 35.000 è già in fase di riduzione |
| 7 | = IRPEF netta | `−5.417,03` | l'IRPEF davvero pagata |
| 8 | − Addizionale regionale (Lombardia) | `−454,98` | l'IRPEF della Regione |
| 9 | − Addizionale comunale (Milano, 0,8%) | `−254,27` | l'IRPEF del Comune |
| 10 | **= Netto annuo** | **`25.657,22`** | |
| 11 | **÷ 13 mensilità** | **`1.973,63`** | quanto si vede in busta paga |

Due passaggi non compaiono in questo esempio ma esistono nel motore, e si attivano su altre RAL:

- la **somma esente del cuneo fiscale** (fino a 20.000 € di RAL): una quota di stipendio che non
  fa proprio reddito, quindi non viene tassata;
- il **trattamento integrativo** (l'ex bonus Renzi): implementato per intero, ma nel profilo
  standard senza familiari a carico praticamente non spetta mai sopra i 15.000 €.

### I punti dove il calcolo "fa uno scalino"

Sono i casi che rendono questo calcolo meno banale di quanto sembri, ed è dove si concentrano i
test:

- **20.000 €** — sopra questa RAL sparisce la somma esente e subentra la detrazione del cuneo:
  due meccanismi diversi, con **basi di calcolo diverse** (uno lavora sulla RAL, l'altro
  sull'imposta).
- **23.000 € di imponibile** — l'addizionale comunale di Milano ha una soglia secca: sotto non
  si paga nulla, sopra si paga sull'**intero** imponibile, non solo sull'eccedenza. È un vero
  gradino nella curva del netto.
- **28.000 €** — passaggio dal primo al secondo scaglione IRPEF.
- **32.000 → 40.000 €** — la detrazione del cuneo scende progressivamente fino ad azzerarsi.
- **50.000 € di imponibile** — la detrazione da lavoro dipendente arriva a zero.
- **56.224 €** — scatta il contributo INPS aggiuntivo dell'1% sulla parte eccedente.
- **122.295 €** — massimale contributivo: oltre, non si versano più contributi IVS.

---

## Da dove vengono i numeri

Ogni blocco di `rules-2026.json` porta con sé la propria fonte normativa e il link di verifica.
In sintesi:

| Cosa | Fonte |
|---|---|
| Scaglioni e aliquote IRPEF | TUIR art. 11, come modificato dalla **L. 199/2025** (Legge di Bilancio 2026): il secondo scaglione scende dal 35% al 33% |
| Detrazione da lavoro dipendente | **TUIR art. 13**, commi 1 e 1-bis, nella struttura introdotta dal **D.Lgs. 216/2023** |
| Cuneo fiscale (somma esente + detrazione) | **L. 207/2024** art. 1 commi 4 e 6, resa strutturale dalla **L. 199/2025** |
| Trattamento integrativo | **D.L. 3/2020**, conv. **L. 21/2020** |
| Aliquote e massimali INPS | **Circolare INPS n. 6/2026**; minimale giornaliero 2026 |
| Addizionale regionale Lombardia | Delibera regionale — banca dati **MEF**, Dipartimento delle Finanze |
| Addizionale comunale Milano | Delibera comunale depositata sul portale **MEF** |

> **Nota di trasparenza:** alla data di stesura il Comune di Milano non aveva ancora deliberato
> le aliquote 2026, quindi resta in vigore l'aliquota 2025 (0,8% con esenzione fino a 23.000 €).
> È il tipo di dato da riverificare sul portale MEF prima di ogni rilascio.

---

## Le semplificazioni fatte (e perché)

Questo è un prototipo, non un software paghe. Ogni semplificazione è una scelta consapevole:
elencarle serve a rendere chiaro **cosa il numero mostrato è**, e soprattutto **cosa non è**.

1. **Profilo fisso** — impiegato, tempo indeterminato, full-time, 365 giorni lavorati,
   settore privato non agricolo, residente a Milano al 1° gennaio.
   *Perché:* rendere variabile il profilo significa moltiplicare i casi (apprendisti, part-time,
   dirigenti con fondi propri, contratti a termine) senza aggiungere nulla alla dimostrazione
   della logica di calcolo.

2. **Nessun familiare a carico, nessun altro reddito, nessun onere detraibile** — quindi nel
   modello "reddito complessivo" coincide con l'imponibile fiscale.
   *Perché:* sono dati che il lavoratore comunica al datore, non deducibili dalla RAL. Con altri
   redditi il calcolo cambierebbe base e alcune detrazioni si ridurrebbero.

3. **Le mensilità aggiuntive sono divise in parti uguali** — il netto annuo viene semplicemente
   diviso per 13 o 14.
   *Perché:* è la semplificazione più visibile. Nella realtà **la tredicesima è tassata quasi
   all'aliquota marginale piena**, perché le detrazioni sono già distribuite sui dodici mesi
   ordinari: il netto della mensilità aggiuntiva è quindi **più basso** di un mese normale. Il
   totale annuo resta corretto; è la ripartizione mensile a essere una media.

4. **L'addizionale regionale è imputata all'anno in cui matura** — nella realtà viene trattenuta
   in 11 rate da gennaio a novembre dell'**anno successivo**.
   *Perché:* il sito risponde a "quanto vale questa RAL", non "cosa vedrò in busta paga a marzo".
   Per competenza il numero è corretto; per cassa slitta di un anno.

5. **Nessun arrotondamento fiscale** — i calcoli restano al centesimo, mentre in busta paga
   IRPEF e addizionali si arrotondano all'unità di euro.
   *Perché:* mantiene i passaggi verificabili. L'impatto è di pochi euro l'anno.

6. **Massimale contributivo sempre applicato** — vale per chi è iscritto alla previdenza
   obbligatoria dal 1° gennaio 1996 in poi. Per gli iscritti prima di quella data il massimale
   non opera, e il calcolo sopra i 122.295 € risulterebbe diverso (opzione già prevista nel
   motore, non esposta nell'interfaccia).

7. **Un solo Comune (Milano) e una sola Regione (Lombardia)** — le addizionali sono circa 7.800
   diverse, ognuna con soglie di esenzione e scaglioni propri.
   *Perché:* la struttura del calcolo è identica per tutti; cambiano solo i dati. Il campo
   "Comune" nell'interfaccia è già predisposto, ma dichiarato non attivo invece che finto.

8. **Fuori dal calcolo, per scelta:** TFR (accantonato, non erogato), contributi a carico
   azienda (~23,81% + INAIL: riguardano il costo aziendale, non la busta paga), fringe benefit,
   buoni pasto, welfare aziendale, conguaglio di fine anno, detrazioni per oneri recuperabili in
   dichiarazione.

---

## Cosa ho verificato (e il bug che ho trovato)

Il motore è stato scritto e testato **prima** di costruire l'interfaccia, esattamente per poter
verificare la logica senza che un errore si nascondesse dietro una schermata gradevole.

**Un bug vero, trovato dai test.** Nella detrazione da lavoro dipendente, le due fasce con
formula hanno struttura **diversa**: tra 15.000 e 28.000 è additiva
(`1.910 + 1.190 × (28.000 − reddito) / 13.000`), tra 28.000 e 50.000 è moltiplicativa
(`1.910 × (50.000 − reddito) / 22.000`). Trattandole allo stesso modo, la detrazione restava
inchiodata a 1.910 € invece di scendere verso zero. Il test sul caso limite dei 50.000 l'ha fatto
emergere subito: il valore atteso era ~399 €, non 1.910 €. Corretto e riverificato, poi
**confermato da una fonte esterna indipendente** che sullo stesso caso riporta 399 €.

**Una nota di logica, non di codice.** Le indicazioni di partenza dicevano che, passando da
49.999 a 50.001, *il netto dovrebbe scendere* per l'azzeramento della detrazione. Verificando la
norma, con la struttura introdotta dal **D.Lgs. 216/2023 la detrazione decresce in modo continuo**
fino ad annullarsi esattamente a 50.000: **non c'è nessun salto**, e il netto continua a crescere.
Il gradino vero, in questo modello, è altrove: l'**addizionale comunale di Milano**, che sopra i
23.000 € di imponibile si paga sull'intero importo. Ho preferito seguire la norma in vigore
piuttosto che forzare il codice a riprodurre il comportamento atteso.

**Confronto con calcolatori esterni.** Sul caso più pulito (RAL 50.000) l'accordo con una fonte
esterna è del **99,91%**, con tutte le voci intermedie coincidenti al centesimo. Sugli altri due
casi confrontabili lo scarto (3-4%) è riconducibile a **errori della fonte esterna**, non del
motore: una non applica la riduzione progressiva del cuneo tra 32.000 e 40.000, l'altra sbaglia
la fascia della somma esente a 20.000. Diversi calcolatori online, pur dichiarandosi "2026",
usano ancora l'aliquota del 35% sul secondo scaglione. Dettaglio completo in
`report-verifica-calcolo.txt`.

**Test automatici.** Due suite, lanciabili così (con il sito avviato in un'altra finestra per la
seconda):

```bash
npm test                  # 9 casi limite sul motore di calcolo
npm run test:integration  # 45 controlli su sito + motore insieme
```

La seconda verifica anche i casi sgradevoli: RAL negativa, mensilità non ammessa, richiesta
malformata, tentativo di accesso a file fuori dalla cartella pubblica.

---

## Cosa servirebbe per portarlo in produzione

In ordine di importanza:

1. **Validazione da un consulente del lavoro** o confronto con un software paghe certificato su
   una serie di cedolini reali. Nessun confronto con calcolatori online può sostituirla — e come
   documentato sopra, diversi di quei calcolatori sono a loro volta sbagliati.
2. **Tutti i Comuni e tutte le Regioni**, importati dalla banca dati MEF con la data di validità
   di ogni delibera, invece di due soli enti scritti nel file delle regole.
3. **Dati del lavoratore**: familiari a carico, altri redditi, oneri detraibili, giorni
   effettivamente lavorati, part-time — cioè tutto ciò che oggi è ipotizzato a zero.
4. **Calcolo per cassa, mese per mese**: tassazione della tredicesima, conguaglio di fine anno,
   addizionali rateizzate nell'anno successivo. È il salto da "quanto vale la RAL" a "cosa leggo
   in busta paga questo mese".
5. **Aliquote INPS complete** per settore, dimensione aziendale e qualifica (apprendisti,
   dirigenti con fondi di categoria, agricoltura, part-time verticale).
6. **Versionamento delle regole per anno d'imposta** (`rules-2027.json` e successivi) con data di
   validità, così da poter ricalcolare anche anni passati; oggi la struttura lo permette già, ma
   il file caricato è uno solo.
7. **Suite di test "golden"** fornita dal payroll: N cedolini reali con il netto atteso, da far
   girare a ogni modifica delle regole.
8. **Lato tecnico**: HTTPS, limite di richieste sull'API, log, e — se un giorno si salvassero gli
   input degli utenti — le valutazioni GDPR del caso. Oggi il sito non memorizza nulla: ogni
   calcolo nasce e muore nella singola richiesta.

---

## In breve

Il numero che il sito mostra è una **stima ragionata e verificabile**, non un cedolino. Ogni
parametro è tracciabile alla sua fonte normativa, ogni semplificazione è dichiarata, e i punti
in cui il calcolo può sorprendere (le soglie, i gradini, le due basi di calcolo del cuneo) sono
proprio quelli su cui sono concentrati i test.
