"use strict";

// Renditja e saktë e 14 notave audio, sipas kërkesës:
// nota1=Q, nota2=W, nota3=E, nota4=R, nota5=T, nota6=Y, nota7=U,
// nota8=I, nota9=O, nota10=P, nota11=A, nota12=S, nota13=D, nota14=F.
const NOTE_KEYS = [..."qwertyuiopasdf"];
const NUM_NOTES = NOTE_KEYS.length; // 14
const NUM_FRETS = 13;              // Q-D = perdet 1-13; F = teli i hapur te kupa.
const SVG_NS = "http://www.w3.org/2000/svg";

const fretLayer = document.getElementById("fret-layer");
const hitZones = document.getElementById("hit-zones");
const highlights = document.getElementById("highlights");
const status = document.getElementById("status");
const modeEl = document.getElementById("soundMode");
const volumeEl = document.getElementById("volume");
const volumeLabel = document.getElementById("volumeLabel");
const keyboardEl = document.getElementById("note-keyboard");
const recordPlus = document.getElementById("recordPlus");
const songSelect = document.getElementById("zgjidhKengen");
const saveSongButton = document.getElementById("saveSongButton");
const deleteSongButton = document.getElementById("deleteSongButton");
const saveToFolder = document.getElementById("saveToFolder");
const SONG_STORAGE_KEY = "ciftelia_regjistrime_plus_v1";
const SONG_FOLDER = "kenget_e_mia";
const MAX_RECORD_MS = 3 * 60 * 1000;
let recording = false;
let recordStart = 0;
let recordingNotes = [];
let songFolderHandle = null;
let customSongs = [];
let draftSong = null;
let draftAudio = null; // Audioja origjinale e mikrofonit, vetëm derisa të ruhet ose fshihet
let savedExportPaths = new Map(); // Skedarët e eksportuar gjatë këtij sesioni

let timers = [];
let activeAudio = new Set();
let glowTimer = null;
let songAudioContext = null;
let songAudioSources = [];
let songPlaybackId = 0;
const songBufferCache = new Map();
let soundMode = "full";
let volume = 0.8;

// Pozicioni i 13 perdeve në vizatimin SVG.
const startX = 201;
const endX = 1009;
const distanceAt13 = 1 - Math.pow(2, -NUM_FRETS / 12);
const fretXs = [startX];
for (let fret = 1; fret <= NUM_FRETS; fret++) {
    const ratio = (1 - Math.pow(2, -fret / 12)) / distanceAt13;
    fretXs.push(startX + (endX - startX) * ratio);
}

function elementSVG(tag, attrs = {}, text = null) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    if (text !== null) el.textContent = text;
    return el;
}

