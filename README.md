# Çiftelia Studio

Aplikacion për çifteli me dy tela, 13 perde, tablaturë dhe tinguj realë.
Katalogu i përfshirë përmban vetëm **Shtat shaljan kanë ra në Shtoj**:
`./songs/shtat-shaljan.json` dhe `./songs/shtat-shaljan.mp3`.
Ushtrimet shembull janë hequr.

## Përdorimi në kompjuter

Hap terminalin brenda kësaj dosjeje dhe ekzekuto:

```sh
python3 -m http.server 8000
```

Në Windows mund të përdorësh `py -m http.server 8000`.
Hap `http://localhost:8000` në shfletues. JavaScript është i përpiluar;
për përdorim nuk nevojitet instalim me npm.
Për mikrofonin nga telefoni nevojitet një faqe HTTPS.

## Çfarë përmban

- Luajtje e MP3-së së këngës me tablaturë të sinkronizuar.
- Luajtje e notave me mostra reale të çiftelisë, dy tela dhe shoqërim F.
- Shpejtësi 1.00×, 0.50× dhe 0.25×.
- Grupe me ngjyra, kopjim/ngjitje, zhvendosje notash dhe zhbërje/ribërje.
- Shënim manual, import/eksport JSON, regjistrim dhe mikrofon.

Këngët e regjistruara ruhen në shfletuesin e pajisjes.
JSON-i përmban notat; audioja e regjistrimeve të reja ruhet veçmas.
Analiza automatike e notave është orientuese dhe mund të kërkojë korrigjim.

## Kodi dhe zhvillimi

- `src/`: burimi TypeScript.
- `js/`: modulet aktive JavaScript.
- `assets/audio-real/`: 30 goditje reale, lehtë dhe fort.
- `songs/`: katalogu, JSON-i dhe MP3-ja e këngës.
- `tests/`: kontrollet e logjikës së aplikacionit.
- `android/`: projekti WebView për Android; udhëzimet janë në README-n e tij.

Për ndryshime në TypeScript:

```sh
npm install --no-package-lock --no-audit --no-fund
npm run build
npm test
```
