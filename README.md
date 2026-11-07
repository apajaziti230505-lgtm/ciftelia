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

## V9 — redaktim i notave dhe ndarje me ngjyra
- Në panelin **Nga audio në tablaturë**, secila strofë ndahet me vijë të trashë me ngjyrë të ndryshme; edhe tablatura shfaq kufijtë me të njëjtat ngjyra.
- Prek një notë në listë (rreshti ndizet me ngjyrë). **+ Shto poshtë notës së zgjedhur** e fut menjëherë poshtë, me kohë mes notës së zgjedhur dhe asaj pas saj. Nuk përdoret më koha aktuale e audios.
- Me **Ndaj strofë te nota e zgjedhur** vendos kufirin sipas notës që ke zgjedhur.
- F (220 Hz) mbetet shoqëruese e parazgjedhur për notat poshtë, me mundësi përjashtimi në secilën goditje. Audioja origjinale nuk modifikohet.


## Versioni V10 — grupe notash të dallueshme me ngjyrë

- Onset Detection mat kohën e goditjeve dhe përdor distancat midis tyre për të **propozuar** grupet. Duhet një pauzë relativisht e gjatë dhe zakonisht të paktën 3 nota në secilën anë; prandaj ndarjet nuk janë gjithmonë identike me strofat muzikore.
- Mund të zgjedhësh një notë dhe të shtypësh **Krijo grup nga nota e zgjedhur**, ose të përdorësh **Nda grupet sipas pauzave**.
- Secili grup ka një përzgjedhës ngjyre. Të gjitha rreshtat e notave në atë grup, kufiri i grupit dhe notat në tablaturë përdorin ngjyrën e njëjtë.
- Emri i grupit mund të ndryshohet. Fusha e perdes është veçmas, 1–13, 14 F, 15 tel i poshtëm i hapur.
- Ndarjet dhe ngjyrat ruhen te `song.stanzas`, duke ruajtur përputhshmërinë me këngët e vjetra; audioja origjinale nuk ndryshohet.

## V11 — Zhvendosje e notës në grupin pasardhës
Në redaktues, butoni “→ Grupi 2” (ose emri i grupit pasardhës) zhvendos **vetëm notën e zgjedhur** te grupi pasardhës. Koha, audioja dhe notat e tjera mbeten të paprekura; ndryshon ngjyra dhe përkatësia e grupit. Ruaj këngën që ndryshimi të mbetet në shfletues dhe në eksportin JSON. Nëse mungon grupi pasardhës, krijoje me “+ Krijo grup”.

## V12 – Rregullim i butonave dhe cache-it
Modulet JavaScript ngarkohen nga `js/v12/` që të mos përzihen skedarët e rinj me skedarët e vjetër të ruajtur nga aplikacioni Android/Safari. Shtuar sinjalizim dhe buton rikuperimi nëse moduli kryesor dështon të ngarkohet. Nuk ndryshojnë funksionet e grupimit ose tingujt realë.

## V13 — Grupi i zgjedhur, lëvizja e notave dhe slow motion

- `Nda grupet sipas pauzave`: **Më shumë grupe** (parazgjedhja), **Normale** ose **Më pak grupe**. Janë kufij heuristikë, jo ndarje e garantuar muzikologjike.
- **↑ / ↓** e çojnë një notë në grupin paraardhës ose pasardhës dhe e shfaqin nën titullin/ngjyrën e grupit ku është caktuar; koha e regjistrimit nuk ndryshon.
- **Krijo grup** te nota e zgjedhur kontrollon kufijtë ekzistues që të mos krijohen dy grupe në të njëjtën kohë. Mund të zgjidhet grupi edhe nga lista.
- **▶ Luaj grupin** luan segmentin kohor midis fillimit të grupit dhe fillimit të grupit tjetër kur kënga përdor audion origjinale. **▶ Luaj** luan këngën e plotë nga fillimi.
- **Shpejtësia**: Normal 1.00× ose Slow Motion 0.50×. Audioja origjinale ngadalësohet pa ndryshuar qëllimisht lartësinë (nëse shfletuesi mbështet `preservesPitch`). Për këngët e krijuara me mostra, ngadalësohen intervalet mes goditjeve pa transpozuar mostrat.

**Kufizim i rëndësishëm:** Në një regjistrim audio të vetëm, një notë e zhvendosur vizualisht te grupi tjetër nuk mund të izolohet fizikisht nga tingujt e tjerë të regjistruar në të njëjtin moment. Luajtja e grupit për audion origjinale ndjek kufijtë kohorë të grupeve; lëvizja manuale e një note ndryshon tablaturën dhe ngjyrën, jo skedarin audio. Për këtë duhet analizë/redaktim audio më i avancuar.