function krijoPerdet() {
    // Q, W, E, R, T, Y, U, I, O, P, A, S, D = perdet 1-13.
    for (let fret = 1; fret <= NUM_FRETS; fret++) {
        const x = fretXs[fret];
        const before = fretXs[fret - 1];
        const noteNumber = fret;
        const key = NOTE_KEYS[noteNumber - 1];

        fretLayer.appendChild(elementSVG("line", {
            x1: x, y1: 207, x2: x, y2: 253, class: "fret-line"
        }));
        fretLayer.appendChild(elementSVG("text", {
            x: (before + x) / 2, y: 187, class: "fret-number"
        }, `${noteNumber} ${key.toUpperCase()}`));

        // Shenjat në mes të PERDEVE 4, 7, 8 dhe 11 (jo mbi telat).
        if ([4, 7, 8, 11].includes(fret)) {
            const cx = (before + x) / 2;
            fretLayer.appendChild(elementSVG("circle", {
                cx, cy: 229.5, r: 7.2, class: "fret-inlay",
                "aria-label": `Shenjë në perden ${fret}`
            }));
            fretLayer.appendChild(elementSVG("circle", {
                cx, cy: 229.5, r: 2.4, class: "fret-inlay-core"
            }));
        }

        for (let string = 1; string <= 2; string++) {
            const hit = elementSVG("rect", {
                x: before + 1,
                y: string === 1 ? 207 : 229,
                width: Math.max(8, x - before - 1),
                height: 23,
                rx: 2,
                class: "hit",
                tabindex: "0",
                role: "button",
                "aria-label": `Teli ${string}, nota ${noteNumber}, tasti ${key.toUpperCase()}`
            });
            hit.addEventListener("click", () => luajNoten(string, noteNumber));
            hit.addEventListener("keydown", e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    luajNoten(string, noteNumber);
                }
            });
            hitZones.appendChild(hit);
        }
    }

    // Nota e 14-të (F) është TELI I HAPUR: luhet duke prekur telin mbi kupë.
    fretLayer.appendChild(elementSVG("text", {
        x: 1200, y: 410, class: "fret-number", "text-anchor": "middle"
    }, "F · TELI I HAPUR (KUPA)"));

    // Zona e klikimit mbi të dy segmentet e telit në kupë;
    // e luan gjithmonë regjistrimin origjinal të notës F.
    const cupHit = elementSVG("rect", {
        x: 1050, y: 207, width: 330, height: 48,
        rx: 8, class: "hit", tabindex: "0", role: "button",
        "aria-label": "Nota 14, F, teli i hapur te kupa"
    });
    cupHit.addEventListener("click", () => luajNoten(1, 14));
    cupHit.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            luajNoten(1, 14);
        }
    });
    hitZones.appendChild(cupHit);
}

function krijoTastieren() {
    NOTE_KEYS.forEach((key, index) => {
        const numero = index + 1;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "note-key";
        button.dataset.note = String(numero);
        button.setAttribute("aria-label", `Nota ${numero}, tasti ${key.toUpperCase()}`);
        button.innerHTML = `<kbd>${key.toUpperCase()}</kbd><span>${numero === 14 ? "Teli i hapur" : `Perdja ${numero}`}</span>`;
        button.addEventListener("click", () => luajNoten(1, numero));
        keyboardEl.appendChild(button);
    });
}

function aktivizoNotat(notes) {
    highlights.replaceChildren();
    for (const note of notes) {
        // F shfaqet te kupa; Q-D shfaqen në 13 perdet e bishtit.
        const fret = note.noteNumber;
        const x = fret === 14 ? 1210 : (fretXs[fret - 1] + fretXs[fret]) / 2;
        const y = note.string === 1 ? 219 : 240;
        highlights.appendChild(elementSVG("circle", {
            cx: x, cy: y, r: 13, class: "note-glow"
        }));
        highlights.appendChild(elementSVG("circle", {
            cx: x, cy: y, r: 6.5, class: "note-dot"
        }));
    }
}

function tingulliPerNoten(string, noteNumber) {
    if (!Number.isInteger(noteNumber) || noteNumber < 1 || noteNumber > NUM_NOTES) return null;
    // NOTAT E NXJERRA NGA VIDEOJA: nota1-Q ... nota14-F.
    // F (14) luhet si teli i hapur edhe kur kërkohet nga teli 2.
    // Për telin shoqërues përdoret i njëjti regjistrim derisa të kemi
    // regjistrime të veçanta të atij teli.
    const emri = `nota${noteNumber}` + (soundMode === "crisp" ? "_shkurt" : "");
    return { src: `assets/audio/${emri}.wav`, playbackRate: 1 };
}

function tingull(note) {
    if (recording) {
        const time = Math.max(0, Math.round(performance.now() - recordStart));
        if (time <= MAX_RECORD_MS && recordingNotes.length < 2000) {
            recordingNotes.push({ string: note.string, noteNumber: note.noteNumber, time });
        } else {
            perfundoRegjistrimin();
            return;
        }
    }
    const info = tingulliPerNoten(note.string, note.noteNumber);
    if (!info) return;

    const player = new Audio(info.src);
    player.preload = "auto";
    player.playbackRate = info.playbackRate;
    player.volume = volume;
    activeAudio.add(player);

    const cleanup = () => activeAudio.delete(player);
    player.addEventListener("ended", cleanup, { once: true });
    player.addEventListener("error", cleanup, { once: true });
    player.play().catch(() => {
        cleanup();
        status.textContent = "Audio nuk u luajt. Hape projektin me Live Server në VS Code.";
    });
}

