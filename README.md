# Çiftelia Studio — 15 nota reale × 2 goditje

**Version V6: importo audio, zbulo goditjet, korrigjo perdet dhe ruaj tablaturën.**

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


## Analizo audio të plotë → korrigjo → ruaj tablaturën (V6)

- Kliko **Importo këngë audio**, zgjidh MP3/M4A/WAV deri në 25 MB dhe 150 sekonda.
- **Analizo notat** zbulon goditje dhe i krahason me 30 regjistrimet reale të çiftelisë. **Nuk është transkriptim i garantuar**; figurat e paqarta mbeten `?`.
- Në panelin **Korrigjo notat dhe kohët**, mund të ndryshosh milisekondën, telin dhe perden, të dëgjosh pjesën dhe të shtosh/fshish shënime.
- Në **Luaj**, kënga e importuar dëgjohet si **audioja origjinale**, me tablaturën e sinkronizuar. Nuk shtohet automatikisht 220 Hz.
- **Ruaj** ruan notat në localStorage dhe audion origjinale në IndexedDB, vetëm në pajisjen/shfletuesin ku përdoret. JSON ruan tablaturën, **jo audion**; në pajisje tjetër duhet edhe skedari audio origjinal.
- Për muzikë me disa instrumente, shumë zhurmë ose dy tela në një goditje, analiza mund të ngatërrojë notat. Kontrolli manual është pjesë e domosdoshme e procesit.
- Kodi i redaktueshëm: `src/analysis.ts`, `src/local-audio.ts`, `src/main.ts`; përpilo me `tsc -p tsconfig.json`.

**Kontrolle të zhvillimit:** `npm run build` dhe `npm test` verifikojnë TypeScript, notat, luajtjen dhe zbulimin e goditjeve me sinjale prove.


## Versioni v8: strofa + Onset Detection

- Importimi i një audioje nis automatikisht detektimin e fillimeve të goditjeve. Butoni Onset Detection mund të përdoret përsëri.
- Çdo shënim mund të ndryshohet ose fshihet; + krijon një shënim të humbur.
- F për telin lart është ON në tablaturë si parazgjedhje për çdo notë të telit poshtë. Çaktivizoje në rreshtin e notës nëse ajo goditje nuk ka F. Audioja origjinale nuk modifikohet.
- Strofat ndahen sipas pauzave të gjata; mund të shtohen manualisht, emërtohen dhe lëvizen në milisekonda.
- Këngët e ruajtura që kanë audio mund të redaktohen dhe të ruhen mbi të njëjtën këngë.
- Analiza automatikisht propozon goditje/nota; rezultatet e pasigurta duhet të kontrollohen me dëgjim.

## V9 — Strofat me ngjyra dhe shtim note poshte rreshtit
Ndarjet e strofave shfaqen me vija te trasha me ngjyra te ndryshme edhe ne tablature. Prek nje note per ta zgjedhur, pastaj shtyp **+ Shto poshte notes se zgjedhur**. Nota e re shfaqet menjehere poshte dhe koha vendoset mes dy goditjeve; mund ta korrigjosh ne milisekonda. Ndarja e strofes vendoset te nota e zgjedhur. Audioja origjinale nuk ndryshohet.
