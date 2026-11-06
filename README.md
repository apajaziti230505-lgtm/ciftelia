# Çiftelia Studio — 293 Hz + 220 Hz

Rindërtim me TypeScript, Web Audio API dhe AudioWorklet. Dy tela, 13 perde (Q–D), F teli i hapur te kupa; 14 tinguj M4A të nxjerrë nga regjistrimi origjinal. Nuk ka luajtje videoje.

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
- ±15 Hz për secilën notë; F i hapur është 220 Hz (pranohen 205–235 Hz).
- Filtër Low Cut 80 Hz ON, Voice Filter OFF dhe procesim zëri i sistemit OFF sipas opsioneve që respekton shfletuesi.
- `Luaj`: tinguj M4A të planifikuar me orën AudioContext; vizualizim tablature të sinkronizuar.
- `Ruaj`: vetëm sipas zgjedhjes së përdoruesit; ruhet lokalisht në shfletues. `Fshi` dhe `Eksporto JSON`.
- Këngët e ruajtura në localStorage nuk transferohen automatikisht në pajisje tjetër.

## Kufizimet

Koha e AudioWorklet merret nga pozicioni i mostrës, por vonesat e mikrofonit, rezonanca, zhurma dhe mënyra e përpunimit të iOS ndikojnë saktësinë. Njohja e notave dhe filtrat e sistemit mund të ndryshojnë sipas pajisjes; kjo nuk zëvendëson kalibrimin me çiftelinë tënde. Mikrofoni nuk ka monitorim në altoparlant për të shmangur jehonën; kënga dëgjohet pas regjistrimit me `Luaj`. Testoje në iPhone real para publikimit.

**Versioni aktual është publikuar në GitHub Pages.**


## Versioni 3 / Android
- UI: vetëm Low Cut 80 Hz; voice/noise/echo/auto gain nuk janë më kontrolle. Kërkesa e mikrofonit dërgon `false` për procesimin e sistemit (shfletuesi mund të mos i respektojë).
- Mikrofoni njeh **F=220 Hz (205–235 Hz)**. Në çdo notë 1–13 aplikacioni shfaq dhe luan F në telin 2 si shoqërim automatik; nuk dyfishohet nëse kënga e përmban tashmë F në të njëjtën kohë. Regjistrimet origjinale JSON ruhen si melodi, shoqërimi shtohet vetëm gjatë luajtjes.
- + Regjistro, Importo/Eksporto JSON, Ruaj/Fshi.
- Android: hap faqen HTTPS në Chrome dhe zgjidh **Instalo aplikacionin** ose **Shto në ekranin kryesor**. Ky është instalim PWA, jo skedar APK.
- Dosja `android/` përmban projektin Gradle për APK; ndërtimi realizohet me Android SDK/Gradle; versioni APK ekzistues është në GitHub Releases.

### Shkarkimi APK nga GitHub
Pas kalimit me sukses të procesit të ndërtimit në GitHub Actions, APK mund të shkarkohet nga: https://github.com/apajaziti230505-lgtm/ciftelia/releases/download/v2.0.0-android/ciftelia-studio-android.apk. Ky APK është paketë debug për instalim manual; përdor Android System WebView dhe kërkon internet. Mos e ngatërro me versionin PWA ose me aplikacion të publikuar në Play Store.

## Përditësimi F = 220 Hz

- Në çdo perde Q–D ndizet edhe F në kupë (teli shoqërues), me tingullin origjinal 220 Hz, pa transpozim.
- F nuk dyfishohet në këngë kur ekziston në të njëjtin çast; F i luajtur vetë tingëllon vetëm një herë.
- Luajtja nga tastiera, këngët e ruajtura dhe tablatura përdorin të njëjtin shoqërim vizual dhe audio.
- Regjistrimi me mikrofon identifikon notën kryesore dhe nuk dërgon tingull live në altoparlant; shoqërimi shtohet kur luhet kënga.
- Versioni mund të publikohet në GitHub Pages.

## Dy tela të hapur (293 + 220 Hz)

- **F / nota 14**: teli lart i hapur 220 Hz, skedar real M4A.
- **G / nota 15**: teli poshtë i hapur 293 Hz. Nuk kishte mostër të izoluar në regjistrimin e përdoruesit, prandaj versioni aktual e sintetizon tingullin 293 Hz (nuk e transpozon 220 Hz). Kur të regjistrohet ky tel, skedari real mund të zëvendësojë sintezën.
- Në perdet 1–13 dhe në G (293 Hz) luhet gjithmonë edhe F (220 Hz), pa ndryshuar kohët në JSON.
- Klikimi në telin e sipërm luan F (220 Hz); klikimi në fund të telit të poshtëm luan G (293 Hz) me F (220 Hz) shoqëruese.
- Mikrofoni njeh nota 14 dhe 15 me tolerancë ±15 Hz. Kur të dy telat tingëllojnë njëkohësisht, njohja nuk është e garantuar.
- Tastet Q–D: perdet; F: 220 Hz; G: 293 Hz.
- UI u thjeshtua duke hequr përshkrimet e panevojshme.