function ndaloAudioTePlanifikuar() {
    songPlaybackId++;
    for (const source of songAudioSources) {
        try { source.stop(); } catch (_) { /* përfunduar */ }
        try { source.disconnect(); } catch (_) { }
    }
    songAudioSources = [];
    const ctx = songAudioContext;
    songAudioContext = null;
    if (ctx) void ctx.close().catch(() => {});
}

function ndaloKengen() {
    ndaloAudioTePlanifikuar();
    timers.forEach(clearTimeout);
    timers = [];
    clearTimeout(glowTimer);
    for (const player of activeAudio) {
        player.pause();
        player.currentTime = 0;
    }
    activeAudio.clear();
    highlights.replaceChildren();
    document.querySelectorAll(".note-key.is-playing").forEach(el => el.classList.remove("is-playing"));
    status.textContent = "Ndaluar. Shtyp Q W E R T Y U I O P A S D F për notat 1-14.";
}

function luajNoten(string, noteNumber) {
    if (noteNumber < 1 || noteNumber > NUM_NOTES) return;
    ndaloAudioTePlanifikuar();
    // Ndërprit sekuencën automatike, por lëri notat e sapoluajtura
    // të shuhen natyrshëm kur luhet shpejt me tastierë.
    timers.forEach(clearTimeout);
    timers = [];
    clearTimeout(glowTimer);
    document.querySelectorAll(".note-key.is-playing")
        .forEach(el => el.classList.remove("is-playing"));

    const note = { string, noteNumber };
    aktivizoNotat([note]);
    tingull(note);

    const key = NOTE_KEYS[noteNumber - 1];
    const selected = keyboardEl.querySelector(`[data-note="${noteNumber}"]`);
    if (selected) selected.classList.add("is-playing");
    status.textContent = noteNumber === 14
        ? "Nota 14 = F · Teli i hapur, te kupa (regjistrimi nga iPhone)"
        : `Nota ${noteNumber} = ${key.toUpperCase()} · Perdja ${noteNumber}`;

    glowTimer = setTimeout(() => {
        highlights.replaceChildren();
        if (selected) selected.classList.remove("is-playing");
    }, 200);
}

// Meloditë janë vetëm sekuenca prove (numrat tani janë 1-14).
const databazaKengeve = {
    // Melodi demonstrimi e shpejtë, e bazuar te sekuenca që kërkove.
    kenga1: [
        { string: 1, noteNumber: 4, time: 0 },
        { string: 2, noteNumber: 14, time: 0 },
        { string: 1, noteNumber: 5, time: 150 },
        { string: 2, noteNumber: 14, time: 150 },
        { string: 1, noteNumber: 6, time: 300 },
        { string: 2, noteNumber: 14, time: 300 },
        { string: 1, noteNumber: 7, time: 450 },
        { string: 2, noteNumber: 14, time: 450 },
        { string: 1, noteNumber: 7, time: 600 },
        { string: 2, noteNumber: 14, time: 600 },
        { string: 1, noteNumber: 7, time: 750 },
        { string: 2, noteNumber: 14, time: 750 },
        { string: 1, noteNumber: 7, time: 900 },
        { string: 1, noteNumber: 7, time: 1050 }
    ],
    kenga2: [
        { string: 1, noteNumber: 1, time: 0 },
        { string: 1, noteNumber: 3, time: 180 },
        { string: 1, noteNumber: 5, time: 360 },
        { string: 2, noteNumber: 14, time: 360 },
        { string: 1, noteNumber: 6, time: 540 },
        { string: 1, noteNumber: 8, time: 720 },
        { string: 2, noteNumber: 14, time: 720 }
    ]
};