## V14 — Tablatura horizontale dhe kufijtë që lëvizin
- **◀ Majtas / Djathtas ▶** lëvizin pamjen e tablaturës pa ndryshuar kohën e këngës.
- Vijat me ngjyrë tregojnë fillimin e grupeve; shiritat me të njëjtën ngjyrë tregojnë gjithë intervalin kohor të grupit.
- Pasi të hapësh **Redakto këngën**, tërhiq vijën e grupit horizontalisht në tablaturë, ose zgjidh grupin dhe shtyp **-50 ms / +50 ms**. Grupi i parë që fillon në 0 ms mbetet i palëvizshëm.
- **◎ Ndiq muzikën** rikthen ndjekjen automatike gjatë luajtjes. Shpejtësitë 1× dhe 0.50× ruhen.
- Korrigjimet ndryshojnë kufirin e grupit dhe ngjyrat në tablaturë, por **nuk zhvendosin goditjet apo audio-n**. Notat që janë zhvendosur manualisht në një grup tjetër mbajnë ngjyrën dhe anëtarësinë e tij, edhe nëse koha e tyre origjinale ndodhet jashtë segmentit kohor të grupit.
- Shtyp **Ruaj** që ndryshimi të mbetet në pajisjen tënde.


## V15 — Shënim manual i notave
- Importimi i audios nis me tablaturë bosh, pa krijuar automatikisht nota të mundshme. **Onset Detection** është opsional.
- Zgjidh **Shëno manualisht**, luaj audion dhe prek telin përkatës në tablaturë kur dëgjon një goditje. Audioja ndalet në kohën reale të prekjes; zgjidh notën 1–13, F ose G, pastaj **Vendos** ose **Vendos & Vazhdo**.
- Kur audioja është në pauzë, prek pozicionin kohor në tablaturë për ta futur një notë që të ka ikur. Kohën e korrigjon në milisekonda në listën e notave.
- Për regjistrime të ruajtura, kliko **Redakto këngën** ose **Shëno manualisht** dhe ruaji korrigjimet me **Ruaj**.
- **Pastro notat** kërkon konfirmim dhe nuk prek audion. Shënimi manual nuk ndryshon mostrën origjinale ose 30 tingujt.

## V16 — Kontrolli i saktë i tablaturës

- Luaj/Pauzë, Ndalo, ec −1s / +1s, −0.1s / +0.1s, zgjedhja e grupit, Luaj grupin dhe Slow Motion 0.50× janë vendosur ngjitur me tablaturën.
- Mund të zgjedhësh sekondën e saktë (3 shifra dhjetore, saktësi hyrëse 1 ms) ose të përdorësh shiritin e navigimit për gjithë këngën.
- Klikimi në telin e tablaturës e ndalon audion dhe kërkon të vendosë notën **në kohën e klikuar**, jo në pozicionin e vonuar të luajtjes. Vijat e grupeve lëvizen vetëm nga trekëndëshat sipër tyre.
- Në panelin e notës së re mund të korrigjosh kohën para se ta ruash; pas shënimit mund të vazhdosh nga pozicioni i ndalur.
- Shkalla kohore ka shenja çdo 0.1 s dhe etiketa çdo 0.5 s. Vlerat në ekran janë në milisekonda, por saktësia reale e goditjes varet nga audioja dhe përdoruesi.
- Kontrollet përdorin të njëjtin lexues `originalPlayer` për këngët e importuara; nuk krijojnë audion e dytë.
- Testet e logjikës dhe sintaksës janë kryer; testimi i ndërveprimit real me prekje në Android/iPhone mbetet për t'u bërë.


## V17 — Kliko kudo në tablaturë
- Fusha Koha (sekonda) dhe butoni Shko mbeten.
- Mënyra e re **Kliko kudo → Notë** zgjedh kohën nga pozicioni horizontal në çdo zonë të tablaturës, përfshirë shiritin e grupeve dhe sekondat poshtë.
- Klikimi ndalon luajtjen, shfaq një shenjë ? në sekondën e zgjedhur, pastaj zgjedh perden dhe Vendos/Vendos & Vazhdo.
- Pamja horizontale nuk zhvendoset automatikisht pas klikimit. Trekëndëshat sipër kufijve të grupeve mbeten për tërheqjen e tyre.
