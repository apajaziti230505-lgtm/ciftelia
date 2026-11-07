import { AudioEngine } from './audio-engine.js';
import { MicrophoneRecorder } from './microphone.js';
import { KEYS, HZ, DEMO, labelFor, fmt, withOpenF } from './constants.js';
import { allSongs, loadSongs, newSong, saveSongs, exportSong } from './songs.js';
import { analyzeAudio } from './analysis.js';
import { putOriginal, getOriginal, deleteOriginal } from './local-audio.js';
const $ = (id) => document.getElementById(id);
const svg = document.getElementById('ciftelia');
const fretLayer = document.getElementById('fret-layer');
const hitZones = document.getElementById('hit-zones');
const highlights = document.getElementById('highlights');
const audio = new AudioEngine();
const mic = new MicrophoneRecorder(audio);
let savedSongs = loadSongs();
let draft = null;
let selectedId = DEMO[0].id;
let keyboardRecordStart = null;
let keyboardEvents = [];
let micHits = [];
let micActive = false;
let playToken = 0;
let playFrame = 0;
const originalPlayer = $('originalPlayer');
let importFile = null;
let importedHits = [];
let originalObjectUrl = null;
let originalSourceId = null;
let analysisRowsVisible = 60;
let audioSelectToken = 0;
let analyzing = false;
function importedSong(song) { return !!song?.originalAudioId; }
function clearOriginalUrl() { if (originalObjectUrl)
    URL.revokeObjectURL(originalObjectUrl); originalObjectUrl = null; originalSourceId = null; originalPlayer.removeAttribute('src'); originalPlayer.load(); }