async function luajKengen() {
    ndaloKengen();
    const id = songSelect.value;
    const notes = databazaKengeve[id] || (draftSong?.id === id ? draftSong.notes : customSongs.find(s => s.id === id)?.notes);
    if (!notes?.length) {
        status.textContent = "Nuk ka nota të regjistruara në këngën e zgjedhur.";
        return;
    }
    const playbackId = songPlaybackId;
    const mode = soundMode;
    status.textContent = 'Po përgatiten tingujt për riprodhim të saktë...';

    // Web Audio planifikon të gjitha goditjet në orën e audios.
    // setTimeout përdoret vetëm për dritat vizuale, jo për tingujt.
    let context;
    try {
        context = new (window.AudioContext || window.webkitAudioContext)();
        songAudioContext = context;
        await context.resume();
        const files = [...new Set(notes.map(note => note.noteNumber))];
        const bufferMap = new Map();
        await Promise.all(files.map(async noteNumber => {
            const cacheKey = `${mode}_${noteNumber}`;
            let buffer = songBufferCache.get(cacheKey);
            if (!buffer) {
                const src = `assets/audio/nota${noteNumber}${mode === 'crisp' ? '_shkurt' : ''}.wav`;
                const res = await fetch(src);
                if (!res.ok) throw new Error('Mungon ' + src);
                buffer = await context.decodeAudioData(await res.arrayBuffer());
                songBufferCache.set(cacheKey, buffer);
            }
            bufferMap.set(noteNumber, buffer);
        }));
        if (playbackId !== songPlaybackId) return;
        const startAt = context.currentTime + .09;
        let maxEndMs = 0;
        for (const note of notes) {
            const buffer = bufferMap.get(note.noteNumber);
            if (!buffer) continue;
            const src = context.createBufferSource();
            const gain = context.createGain();
            src.buffer = buffer;
            gain.gain.value = volume;
            src.connect(gain);
            gain.connect(context.destination);
            src.start(startAt + note.time / 1000);
            songAudioSources.push(src);
            maxEndMs = Math.max(maxEndMs, note.time + buffer.duration * 1000);
        }
        if (playbackId !== songPlaybackId) return;
        status.textContent = '▶ Po luhet melodia me intervalet e regjistruara.';
        const groups = new Map();
        for (const note of notes) {
            if (!groups.has(note.time)) groups.set(note.time, []);
            groups.get(note.time).push(note);
        }
        for (const [time, group] of groups) {
            timers.push(setTimeout(() => {
                if (playbackId === songPlaybackId) aktivizoNotat(group);
            }, time + 90));
        }
        timers.push(setTimeout(() => {
            if (playbackId === songPlaybackId) {
                highlights.replaceChildren();
                status.textContent = 'Melodia përfundoi.';
                ndaloAudioTePlanifikuar();
            }
        }, maxEndMs + 150));
    } catch (error) {
        // Nëse fetch/decodeAudioData bllokohet (p.sh. kur HTML hapet si file://),
        // luaji drejtpërdrejt skedarët audio me HTMLAudioElement.
        // Kjo është rezervë; Live Server mbetet mënyra më e saktë e riprodhimit.
        console.warn('Web Audio nuk u përdor. Kalohet te riprodhimi rezervë:', error);
        if (playbackId !== songPlaybackId) return;
        ndaloAudioTePlanifikuar();
        const fallbackId = songPlaybackId;
        const modeSuffix = mode === 'crisp' ? '_shkurt' : '';
        const groups = new Map();
        for (const note of notes) {
            if (!groups.has(note.time)) groups.set(note.time, []);
            groups.get(note.time).push(note);
        }
        let audioFailed = false;
        status.textContent = '▶ Po luhet melodia (mënyra rezervë audio). Për ritëm më të saktë përdor Live Server.';
        for (const [time, group] of groups) {
            timers.push(setTimeout(() => {
                if (fallbackId !== songPlaybackId) return;
                aktivizoNotat(group);
                for (const note of group) {
                    const player = new Audio(`assets/audio/nota${note.noteNumber}${modeSuffix}.wav`);
                    player.volume = volume;
                    activeAudio.add(player);
                    const cleanup = () => activeAudio.delete(player);
                    player.addEventListener('ended', cleanup, {once:true});
                    player.addEventListener('error', cleanup, {once:true});
                    void player.play().catch(err => {
                        cleanup();
                        audioFailed = true;
                        status.textContent = `Nuk u hap skedari audio: ${err.message}`;
                    });
                }
            }, time));
        }
        timers.push(setTimeout(() => {
            if (fallbackId !== songPlaybackId) return;
            highlights.replaceChildren();
            if (!audioFailed) status.textContent = 'Melodia përfundoi.';
        }, Math.max(...notes.map(n => n.time)) + 1800));
    }
}

