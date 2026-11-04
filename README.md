# Çiftelia Studio TS — regjistrimi origjinal (220 / 440 Hz)

Rindërtim me TypeScript, Web Audio API dhe AudioWorklet. Dy tela, 13 perde (Q–D), F teli i hapur te kupa; 14 tingujt e rinj të nxjerrë nga “Strimnitsa 2(1).m4a”, pa transpozim; skedarët AAC/M4A për përdorim në shfletues. Nuk ka luajtje videoje.

## Nisja

Nga dosja ku është `index.html`, hape një terminal dhe ekzekuto:

```bash
python -m http.server 8000
```

Hape `http://localhost:8000`. Në telefon, për përdorim të mikrofonit duhet **HTTPS**; shërbimi HTTP në rrjet lokal zakonisht nuk mjafton.

## Ndryshimi i kodit

Kodi i redaktueshëm është te `src/*.ts` (përfshirë `src/mic-onset-worklet.ts`). Kodi `js/*.js` është JavaScript i përpiluar dhe është i përfshirë në ZIP, kështu faqja hapet pa komandë build. Kur ndryshon TypeScript:

```bash
tsc -p tsconfig.json
```

`tsc` është TypeScript compiler; mund të instalohet me `npm install -g typescript`.

## Funksionet

- Prek notat Q–D mbi bisht ose F mbi kupë; tastiera `qwertyuiopasdf`.
- `+ Regjistro`: shënon notat e shtypura me tastierë dhe kohën në ms.
- `Mikrofon`: kërkon leje, dëgjon vetëm telin e poshtëm dhe detekton goditje me AudioWorklet.
- ±15 Hz rreth frekuencave të vlerësuara nga regjistrimi: 330,359,392,440,482,523,586,660,721,788,883,970,1053 dhe F (i hapur) ≈220 Hz. Këto janë vlerësime; harmonikat 220/440 mund të vështirësojnë njohjen.
- Filtër Low Cut 80 Hz ON, Voice Filter OFF dhe procesim zëri i sistemit OFF sipas opsioneve që respekton shfletuesi.
- `Luaj`: tinguj M4A të planifikuar me orën AudioContext; vizualizim tablature të sinkronizuar.
- `Ruaj`: vetëm sipas zgjedhjes së përdoruesit; ruhet lokalisht në shfletues. `Fshi` dhe `Eksporto JSON`.
- Këngët e ruajtura në localStorage nuk transferohen automatikisht në pajisje tjetër.

## Kufizimet

Koha e AudioWorklet merret nga pozicioni i mostrës, por vonesat e mikrofonit, rezonanca, zhurma dhe mënyra e përpunimit të iOS ndikojnë saktësinë. Njohja e notave dhe filtrat e sistemit mund të ndryshojnë sipas pajisjes; kjo nuk zëvendëson kalibrimin me çiftelinë tënde. Mikrofoni nuk ka monitorim në altoparlant për të shmangur jehonën; kënga dëgjohet pas regjistrimit me `Luaj`. Testoje në iPhone real para publikimit.

**Akordimi origjinal 220/440 Hz. Asnjë ndryshim automatik i lartësisë ose ritmit të tingullit.**

## Regjistrimi i ri (4 nëntor 2026)

Goditjet 1–13 janë perdet 1–13 dhe goditja 14 është teli i hapur. Audioja u nda në variantet e plota dhe të shkurtra me fillim/fund të zbutur, filtrin e lehtë 70 Hz, pa ndryshim të lartësisë së tingullit. Shiko `notat_nga_regjistrimi.csv`. Ruajtja e këngëve vazhdon të jetë lokale në shfletues.