function showOriginalBlob(blob, id) {
    clearOriginalUrl();
    originalObjectUrl = URL.createObjectURL(blob);
    originalSourceId = id;
    originalPlayer.src = originalObjectUrl;
    originalPlayer.hidden = false;
    originalPlayer.load();
}
async function prepareOriginalForSelection() {
    const song = currentSong();
    const token = ++audioSelectToken;
    if (!importedSong(song)) {
        originalPlayer.pause();
        originalPlayer.hidden = true;
        clearOriginalUrl();
        return;
    }
    if (song.originalAudioId === '__draft' && importFile) {
        if (originalSourceId !== '__draft')
            showOriginalBlob(importFile, '__draft');
        return;
    }
    if (originalSourceId === song.originalAudioId)
        return;
    originalPlayer.pause();
    originalPlayer.hidden = true;
    clearOriginalUrl();
    try {
        const blob = await getOriginal(song.originalAudioId);
        if (token !== audioSelectToken)
            return;
        if (!blob) {
            setStatus('Nuk gjendet audioja e kësaj kënge në këtë pajisje. JSON ruan notat, jo skedarin audio.');
            return;
        }
        showOriginalBlob(blob, song.originalAudioId);
    }
    catch (e) {
        if (token === audioSelectToken)
            setStatus('Audioja e ruajtur nuk u lexua: ' + String(e));
    }
}
const fretXs = [201];
const denom = 1 - Math.pow(2, -13 / 12);
for (let i = 1; i <= 13; i++) {
    fretXs.push(201 + 808 * (1 - Math.pow(2, -i / 12)) / denom);
}
function setStatus(s) { $('status').textContent = s; }
function setMicStatus(s) { $('micStatus').textContent = s; }
function currentSong() {
    if (selectedId === '__draft')
        return draft;
    return allSongs(savedSongs).find(s => s.id === selectedId) || null;
}
function songForDisplay() { return currentSong(); }
function renderSongs() {
    const selected = selectedId;
    const select = $('songSelect');
    select.replaceChildren();
    if (draft) {
        const opt = new Option(`● PROVË — ${draft.name}`, '__draft');
        select.add(opt);
    }
    for (const song of allSongs(savedSongs))
        select.add(new Option(song.name, song.id));
    select.value = selected;
    if (select.selectedIndex < 0)
        select.selectedIndex = 0;
    selectedId = select.value;
    const selectedSong = currentSong();
    const isUserSong = !!selectedSong && selectedSong.id !== 'draft' && !DEMO.some(s => s.id === selectedSong.id);
    $('saveBtn').toggleAttribute('disabled', !(draft && draft.notes.length > 0));
    $('deleteBtn').toggleAttribute('disabled', !isUserSong && selectedId !== '__draft');
    $('exportBtn').toggleAttribute('disabled', !selectedSong || !selectedSong.notes.length);
    $('songMeta').textContent = `${selectedSong?.notes.length ?? 0} nota · ${selectedSong ? fmt((selectedSong.notes.at(-1)?.time ?? 0) + 300) : '00:00.00'}`;
    renderTimeline();
}
function sEl(tag, attrs, text) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    if (text !== undefined)
        el.textContent = text;
    return el;
}
function renderInstrument() {
    for (let n = 1; n <= 13; n++) {
        const l = fretXs[n - 1], r = fretXs[n], cx = (l + r) / 2;
        fretLayer.append(sEl('line', { x1: r, x2: r, y1: 208, y2: 253, 'stroke': '#dec5a0', 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: .95 }));
        fretLayer.append(sEl('text', { x: cx, y: 188, 'text-anchor': 'middle', fill: '#bbad9c', 'font-size': 15, 'font-weight': 650 }, `${n}`));
        if ([4, 7, 8, 11].includes(n))
            fretLayer.append(sEl('circle', { cx, cy: 230.5, r: 5.2, fill: '#edb657', stroke: '#352012', 'stroke-width': 2, opacity: .9 }));
        for (const string of [1, 2]) {
            const number = string === 1 ? n : 14;
            const name = string === 1 ? `Perdja ${n}, teli poshtë, ${labelFor(n)}` : 'Teli lart i hapur F, 220 Hz';
            const rect = sEl('rect', { x: l + 1, y: string === 1 ? 231 : 208, width: Math.max(8, r - l - 1), height: 22, fill: 'transparent', style: 'cursor:pointer', tabindex: 0, role: 'button', 'aria-label': name });
            rect.addEventListener('pointerdown', () => void hit(number, string));
            rect.addEventListener('keydown', (e) => { const k = e; if (k.key === 'Enter' || k.key === ' ') {
                k.preventDefault();
                void hit(number, string);
            } });
            hitZones.append(rect);
        }
    }
    for (const string of [1, 2]) {
        const number = string === 1 ? 15 : 14;
        const cup = sEl('rect', { x: 1050, y: string === 1 ? 230 : 207, width: 308, height: 24, rx: 6, fill: 'transparent', style: 'cursor:pointer', tabindex: 0, role: 'button', 'aria-label': string === 1 ? 'Teli poshtë i hapur G, 293 Hz' : 'Teli lart i hapur F, 220 Hz' });
        cup.addEventListener('pointerdown', () => void hit(number, string));
        cup.addEventListener('keydown', (e) => { const k = e; if (k.key === 'Enter' || k.key === ' ') {
            k.preventDefault();
            void hit(number, string);
        } });
        hitZones.append(cup);
    }
    fretLayer.append(sEl('text', { x: 1200, y: 409, 'text-anchor': 'middle', fill: '#d6ad79', 'font-size': 20, 'font-weight': 800 }, 'F · LART 220 Hz'));
    fretLayer.append(sEl('text', { x: 1200, y: 434, 'text-anchor': 'middle', fill: '#f3d49d', 'font-size': 20, 'font-weight': 800 }, 'G · POSHTË 293 Hz'));
}
function showActive(events) {
    highlights.replaceChildren();
    const visualEvents = importedSong(currentSong()) ? events : withOpenF(events);
    const shown = new Set();
    for (const ev of visualEvents) {
        const key = `${ev.string}-${ev.noteNumber}`;
        if (shown.has(key))
            continue;
        shown.add(key);
        const cx = ev.noteNumber >= 14 ? 1175 : (fretXs[ev.noteNumber - 1] + fretXs[ev.noteNumber]) / 2;
        const cy = ev.string === 1 ? 240 : 219;
        highlights.append(sEl('circle', { cx, cy, r: 17, fill: '#fbbf24', opacity: .32, filter: 'url(#glow)' }));
        highlights.append(sEl('circle', { cx, cy, r: 7.7, fill: '#f59e0b', stroke: '#fef3c7', 'stroke-width': 2 }));
    }
    const last = [...events].reverse().find(e => e.noteNumber !== 14) ?? events.at(-1);
    $('liveNote').textContent = last ? `${labelFor(last.noteNumber)}${last.noteNumber !== 14 ? ' + F' : ''}` : '—';
    $('liveHz').textContent = last ? `${HZ[last.noteNumber - 1]} Hz${last.noteNumber !== 14 ? ' · F 220 Hz' : ''}` : '— Hz';
}
function renderKeys() {
    const root = $('keypad');
    root.replaceChildren();
    KEYS.forEach((key, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `keycap ${i >= 13 ? 'keycap-open' : ''}`;
        el.innerHTML = `<strong>${key.toUpperCase()}</strong><span>${i === 13 ? 'LART HAPUR' : i === 14 ? 'POSHTË HAPUR' : `PERDJA ${i + 1}`}</span><small>${HZ[i]} Hz</small>`;
        el.addEventListener('pointerdown', () => void hit(i + 1, i === 13 ? 2 : 1));
        root.append(el);
    });
}
async function hit(noteNumber, string) {
    if (micActive) {
        setStatus('Mikrofoni është aktiv. Ndaloje për të luajtur notat në shfletues.');
        return;
    }
    try {
        void audio.hit(noteNumber).catch(e => setStatus(String(e.message || e)));
    }
    catch (e) {
        setStatus(String(e));
    }
    showActive([{ string, noteNumber, time: 0 }]);
    if (keyboardRecordStart !== null) {
        const now = performance.now();
        if (keyboardEvents.length === 0)
            keyboardRecordStart = now;
        keyboardEvents.push({ string, noteNumber, time: Math.round(now - keyboardRecordStart), velocity: audio.strength === 'lehte' ? .35 : .92 });
        $('recordCounter').textContent = `${keyboardEvents.length} nota`;
    }
    setStatus(`${labelFor(noteNumber)} · ${HZ[noteNumber - 1]} Hz · Teli ${string}${noteNumber !== 14 ? ' + F (i hapur 220 Hz)' : ''}`);
}
function createDraftFromNotes(notes, name) {
    draft = newSong(name, notes);
    selectedId = '__draft';
    renderSongs();
    setStatus(`U krijua një provë me ${notes.length} nota. Shtyp Luaj për ta dëgjuar, pastaj Ruaj nëse dëshiron.`);
}
function recordKeyboard() {
    if (micActive) {
        setStatus('Ndalo mikrofonin përpara regjistrimit me tastierë.');
        return;
    }
    if (keyboardRecordStart !== null) {
        keyboardRecordStart = null;
        $('recordBtn').classList.remove('recording');
        $('recordBtn').textContent = '＋ Regjistro';
        createDraftFromNotes(keyboardEvents, 'Regjistrim me tastierë');
        return;
    }
    stopPlayback();
    keyboardEvents = [];
    keyboardRecordStart = performance.now();
    $('recordBtn').classList.add('recording');
    $('recordBtn').textContent = '■ Ndal regjistrimin';
    $('recordCounter').textContent = '0 nota';
    setStatus('Regjistrimi nisi. Luaj notat, pastaj ndalo.');
}
function filterOptions() {
    return { lowCut: $('lowCut').checked, sensitivity: Number($('sensitivity').value) };
}
function renderMicHits() {
    const root = $('micEvents');
    root.replaceChildren();
    if (!micHits.length) {
        root.textContent = 'Ende nuk ka goditje të regjistruara.';
        return;
    }
    const start = micHits.slice(-100);
    const base = micHits.length - start.length;
    start.forEach((h, i) => {
        const row = document.createElement('div');
        row.className = 'mic-hit';
        const time = document.createElement('span');
        time.className = 'hit-time';
        time.textContent = `+${Math.round(h.time - (micHits[base + i - 1]?.time ?? 0))}ms`;
        const freq = document.createElement('span');
        freq.className = 'hit-freq';
        freq.textContent = h.hz ? `${h.hz.toFixed(1)} Hz` : 'Hz ?';
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Korrigjo notën në kohën ${h.time} ms`);
        select.add(new Option('? — e panjohur', ''));
        KEYS.forEach((k, index) => select.add(new Option(`${k.toUpperCase()} · ${HZ[index]} Hz`, String(index + 1))));
        select.value = String(h.noteNumber ?? '');
        select.addEventListener('change', () => { h.noteNumber = select.value ? Number(select.value) : null; if (!micActive)
            updateDraftFromMic(); });
        row.append(time, select, freq);
        root.append(row);
    });
}
function updateDraftFromMic() {
    const notes = micHits.filter(h => h.noteNumber !== null).map(h => ({ string: h.noteNumber === 14 ? 2 : 1, noteNumber: h.noteNumber, time: h.time, measuredHz: h.hz ?? undefined, confidence: h.clarity }));
    if (draft && selectedId === '__draft') {
        draft.notes = notes;
        renderSongs();
    }
}
function stopMic() {
    mic.stop();
    micActive = false;
    $('micBtn').textContent = '🎙 Nis mikrofonin';
    $('micBtn').classList.remove('recording');
    const notes = micHits.filter(h => h.noteNumber !== null).map(h => ({ string: h.noteNumber === 14 ? 2 : 1, noteNumber: h.noteNumber, time: h.time, measuredHz: h.hz ?? undefined, confidence: h.clarity }));
    createDraftFromNotes(notes, 'Regjistrim me mikrofon');
    renderMicHits();
    const unknown = micHits.filter(h => h.noteNumber === null).length;
    setMicStatus(`U ndal mikrofoni. ${notes.length} nota të njohura; ${unknown} të paqarta. Për ? përdor listën më poshtë për të zgjedhur notën, pastaj Luaj dhe Ruaj.`);
}
async function toggleMic() {
    if (micActive) {
        stopMic();
        return;
    }
    if (keyboardRecordStart !== null)
        recordKeyboard();
    stopPlayback();
    setMicStatus('Po kërkohet leja e mikrofonit…');
    try {
        await mic.start(filterOptions());
        micActive = true;
        micHits = [];
        renderMicHits();
        $('micBtn').textContent = '■ Ndal mikrofonin';
        $('micBtn').classList.add('recording');
        setMicStatus('Mikrofoni aktiv. Luaj vetëm telin e poshtëm. Tingulli nuk kthehet në altoparlant për të shmangur jehonën.');
    }
    catch (e) {
        setMicStatus(`Gabim: ${e instanceof Error ? e.message : String(e)}`);
    }
}
mic.onHit = (hit) => {
    micHits.push(hit); // keep editable list separate from worklet-owned array
    $('micCurrent').textContent = hit.noteNumber ? `${labelFor(hit.noteNumber)} · ${HZ[hit.noteNumber - 1]} Hz` : '? · notë e paqartë';
    $('micMeasured').textContent = hit.hz ? `${hit.hz.toFixed(1)} Hz` : '— Hz';
    $('micInterval').textContent = micHits.length > 1 ? `${hit.time - micHits[micHits.length - 2].time} ms` : '0 ms';
    $('micCount').textContent = `${micHits.filter(h => h.noteNumber !== null).length} / ${micHits.length}`;
    if (hit.noteNumber)
        showActive([hit]);
    renderMicHits();
};
function stopPlayback() { playToken++; cancelAnimationFrame(playFrame); audio.stop(); originalPlayer.pause(); showActive([]); $('playBtn').textContent = '▶ Luaj'; $('studioState').textContent = 'GATI'; }
async function playCurrent() {
    if (micActive) {
        setStatus('Ndalo mikrofonin para luajtjes.');
        return;
    }
    if (keyboardRecordStart !== null)
        recordKeyboard();
    stopPlayback();
    const song = currentSong();
    if (!song) {
        setStatus('Zgjidh këngën.');
        return;
    }
    if (!song.notes.length && !importedSong(song)) {
        setStatus('Kënga nuk ka nota të njohura. Korrigjo notat ? te regjistrimi.');
        return;
    }
    const token = ++playToken;
    if (importedSong(song)) {
        if (!originalPlayer.src) {
            setStatus('Mungon audioja origjinale në këtë pajisje. Zgjidh këngën sërish.');
            return;
        }
        try {
            await originalPlayer.play();
        }
        catch (e) {
            setStatus('Shfletuesi nuk nisi audion: ' + String(e));
            $('playBtn').textContent = '▶ Luaj';
        }
        return;
    }
    $('playBtn').textContent = '… Po ngarkohet';
    $('studioState').textContent = 'NGARKIM';
    try {
        await audio.play(song);
        if (token !== playToken)
            return;
        $('playBtn').textContent = '▶ Po luhet';
        $('studioState').textContent = 'DUKE LUAJTUR';
        setStatus(`Po luhet ${song.name} · ${song.notes.length} nota`);
        const loop = () => {
            if (token !== playToken)
                return;
            const ms = audio.elapsedMs;
            const current = song.notes.filter(n => Math.abs(n.time - ms) < 75);
            if (current.length)
                showActive(current);
            drawTab(song, ms);
            $('timeLabel').textContent = `${fmt(ms)} / ${fmt(song.notes.at(-1).time + 600)}`;
            if (audio.done()) {
                stopPlayback();
                setStatus('Kënga përfundoi.');
                return;
            }
            playFrame = requestAnimationFrame(loop);
        };
        loop();
    }
    catch (e) {
        $('playBtn').textContent = '▶ Luaj';
        $('studioState').textContent = 'GABIM';
        setStatus(`Audio: ${e instanceof Error ? e.message : String(e)}`);
    }
}
async function saveDraft() {
    if (!draft || !draft.notes.length) {
        setStatus('Nuk ka këngë provë për ruajtje.');
        return;
    }
    const title = prompt('Emri i këngës:', draft.name);
    if (title === null)
        return;
    if (!title.trim()) {
        setStatus('Vendos një emër për këngën.');
        return;
    }
    const saved = { ...draft, id: newSong(title, []).id, name: title.trim() };
    if (draft.originalAudioId === '__draft' && importFile) {
        try {
            await putOriginal(saved.id, importFile);
            saved.originalAudioId = saved.id;
        }
        catch (e) {
            setStatus(`Audioja nuk u ruajt në këtë pajisje: ${String(e)}. Liro hapësirë dhe provo përsëri.`);
            return;
        }
    }
    const next = [...savedSongs, saved];
    if (!saveSongs(next)) {
        if (saved.originalAudioId)
            void deleteOriginal(saved.id).catch(() => { });
        setStatus('Ruajtja dështoi: hapësira e shfletuesit është plot. Eksporto JSON.');
        return;
    }
    savedSongs = next;
    draft = null;
    selectedId = saved.id;
    importedHits = [];
    importFile = null;
    renderImportedHits();
    renderSongs();
    void prepareOriginalForSelection();
    setStatus(`Kënga “${saved.name}” u ruajt në këtë shfletues.`);
}
async function deleteSong() {
    if (selectedId === '__draft') {
        if (confirm('Ta fshijmë këngën provë?')) {
            draft = null;
            importFile = null;
            importedHits = [];
            renderImportedHits();
            selectedId = DEMO[0].id;
            renderSongs();
            void prepareOriginalForSelection();
            setStatus('Prova u fshi.');
        }
        return;
    }
    const song = currentSong();
    if (!song || DEMO.some(d => d.id === song.id))
        return;
    if (!confirm(`Ta fshijmë këngën “${song.name}”?`))
        return;
    const next = savedSongs.filter(s => s.id !== song.id);
    if (!saveSongs(next)) {
        setStatus('Fshirja nuk u ruajt.');
        return;
    }
    savedSongs = next;
    if (song.originalAudioId)
        try {
            await deleteOriginal(song.originalAudioId);
        }
        catch { }
    selectedId = DEMO[0].id;
    renderSongs();
    void prepareOriginalForSelection();
    setStatus('Kënga u fshi nga ky shfletues.');
}
const canvas = $('tabCanvas');
function drawTab(song, elapsed = 0) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width), h = 175;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext('2d');
    if (!c)
        return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#101c2c';
    c.fillRect(0, 0, w, h);
    const x0 = Math.min(160, w * .3), pxPerMs = .18;
    c.strokeStyle = '#37465a';
    c.lineWidth = 1;
    for (const y of [60, 120]) {
        c.beginPath();
        c.moveTo(16, y);
        c.lineTo(w - 16, y);
        c.stroke();
    }
    c.fillStyle = '#95a4b5';
    c.font = '12px system-ui';
    c.fillText('TELI 2 · LART', 14, 45);
    c.fillText('TELI 1 · POSHTË', 14, 106);
    c.strokeStyle = '#fac35f';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0, 20);
    c.lineTo(x0, 160);
    c.stroke();
    if (song) {
        for (const e of importedSong(song) ? song.notes : withOpenF(song.notes)) {
            const x = x0 + (e.time - elapsed) * pxPerMs;
            if (x < 8 || x > w - 8)
                continue;
            const y = e.string === 1 ? 120 : 60;
            c.beginPath();
            c.arc(x, y, 11, 0, Math.PI * 2);
            c.fillStyle = Math.abs(e.time - elapsed) < 60 ? '#f2b657' : '#203f4f';
            c.fill();
            c.strokeStyle = '#f2b657';
            c.lineWidth = 1;
            c.stroke();
            c.fillStyle = Math.abs(e.time - elapsed) < 60 ? '#141e2b' : '#f6e6ca';
            c.font = 'bold 12px system-ui';
            c.textAlign = 'center';
            c.fillText(labelFor(e.noteNumber), x, y + 4);
            c.textAlign = 'start';
        }
    }
    else {
        c.font = '14px system-ui';
        c.fillStyle = '#8d9bac';
        c.fillText('Regjistro ose zgjidh një këngë.', x0 + 18, 90);
    }
}
function renderTimeline() { drawTab(songForDisplay(), 0); $('timeLabel').textContent = `00:00.00 / ${fmt((songForDisplay()?.notes.at(-1)?.time || 0) + 600)}`; }
async function importSongFile(file) {
    try {
        if (file.size > 2_000_000)
            throw new Error('Skedari është tepër i madh.');
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== 'object')
            throw new Error('JSON i pavlefshëm.');
        const obj = data;
        if (!Array.isArray(obj.notes) || obj.notes.length < 1 || obj.notes.length > 10000)
            throw new Error('Lista e notave nuk është e vlefshme.');
        const notes = obj.notes.map((v) => {
            const n = v;
            if (!n || (n.string !== 1 && n.string !== 2) || !Number.isInteger(n.noteNumber) || n.noteNumber < 1 || n.noteNumber > 15 || !Number.isFinite(n.time) || n.time < 0 || n.time > 3_600_000)
                throw new Error('Një notë ka vlera të pavlefshme.');
            return { string: n.string, noteNumber: n.noteNumber, time: n.time };
        });
        const name = typeof obj.name === 'string' ? obj.name : 'Këngë e importuar';
        stopPlayback();
        createDraftFromNotes(notes, name);
        setStatus('Kënga u importua si PROVË. Shtyp Luaj dhe pastaj Ruaj nëse dëshiron.');
    }
    catch (e) {
        setStatus(`Importimi dështoi: ${e instanceof Error ? e.message : String(e)}`);
    }
}
/** Importimi ruan skedarin e plotë, ndërsa notat e zbuluara mbeten propozime të korrigjueshme. */
function updateImportDraft() {
    if (!draft || draft.originalAudioId !== '__draft')
        return;
    draft.notes = importedHits.filter(h => h.noteNumber !== null).map(h => ({
        time: Math.round(h.time), noteNumber: h.noteNumber, string: h.noteNumber === 14 ? 2 : h.string, confidence: h.confidence
    })).sort((a, b) => a.time - b.time || a.string - b.string);
    renderSongs();
}
function renderImportedHits() {
    const editor = $('analysisEdit');
    const rows = $('analysisRows');
    rows.replaceChildren();
    editor.hidden = !importedHits.length;
    $('analysisAddBtn').toggleAttribute('disabled', !importFile);
    if (!importedHits.length)
        return;
    const unknown = importedHits.filter(h => h.noteNumber === null).length;
    $('analysisCount').textContent = `${importedHits.length} shënime · ${unknown} të paqarta`;
    importedHits.sort((a, b) => a.time - b.time || a.string - b.string);
    importedHits.slice(0, analysisRowsVisible).forEach((hit) => {
        const row = document.createElement('div');
        row.className = 'analysis-note-row';
        if (hit.noteNumber === null)
            row.classList.add('unknown');
        const ms = document.createElement('input');
        ms.type = 'number';
        ms.min = '0';
        ms.step = '1';
        ms.max = String(Math.round((originalPlayer.duration || 150) * 1000));
        ms.value = String(hit.time);
        ms.setAttribute('aria-label', 'Koha e notës në milisekonda');
        // Numri mund të shkruhet drejtpërdrejt: 1–13 perde, 14 F lart, 15 G poshtë i hapur.
        const fret = document.createElement('input');
        fret.type = 'number';
        fret.min = '1';
        fret.max = '15';
        fret.step = '1';
        fret.placeholder = 'Perdja 1–13';
        fret.setAttribute('aria-label', 'Shkruaj numrin e perdes 1–13, ose 14 F, 15 G');
        fret.title = '1–13: perdet; 14: teli lart F 220 Hz; 15: teli poshtë i hapur G 293 Hz';
        fret.value = hit.noteNumber === null ? '' : String(hit.noteNumber);
        const str = document.createElement('select');
        str.setAttribute('aria-label', 'Teli');
        str.add(new Option('Poshtë', '1'));
        str.add(new Option('Lart', '2'));
        str.value = String(hit.string);
        const status = document.createElement('span');
        status.className = 'analysis-confidence';
        status.textContent = hit.noteNumber === null ? '?' : hit.confidence < .65 ? 'Kontrollo' : 'Propozim';
        status.title = hit.detail;
        const seek = document.createElement('button');
        seek.type = 'button';
        seek.className = 'btn btn-minimal';
        seek.textContent = 'Dëgjo';
        seek.addEventListener('click', () => { originalPlayer.currentTime = hit.time / 1000; void originalPlayer.play().catch(e => setStatus(String(e))); });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-minimal';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Fshi këtë shënim');
        remove.addEventListener('click', () => { importedHits = importedHits.filter(x => x !== hit); updateImportDraft(); renderImportedHits(); });
        ms.addEventListener('change', () => { hit.time = Math.min(Math.round((originalPlayer.duration || 150) * 1000), Math.max(0, Math.round(Number(ms.value) || 0))); updateImportDraft(); renderImportedHits(); });
        fret.addEventListener('change', () => {
            const value = fret.value.trim();
            const n = value === '' ? null : Number(value);
            if (n !== null && (!Number.isInteger(n) || n < 1 || n > 15)) {
                setStatus('Shkruaj perden 1–13, ose 14 (F lart) / 15 (G poshtë i hapur).');
                fret.value = hit.noteNumber === null ? '' : String(hit.noteNumber);
                return;
            }
            hit.noteNumber = n;
            hit.string = n === 14 ? 2 : 1;
            hit.confidence = n === null ? 0 : 1;
            hit.detail = n === null ? 'Pa notë' : 'Vendosur manualisht';
            updateImportDraft();
            renderImportedHits();
        });
        str.addEventListener('change', () => { hit.string = hit.noteNumber === 14 ? 2 : Number(str.value); updateImportDraft(); });
        row.append(ms, fret, str, status, seek, remove);
        rows.append(row);
    });
    $('analysisMoreBtn').hidden = analysisRowsVisible >= importedHits.length;
}
async function importAudioFile(file) {
    if (analyzing)
        return;
    if (file.size > 25_000_000) {
        setStatus('Audioja është mbi 25 MB. Përdor regjistrim më të shkurtër.');
        return;
    }
    if (!file.type.startsWith('audio/') && !/\.(wav|m4a|mp3|ogg)$/i.test(file.name)) {
        setStatus('Zgjidh skedar audio WAV, M4A ose MP3.');
        return;
    }
    stopPlayback();
    importFile = file;
    importedHits = [];
    analysisRowsVisible = 60;
    draft = newSong(file.name.replace(/\.[^.]+$/, ''), []);
    draft.originalAudioId = '__draft';
    selectedId = '__draft';
    renderSongs();
    renderImportedHits();
    showOriginalBlob(file, '__draft');
    $('analyzeBtn').removeAttribute('disabled');
    $('analysisProgress').setAttribute('value', '0');
    $('analysisStatus').textContent = 'Audioja u ngarkua. Shtyp Analizo notat.';
    setStatus('Dëgjo origjinalin ose shtyp Analizo notat. Asgjë nuk ruhet pa shtypur Ruaj.');
}
async function analyzeImported() {
    if (!importFile || analyzing)
        return;
    analyzing = true;
    $('analyzeBtn').setAttribute('disabled', '');
    $('audioImportFile').setAttribute('disabled', '');
    try {
        const ctx = await audio.unlock();
        const decoded = await ctx.decodeAudioData((await importFile.arrayBuffer()).slice(0));
        const report = await analyzeAudio(decoded, (n, intensity) => audio.loadNote(n, intensity), (s, pct) => {
            $('analysisStatus').textContent = s;
            $('analysisProgress').value = pct;
        });
        importedHits = report.hits;
        analysisRowsVisible = 60;
        updateImportDraft();
        renderImportedHits();
        setStatus(`U gjetën ${report.detectedOnsets} goditje të mundshme. ${report.uncertainCount} janë të pasigurta. Kontrollo para Ruaj.`);
    }
    catch (e) {
        $('analysisStatus').textContent = 'Analiza nuk përfundoi.';
        setStatus('Gabim në analizë: ' + String(e));
    }
    finally {
        analyzing = false;
        $('analyzeBtn').toggleAttribute('disabled', !importFile);
        $('audioImportFile').removeAttribute('disabled');
    }
}
let deferredInstall = null;
function installAndroid() {
    const promptEvent = deferredInstall;
    if (!promptEvent) {
        setStatus('Në Android: Chrome → ⋮ → Shto në ekranin kryesor / Instalo aplikacionin.');
        return;
    }
    void promptEvent.prompt().then(() => promptEvent.userChoice).then(() => { deferredInstall = null; $('installBtn').hidden = true; }).catch(() => { });
}
function init() {
    renderInstrument();
    renderKeys();
    renderSongs();
    renderMicHits();
    audio.setVolume(Number($('volume').value) / 100);
    $('songSelect').addEventListener('change', e => { stopPlayback(); selectedId = e.target.value; renderSongs(); void prepareOriginalForSelection(); });
    $('recordBtn').addEventListener('click', recordKeyboard);
    $('micBtn').addEventListener('click', () => void toggleMic());
    $('playBtn').addEventListener('click', () => void playCurrent());
    $('stopBtn').addEventListener('click', () => { stopPlayback(); if (micActive)
        stopMic(); if (keyboardRecordStart !== null)
        recordKeyboard(); setStatus('Ndaluar.'); });
    $('saveBtn').addEventListener('click', () => void saveDraft());
    $('deleteBtn').addEventListener('click', () => void deleteSong());
    $('exportBtn').addEventListener('click', () => { const song = currentSong(); if (song)
        exportSong(song); });
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', () => { const input = $('importFile'); if (input.files?.[0])
        void importSongFile(input.files[0]); input.value = ''; });
    $('audioImportFile').addEventListener('change', () => { const input = $('audioImportFile'); if (input.files?.[0])
        void importAudioFile(input.files[0]); input.value = ''; });
    $('analyzeBtn').addEventListener('click', () => void analyzeImported());
    $('analysisAddBtn').addEventListener('click', () => {
        if (!importFile)
            return;
        importedHits.push({ time: Math.max(0, Math.round(originalPlayer.currentTime * 1000)), noteNumber: null, string: 1, confidence: 0, detail: 'Shtuar manualisht' });
        analysisRowsVisible = Math.max(analysisRowsVisible, importedHits.length);
        updateImportDraft();
        renderImportedHits();
    });
    $('analysisMoreBtn').addEventListener('click', () => { analysisRowsVisible += 60; renderImportedHits(); });
    originalPlayer.addEventListener('play', () => {
        const song = currentSong();
        if (!importedSong(song))
            return;
        audio.stop();
        cancelAnimationFrame(playFrame);
        const token = ++playToken;
        $('playBtn').textContent = '▶ Po luhet';
        $('studioState').textContent = 'ORIGJINAL';
        const tick = () => {
            if (token !== playToken || originalPlayer.paused)
                return;
            const ms = originalPlayer.currentTime * 1000;
            drawTab(song, ms);
            $('timeLabel').textContent = `${fmt(ms)} / ${fmt((originalPlayer.duration || 0) * 1000)}`;
            const now = song.notes.filter(n => Math.abs(n.time - ms) < 70);
            if (now.length)
                showActive(now);
            playFrame = requestAnimationFrame(tick);
        };
        tick();
        setStatus('Po luhet regjistrimi origjinal. 220 Hz nuk shtohet artificialisht.');
    });
    originalPlayer.addEventListener('pause', () => { cancelAnimationFrame(playFrame); if (importedSong(currentSong())) {
        $('playBtn').textContent = '▶ Luaj';
        $('studioState').textContent = 'PAUZË';
    } });
    originalPlayer.addEventListener('ended', () => { stopPlayback(); setStatus('Kënga origjinale përfundoi.'); });
    originalPlayer.addEventListener('timeupdate', () => {
        const song = currentSong();
        if (!importedSong(song))
            return;
        const ms = originalPlayer.currentTime * 1000;
        drawTab(song, ms);
        $('timeLabel').textContent = `${fmt(ms)} / ${fmt((originalPlayer.duration || 0) * 1000)}`;
        const active = song.notes.filter(n => Math.abs(n.time - ms) < 65);
        if (active.length)
            showActive(active);
    });
    $('installBtn').addEventListener('click', installAndroid);
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('installBtn').hidden = false; });
    if ('serviceWorker' in navigator)
        window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => { }); });
    $('volume').addEventListener('input', e => { const value = Number(e.target.value); audio.setVolume(value / 100); $('volumeOut').textContent = `${value}%`; });
    $('soundMode').addEventListener('change', e => { audio.mode = e.target.value === 'full' ? 'full' : 'short'; });
    $('strengthMode').addEventListener('change', e => { audio.strength = e.target.value === 'lehte' ? 'lehte' : 'fort'; });
    $('lowCut').addEventListener('change', () => mic.setFilters(filterOptions()));
    $('sensitivity').addEventListener('input', () => { mic.setSensitivity(filterOptions().sensitivity); $('sensitivityOut').textContent = $('sensitivity').value; });
    window.addEventListener('keydown', e => {
        if (e.repeat || e.altKey || e.metaKey || e.ctrlKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement?.tagName || '')))
            return;
        const index = KEYS.indexOf(e.key.toLowerCase());
        if (index >= 0) {
            e.preventDefault();
            void hit(index + 1, 1);
        }
        if (e.code === 'Space') {
            e.preventDefault();
            void playCurrent();
        }
    });
    window.addEventListener('resize', () => renderTimeline());
    window.addEventListener('pagehide', () => { if (micActive)
        mic.stop(); audio.stop(); originalPlayer.pause(); });
    $('status').textContent = 'Gati për të luajtur.';
    // Marrja e regjistrimeve nuk nis zërin pa një veprim të përdoruesit.
    void audio.prepare();
}
init();