// REGJISTRIMI I KËNGËVE — vetëm butoni + në ndërfaqe.
// Regjistron momentin e çdo note nga tastiera, telat dhe butoni Luaj.
function emriSigurt(name) {
    return String(name || "Kenga ime")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")
        .slice(0, 48) || "Kenga_ime";
}

function lexoRegjistrimet() {
    try {
        const raw = JSON.parse(localStorage.getItem(SONG_STORAGE_KEY) || "[]");
        if (!Array.isArray(raw)) return [];
        return raw.filter(s => s && typeof s.id === "string" && Array.isArray(s.notes))
            .map(s => ({
                id: s.id,
                name: String(s.name || "Kënga ime").slice(0, 60),
                source: s.source || "keyboard",
                createdAt: s.createdAt || null,
                ...(Array.isArray(s.events) ? { events: s.events } : {}),
                notes: s.notes.filter(n => Number.isInteger(n.noteNumber) &&
                    n.noteNumber >= 1 && n.noteNumber <= 14 &&
                    (n.string === 1 || n.string === 2) &&
                    Number.isFinite(n.time) && n.time >= 0)
                    .map(n => ({ string: n.string, noteNumber: n.noteNumber, time: n.time }))
            })).slice(-100);
    } catch { return []; }
}

function perditesoButonat() {
    const id = songSelect.value;
    const isDraft = Boolean(draftSong && draftSong.id === id);
    const stored = customSongs.some(s => s.id === id);
    saveSongButton.disabled = !isDraft || !draftSong.notes.length;
    deleteSongButton.disabled = !(isDraft || stored);
}

function rifreskoKengePersonale(preferredId = songSelect.value) {
    songSelect.querySelectorAll('option[data-personal="true"]').forEach(o => o.remove());
    for (const song of customSongs) {
        const option = new Option(`♪ ${song.name}`, song.id);
        option.dataset.personal = "true";
        songSelect.add(option);
    }
    if (draftSong) {
        const option = new Option(`● ${draftSong.name}`, draftSong.id);
        option.dataset.personal = "true";
        songSelect.add(option);
    }
    songSelect.value = Array.from(songSelect.options).some(o => o.value === preferredId)
        ? preferredId : 'kenga1';
    perditesoButonat();
}

function shkarkoFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function pergatitDosjen() {
    if (!window.showDirectoryPicker) return null;
    try {
        if (songFolderHandle) {
            const permission = await songFolderHandle.queryPermission({ mode: "readwrite" });
            if (permission === "granted") return songFolderHandle;
            const granted = await songFolderHandle.requestPermission({ mode: "readwrite" });
            if (granted === "granted") return songFolderHandle;
        }
        // Përdoruesi zgjedh dosjen kryesore të projektit në Chrome/Edge.
        const root = await window.showDirectoryPicker({ mode: "readwrite", id: "ciftelia-kenget" });
        songFolderHandle = await root.getDirectoryHandle(SONG_FOLDER, { create: true });
        return songFolderHandle;
    } catch (error) {
        if (error?.name !== "AbortError") console.warn("Nuk u zgjodh dosja:", error);
        return null;
    }
}

