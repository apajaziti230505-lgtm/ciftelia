# Çiftelia Studio — 15 nota reale × 2 goditje

**Version lokal për provë, nuk është publikuar në GitHub.**

Burimi: `Strimnitsa 2(2).m4a`, regjistrimi i çiftelisë që dërgoi përdoruesi.
Regjistrimi 115.86 s, mono AAC, 48 kHz, përmban saktësisht **30 goditje** sipas rendit:

- Goditjet 1–2: teli melodik i poshtëm i hapur, G / nota 15, nominalisht 293 Hz (matur rreth **289.1 Hz**).
- Goditjet 3–28: perdet 1–13, nga dy goditje në secilën (lehtë, fort).
- Goditjet 29–30: teli shoqërues i sipërm i hapur, F / nota 14, matur rreth **220.3 Hz**.

Këto janë regjistrime reale, **jo tinguj të gjeneruar**, pa konvertim 220→440 ose 220→293 Hz.
Zëri i telit lart ka harmonikë 440 Hz më të fortë se themelorja 220 Hz; kjo është pjesë normale e ngjyrës së tij.

## Çfarë u përmirësua

- 30 mostra reale M4A (15 nota × `lehte` dhe `fort`) te `assets/audio-real/`.
- 30 mostra origjinale të nxjerra në WAV PCM 24-bit në një arkiv tjetër, për punim/miksim pa kompresim shtesë.
- Nuk ka më sintetizim me oscilator të telit të hapur të poshtëm.
- Goditja **Lehtë/Fort** zgjidhet te kontrollet e tastierës dhe ruhet me ngjarjet e këngëve.
- Luajtja në dy tela e mban F (220 Hz) si shoqërim; secili tel zbut gradualisht tingullin e vet kur goditet përsëri.
- `Shkurt` është deri në 1.45 s, ndërsa `Rezonancë e plotë` ruan shuarjen origjinale deri në 4 s.
- Frekuencat për njohjen nga mikrofoni u përditësuan sipas matjeve të këtij regjistrimi, tolerancë ±15 Hz; teli poshtë identifikohet në objektivin nominal 293 Hz, edhe pse në këtë incizim është rreth 289 Hz.
- Filtri i mikrofonit Low Cut 80 Hz; opsionet e shtypjes së zërit, heqjes së zhurmës dhe echo cancellation janë të çaktivizuara.
- Butonat Luaj, Ndalo, Regjistro, Ruaj, Fshi dhe eksport/import JSON vazhdojnë të jenë të pranishëm.

## Provë lokale

Hape terminalin brenda dosjes dhe ekzekuto:

```bash
python -m http.server 8000
```

Hape `http://localhost:8000` në shfletues. Në Safari/Android publikimi duhet të jetë HTTPS për të përdorur mikrofonin.
JavaScript-i te `js/` është tashmë i përpiluar. Për të përditësuar TypeScript-in te `src/`: `tsc -p tsconfig.json`.
Testo notat me `node tests/test-notes.mjs`.

Skedarët e vjetër `assets/audio/` mbeten vetëm si rezervë nëse nuk ngarkohen mostrat e reja.
Ngarkimi i parë në internet mund të marrë pak kohë për 30 mostrat audio (rreth 1.65 MB); më pas ato ruhen në cache-in e shfletuesit.

**Kufizim:** njohja e goditjeve me mikrofon dhe audioja në iPhone/Android real duhen provuar në pajisje. Njohja e 220 Hz mund të ngatërrohet me harmonikën 440 Hz kur telat tingëllojnë njëkohësisht. Matjet janë orientuese nga regjistrimi, jo certifikim akordimi.