async function shkruajNeDosje(folder, name, blob) {
    const file = await folder.getFileHandle(name, { create: true });
    const writer = await file.createWritable();
    await writer.write(blob);
    await writer.close();
}

function krijoWavNgaPCM(audioBuffer) {
    // PCM 16-bit stereo, për dëgjim edhe jashtë aplikacionit.
    const samples = audioBuffer.length;
    const channels = 2;
    const bytes = 44 + samples * channels * 2;
    const buf = new ArrayBuffer(bytes);
    const view = new DataView(buf);
    let offset = 0;
    const str = value => { for (let i = 0; i < value.length; i++) view.setUint8(offset++, value.charCodeAt(i)); };
    const u16 = value => { view.setUint16(offset, value, true); offset += 2; };
    const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
    str("RIFF"); u32(bytes - 8); str("WAVE"); str("fmt "); u32(16);
    u16(1); u16(channels); u32(audioBuffer.sampleRate);
    u32(audioBuffer.sampleRate * channels * 2); u16(channels * 2); u16(16);
    str("data"); u32(samples * channels * 2);
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < samples; i++) {
        for (const channel of [left, right]) {
            const value = Math.max(-1, Math.min(1, channel[i]));
            view.setInt16(offset, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
            offset += 2;
        }
    }
    return new Blob([buf], { type: "audio/wav" });
}

async function audioNgaNotat(notes, mode, gainValue) {
    if (!notes.length) return null;
    const rate = 44100;
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const buffers = new Map();
    try {
        for (const noteNumber of [...new Set(notes.map(n => n.noteNumber))]) {
            const file = `assets/audio/nota${noteNumber}${mode === "crisp" ? "_shkurt" : ""}.wav`;
            const response = await fetch(file);
            if (!response.ok) throw new Error(`Nuk gjendet ${file}`);
            buffers.set(noteNumber, await context.decodeAudioData(await response.arrayBuffer()));
        }
    } finally {
        await context.close();
    }
    const duration = Math.max(...notes.map(n => n.time / 1000 + buffers.get(n.noteNumber).duration)) + 0.15;
    if (duration > 190) throw new Error("Regjistrimi është shumë i gjatë (maksimumi 3 minuta).");
    const offline = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
    for (const note of notes) {
        const source = offline.createBufferSource();
        const gain = offline.createGain();
        source.buffer = buffers.get(note.noteNumber);
        gain.gain.value = gainValue;
        source.connect(gain);
        gain.connect(offline.destination);
        source.start(note.time / 1000);
    }
    return krijoWavNgaPCM(await offline.startRendering());
}

async function nisRegjistrimin() {
    if (recording || recordPlus.disabled) return;
    if (draftSong && !confirm("Ke një këngë të paregjistruar. Ta hedhim poshtë dhe të fillojmë një regjistrim të ri?")) return;
    if (draftSong) hiqDraftin();
    // Leja për dosjen kërkohet VETËM kur përdoruesi shtyp Ruaj.
    recordingNotes = [];
    recordStart = performance.now();
    recording = true;
    document.getElementById('playButton').disabled = true;
    recordPlus.classList.add("is-recording");
    recordPlus.textContent = "■";
    recordPlus.setAttribute("aria-pressed", "true");
    recordPlus.setAttribute("aria-label", "Ndalo regjistrimin dhe dëgjo këngën provë");
    recordPlus.title = "■ Ndalo regjistrimin (pa ruajtur)";
    status.textContent = "● Regjistrimi filloi. Luaj notat, pastaj shtyp ■. Vendos më pas nëse do ta ruash.";
}

// Një këngë e regjistruar është PROVË derisa përdoruesi të klikojë Ruaj.
function krijoKengeProve(notes, source = "keyboard", extras = {}) {
    if (!notes.length) return false;
    const first = notes[0].time;
    const normalized = notes.map(n => ({
        string: n.string === 2 ? 2 : 1,
        noteNumber: n.noteNumber,
        time: Math.max(0, Math.round(n.time - first))
    }));
    draftSong = {
        id: `prove-${Date.now()}-${Math.floor(Math.random()*10000)}`,
        name: source === "microphone" ? "Nga mikrofoni · pa ruajtur" : "Nga tastiera · pa ruajtur",
        source,
        notes: normalized,
        ...(extras.events ? { events: extras.events } : {})
    };
    draftAudio = extras.audio || null;
    rifreskoKengePersonale(draftSong.id);
    songSelect.value = draftSong.id;
    perditesoButonat();
    status.textContent = `▶ Kënga provë është gati: ${normalized.length} nota. Dëgjoje me Luaj; pastaj kliko Ruaj ose Fshi.`;
    return true;
}

function hiqDraftin() {
    draftSong = null;
    draftAudio = null;
    rifreskoKengePersonale();
}

async function perfundoRegjistrimin() {
    if (!recording) return;
    recording = false;
    document.getElementById('playButton').disabled = false;
    recordPlus.classList.remove("is-recording");
    recordPlus.textContent = "＋";
    recordPlus.setAttribute("aria-pressed", "false");
    recordPlus.setAttribute("aria-label", "Nis regjistrimin e këngës së re");
    recordPlus.title = "+ Nis regjistrimin / ■ Ndalo";
    const notes = recordingNotes.slice();
    recordingNotes = [];
    if (!notes.length) {
        status.textContent = "Nuk u luajt asnjë notë. Asgjë nuk u ruajt.";
        return;
    }
    krijoKengeProve(notes);
}

// Ruaje këngën vetëm nëse përdoruesi shtyp butonin Ruaj.
async function ruajKengenEzgjedhur() {
    if (!draftSong || songSelect.value !== draftSong.id) return;
    const typed = prompt("Si dëshiron ta quash këngën?", `Kënga ime ${customSongs.length + 1}`);
    if (typed === null) return; // Anulim: kënga provë nuk humbet
    const name = typed.trim().slice(0, 60) || `Kënga ime ${customSongs.length + 1}`;
    const createdAt = new Date().toISOString();
    const original = draftSong;
    const song = {
        id: `kenga-${Date.now()}-${Math.floor(Math.random()*10000)}`,
        name, source: original.source, createdAt,
        notes: original.notes,
        ...(original.events ? { events: original.events } : {})
    };
    // Së pari ruaj në shfletues, në mënyrë të qëndrueshme edhe pa leje dosjeje.
    const nextSongs = [...customSongs, song].slice(-100);
    try {
        localStorage.setItem(SONG_STORAGE_KEY, JSON.stringify(nextSongs));
    } catch (err) {
        status.textContent = `Ruajtja në shfletues dështoi: ${err.message}. Provo të lironi hapësirë.`;
        return; // Drafti ruhet për ta provuar sërish
    }
    customSongs = nextSongs;
    const originalMicAudio = draftAudio;
    draftSong = null;
    draftAudio = null;
    rifreskoKengePersonale(song.id);
    songSelect.value = song.id;
    perditesoButonat();
    status.textContent = `✓ “${name}” u ruajt në listë me ${song.notes.length} nota. Mund ta luash edhe pas rifreskimit.`;

    // Eksporti në dosje është veprim OPSIONAL, i kërkuar veçmas me checkbox.
    if (!saveToFolder.checked) return;
    saveSongButton.disabled = true;
    status.textContent = `✓ “${name}” u ruajt në listë. Zgjidh dosjen e projektit për eksportin...`;
    try {
        const folder = await pergatitDosjen();
        if (!folder) {
            status.textContent = `✓ “${name}” mbetet e ruajtur në listë. Eksporti në dosje u anulua.`;
            return;
        }
        const basename = `${emriSigurt(name)}_${createdAt.replace(/[:.]/g, "-")}`;
        const metadata = { version: 3, ...song, toleranceHz: 15 };
        const files = [[`${basename}.json`, new Blob([JSON.stringify(metadata,null,2)],{type:'application/json'})]];
        if (song.events?.length && typeof micExportCSV === 'function') {
            files.push([`${basename}.csv`,new Blob([micExportCSV(song.events)],{type:'text/csv;charset=utf-8'})]);
        }
        // Vetëm gjenerimi i WAV kërkon konvertim të gjatë; mos e lidh me ruajtjen kryesore.
        let audioProblem = '';
        try {
            const wav = await audioNgaNotat(song.notes, soundMode, volume);
            if (wav) files.push([`${basename}.wav`, wav]);
        } catch(err) { audioProblem = err.message; }
        if (originalMicAudio) {
            const ext = originalMicAudio.type.includes('mp4') ? 'm4a' :
                originalMicAudio.type.includes('ogg') ? 'ogg' : 'webm';
            files.push([`${basename}_mikrofoni.${ext}`, originalMicAudio]);
        }
        for (const [filename,blob] of files) await shkruajNeDosje(folder, filename, blob);
        savedExportPaths.set(song.id, files.map(([filename]) => filename));
        status.textContent = `✓ “${name}” u ruajt në listë dhe në dosjen ${SONG_FOLDER}: ${files.map(x => x[0].split('.').pop().toUpperCase()).join(', ')}.${audioProblem ? ` WAV nuk u krijua: ${audioProblem}` : ''}`;
    } catch(err) {
        console.error('Eksporti dështoi',err);
        status.textContent = `✓ “${name}” u ruajt në listë; eksporti në dosje dështoi: ${err.message}.`;
    } finally { perditesoButonat(); }
}

function fshiKengenEzgjedhur() {
    const id = songSelect.value;
    const isDraft = draftSong && draftSong.id === id;
    const stored = customSongs.find(s => s.id === id);
    if (!isDraft && !stored) return;
    if (!confirm(isDraft
        ? 'Ta hedhim poshtë këtë këngë provë?'
        : `Ta fshijmë “${stored.name}” nga lista e aplikacionit? Skedarët e eksportuar në kompjuter nuk fshihen automatikisht.`)) return;
    ndaloKengen();
    if (isDraft) {
        hiqDraftin();
        status.textContent = 'Kënga provë u fshi, pa ruajtur asgjë.';
        return;
    }
    const nextSongs = customSongs.filter(s => s.id !== id);
    try {
        localStorage.setItem(SONG_STORAGE_KEY, JSON.stringify(nextSongs));
    } catch(err) {
        status.textContent = `Fshirja në shfletues dështoi: ${err.message}`;
        return;
    }
    customSongs = nextSongs;
    rifreskoKengePersonale('kenga1');
    songSelect.value = 'kenga1';
    perditesoButonat();
    status.textContent = `“${stored.name}” u fshi nga aplikacioni. Skedarët e eksportuar në dosje, nëse ka, mbeten aty.`;
}

saveSongButton.addEventListener('click', () => { void ruajKengenEzgjedhur(); });
deleteSongButton.addEventListener('click', fshiKengenEzgjedhur);
songSelect.addEventListener('change', perditesoButonat);

recordPlus.addEventListener("click", () => {
    if (recording) void perfundoRegjistrimin();
    else void nisRegjistrimin();
});
customSongs = lexoRegjistrimet();
rifreskoKengePersonale();

// Tastet e tastierës (qwertyuiopasdf) luajnë notat 1-14 sipas rendit.
document.addEventListener("keydown", event => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const key = event.key.toLowerCase();
    const index = NOTE_KEYS.indexOf(key);
    if (index !== -1) {
        event.preventDefault();
        luajNoten(1, index + 1);
    }
});

modeEl.addEventListener("change", event => {
    soundMode = event.target.value === "crisp" ? "crisp" : "full";
    ndaloKengen();
});
volumeEl.addEventListener("input", event => {
    volume = Number(event.target.value) / 100;
    volumeLabel.textContent = `${Math.round(volume * 100)}%`;
    for (const player of activeAudio) player.volume = volume;
});

krijoPerdet();
krijoTastieren();
