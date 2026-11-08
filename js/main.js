import { AudioEngine } from './audio-engine.js';
import { MicrophoneRecorder } from './microphone.js';
import { KEYS, HZ, DEMO, labelFor, fmt, withOpenF, upperFret, noteFrequency } from './constants.js';
import { allSongs, loadSongs, newSong, saveSongs, exportSong, upsertSong, prefersNotePlayback } from './songs.js';
import { analyzeAudio } from './analysis.js';
import { putOriginal, getOriginal, deleteOriginal } from './local-audio.js';
import { GROUP_COLORS, detectNoteGroups, groupAtTime, groupForNote } from './grouping.js';
import { timelineGeometry, timelineX, timelineTime, clampTimelineStart, clampGroupBoundary, findGroupBoundary } from './timeline.js';
import { manualAnywhereTime, manualEntryNote } from './manual.js';
import { notesAtMoment, noteAttackColor } from './practice.js';
import { copySongGroup, pasteSongGroup, replaceSongGroup, deleteSongGroup, parseSongJSON } from './song-editing.js';
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
let editingSongId = null;
let groupClipboard = null;
let groupUndo = null;
let jsonBaseSong = null;
let jsonBaseSelectedId = '';
let stanzas = [{ start: 0, label: 'Grupi 1', color: GROUP_COLORS[0] }];
let selectedImportedHit = null;
let selectedGroupStart = 0;
let activeGroupEndMs = null;
let playbackSpeed = 1;
let currentPlayMode = 'all';
// Koha e riprodhimit dhe pamja horizontale mbahen të ndara.
let tabCurrentMs = 0;
let tabViewStartMs = 0;
let tabFollowPlayback = true;
let tabDrag = null;
// Manual transcription: a tap captures the audio playback time; the user chooses the fret.
let manualMode = false;
let instantTabNoteMode = false;
let manualPending = null;
let syntheticStartMs = 0;
let seekPendingUntilMetadata = null;
let lastDisplayKey = '';
let playbackSource = 'original';
const liveAttacks = [];
let tabNoteDrag = null;
const catalogSongs = [];
const catalogAudioURLs = new Map();
const STANZA_COLORS = GROUP_COLORS;
function importedSong(song) { return !!song?.originalAudioId; }
function usingOriginal(song) {
    return importedSong(song) && playbackSource === 'original' && audio.upperEnabled;
}
function accompaniment() {
    return { withF: true, upperNoteNumber: 14 };
}
function fillUpperOptions(select, allowOff = false) {
    select.add(new Option('F · automatikisht', '14'));
    for (let n = 1; n <= 13; n++)
        select.add(new Option(`Lart · perdja ${n}`, String(n)));
    if (allowOff)
        select.add(new Option('Pa telin lart', 'off'));
    select.value = '14';
}
function selectSongPlayback(song) {
    const localCatalogEdit = !!song && catalogSongs.some(s => s.id === song.id) && savedSongs.some(s => s.id === song.id);
    playbackSource = prefersNotePlayback(song, localCatalogEdit) ? 'notes' : 'original';
}
function useNotePlayback() {
    const position = playbackPositionMs();
    stopPlayback();
    playbackSource = 'notes';
    if (draft)
        draft.preferNotes = true;
    seekToMs(position);
}
function initNoteControls() {
    audio.upperEnabled = true;
    audio.upperNoteNumber = 14;
    fillUpperOptions($('manualUpperNote'), true);
    fillUpperOptions($('tabUpperNote'), true);
    $('tabUpperNote').addEventListener('change', () => {
        const hit = selectedImportedHit;
        if (!hit || hit.string === 2)
            return;
        const value = $('tabUpperNote').value;
        hit.withF = value !== 'off';
        if (hit.withF)
            hit.upperNoteNumber = upperFret(Number(value));
        useNotePlayback();
        updateImportDraft();
        renderImportedHits();
        setStatus('Teli lart u ndryshua për këtë notë. Shtyp Ruaj.');
    });
}
function clearOriginalUrl() { seekPendingUntilMetadata = null; if (originalObjectUrl)
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
            const remote = catalogAudioURLs.get(song.originalAudioId);
            if (remote) {
                try {
                    const rr = await fetch(remote, { method: 'HEAD' });
                    if (token !== audioSelectToken)
                        return;
                    if (rr.ok) {
                        originalSourceId = song.originalAudioId;
                        originalPlayer.src = remote;
                        originalPlayer.hidden = false;
                        originalPlayer.load();
                        return;
                    }
                }
                catch { }
                setStatus('Kënga e provës ka notat. Shtyp Lidh MP3 për audion origjinale.');
                return;
            }
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
    return allSongs(savedSongs, catalogSongs).find(s => s.id === selectedId) || null;
}
function refreshGroupCopyControls() {
    const song = currentSong(), groups = activeSongGroups(song), index = groups.findIndex(g => g.start === selectedGroupStart);
    const hasNotes = !!song && song.notes.some(n => groupForNote(groups, n) === index);
    $('groupCopyBtn').toggleAttribute('disabled', !hasNotes);
    $('groupDeleteBtn').toggleAttribute('disabled', !song || (!song.notes.length && groups.length === 1));
    $('groupDeleteBtn').title = `Fshi ${groups[index]?.label ?? 'grupin e zgjedhur'} dhe notat e tij`;
    const target = $('groupPasteTarget'), previous = target.value;
    target.replaceChildren(new Option('Zgjidh grupin pritës…', ''), ...groups.map(g => new Option(`${g.label} · ${fmt(g.start)}`, String(g.start))), new Option('＋ Grup i ri në fund', '__end'));
    target.options[0].disabled = true;
    target.value = Array.from(target.options).some(o => o.value === previous) ? previous : '';
    target.disabled = !song || !groupClipboard;
    $('groupPasteBtn').toggleAttribute('disabled', !song || !groupClipboard || !target.value);
    $('groupPasteBtn').textContent = target.value === '__end' ? '＋ Ngjit si grup i ri' : '＋ Ngjit te grupi';
    $('groupUndoBtn').toggleAttribute('disabled', !editableTab() || !groupUndo);
    $('groupClipboardStatus').textContent = groupClipboard
        ? `Kopjuar: ${groupClipboard.label} · ${groupClipboard.notes.length} nota. Zgjidh grupin pritës; notat e tij do të zëvendësohen.`
        : 'Zgjidh grupin që dëshiron ta kopjosh ose ta fshish.';
}
function setEditableSong(song) {
    draft = { ...song, notes: song.notes.map(n => ({ ...n })) };
    stanzas = sanitizeStanzas(song.stanzas);
    draft.stanzas = stanzas;
    importedHits = song.notes.map(n => ({ ...n, string: n.noteNumber === 14 ? 2 : n.string, confidence: n.confidence ?? 1,
        withF: n.withF !== false, upperNoteNumber: upperFret(n.upperNoteNumber), detail: 'Redaktuar' }));
    selectedId = '__draft';
    selectedImportedHit = null;
    manualPending = null;
    manualMode = true;
    instantTabNoteMode = false;
    analysisRowsVisible = 60;
    renderSongs();
    renderImportedHits();
    renderManualMode();
}
function copySelectedGroup() {
    const song = currentSong();
    if (!song)
        return;
    try {
        groupClipboard = copySongGroup(song, selectedGroupStart, tabSongEnd(song));
        $('groupPasteTarget').value = '';
        refreshGroupCopyControls();
        setStatus(`U kopjua ${groupClipboard.label}. Zgjidh ku ta ngjitësh.`);
    }
    catch (e) {
        setStatus(String(e.message || e));
    }
}
async function pasteCopiedGroup() {
    if (micActive || keyboardRecordStart !== null) {
        setStatus('Ndalo regjistrimin para ngjitjes së grupit.');
        return;
    }
    if (manualPending) {
        setStatus('Vendos ose anulo notën e hapur përpara ngjitjes.');
        return;
    }
    const song = currentSong(), target = $('groupPasteTarget').value;
    if (!song || !groupClipboard)
        return;
    if (!target) {
        setStatus('Zgjidh grupin ku dëshiron ta ngjitësh.');
        return;
    }
    const previousGroup = selectedGroupStart, previousTime = playbackPositionMs();
    try {
        const result = target === '__end' ? pasteSongGroup(song, groupClipboard, Math.ceil(tabSongEnd(song)))
            : replaceSongGroup(song, groupClipboard, Number(target), Math.ceil(tabSongEnd(song)));
        if (!editableTab())
            await editSavedAudio();
        if (selectedId !== '__draft' || draft?.id !== song.id)
            return;
        groupUndo = { song: structuredClone(draft), selectedGroupStart: previousGroup, time: previousTime };
        stopPlayback();
        selectedGroupStart = result.groupStart;
        setEditableSong(result.song);
        useNotePlayback();
        seekToMs(result.groupStart);
        focusTimelineAt(result.groupStart);
        $('groupPasteTarget').value = String(result.groupStart);
        refreshGroupCopyControls();
        setStatus('Notat u ngjitën në grupin që zgjodhe. Mund ta zhbësh; shtyp Ruaj që ndryshimi të mbetet.');
    }
    catch (e) {
        setStatus(String(e.message || e));
    }
}
async function deleteSelectedGroup() {
    if (micActive || keyboardRecordStart !== null || manualPending) {
        setStatus('Përfundo shënimin ose regjistrimin përpara fshirjes së grupit.');
        return;
    }
    const song = currentSong();
    if (!song)
        return;
    const previousGroup = selectedGroupStart, previousTime = playbackPositionMs();
    try {
        const result = deleteSongGroup(song, selectedGroupStart);
        if (!editableTab())
            await editSavedAudio();
        if (selectedId !== '__draft' || draft?.id !== song.id)
            return;
        groupUndo = { song: structuredClone(draft), selectedGroupStart: previousGroup, time: previousTime };
        stopPlayback();
        selectedGroupStart = result.groupStart;
        setEditableSong(result.song);
        useNotePlayback();
        seekToMs(result.groupStart);
        focusTimelineAt(result.groupStart);
        refreshGroupCopyControls();
        setStatus('U fshi grupi me notat e tij. Kohët e notave të tjera mbetën siç ishin. Zhbëj e kthen veprimin.');
    }
    catch (e) {
        setStatus(String(e.message || e));
    }
}
function undoGroupPaste() {
    if (!editableTab() || !groupUndo)
        return;
    const undo = groupUndo;
    groupUndo = null;
    stopPlayback();
    selectedGroupStart = undo.selectedGroupStart;
    setEditableSong(undo.song);
    selectSongPlayback(draft);
    seekToMs(undo.time);
    refreshGroupCopyControls();
    setStatus('Veprimi i fundit mbi grupin u zhbë.');
}
function openJSONEditor() {
    const song = currentSong();
    if (!song)
        return;
    if (micActive || keyboardRecordStart !== null) {
        setStatus('Ndalo regjistrimin përpara redaktimit të JSON-it.');
        return;
    }
    if (manualPending) {
        setStatus('Vendos ose anulo notën e hapur përpara redaktimit të JSON-it.');
        return;
    }
    stopPlayback();
    jsonBaseSong = structuredClone(song);
    jsonBaseSelectedId = selectedId;
    $('jsonEditorText').value = JSON.stringify(song, null, 2);
    $('jsonEditorStatus').textContent = 'Ndrysho emrin, notat ose grupet; pastaj zbatoji në tablaturë.';
    $('jsonEditorStatus').classList.remove('is-error');
    $('jsonEditorDialog').showModal();
}
function validateJSONEditor(format = false) {
    if (!jsonBaseSong)
        return null;
    try {
        const song = parseSongJSON($('jsonEditorText').value, jsonBaseSong);
        if (format)
            $('jsonEditorText').value = JSON.stringify(song, null, 2);
        $('jsonEditorStatus').textContent = `JSON i vlefshëm: ${song.notes.length} nota · ${song.stanzas?.length ?? 1} grupe.`;
        $('jsonEditorStatus').classList.remove('is-error');
        return song;
    }
    catch (e) {
        $('jsonEditorStatus').textContent = String(e.message || e);
        $('jsonEditorStatus').classList.add('is-error');
        return null;
    }
}
function applyJSONEditor() {
    const song = validateJSONEditor();
    if (!song)
        return;
    stopPlayback();
    groupUndo = null;
    if (jsonBaseSelectedId !== '__draft') {
        editingSongId = jsonBaseSong.id;
        importFile = null;
    }
    setEditableSong(song);
    $('jsonEditorDialog').close();
    void prepareOriginalForSelection();
    useNotePlayback();
    setStatus('JSON-i u zbatua në tablaturë. Shtyp Ruaj për ta mbajtur në këtë shfletues ose Eksporto JSON për skedarin.');
}
function songForDisplay() { return currentSong(); }
function activeSongGroups(song) {
    return sanitizeStanzas(song?.stanzas);
}
function refreshGroupPicker(song) {
    const select = $('selectedGroupSelect');
    const groups = activeSongGroups(song);
    if (!groups.some(g => g.start === selectedGroupStart))
        selectedGroupStart = groups[0].start;
    select.replaceChildren(...groups.map((g, i) => new Option(g.label, String(g.start))));
    select.value = String(selectedGroupStart);
    const top = $('practiceGroupSelect');
    top.replaceChildren(...groups.map((g, i) => new Option(g.label, String(g.start))));
    top.value = String(selectedGroupStart);
    $('practiceGroupBtn').toggleAttribute('disabled', !song || (!song.notes.length && !importedSong(song)));
    $('groupPlayBtn').toggleAttribute('disabled', !song || (!song.notes.length && !importedSong(song)));
}
function selectGroup(start) {
    const groups = activeSongGroups(currentSong());
    const group = groups.find(g => g.start === start);
    if (!group)
        return;
    selectedGroupStart = group.start;
    $('selectedGroupSelect').value = String(group.start);
    $('practiceGroupSelect').value = String(group.start);
    document.querySelectorAll('.stanza-entry').forEach(el => el.classList.toggle('group-active', el.dataset.groupStart === String(group.start)));
    focusTimelineAt(group.start);
    if (groupClipboard)
        $('groupPasteTarget').value = String(group.start);
    refreshGroupCopyControls();
    setStatus(`U zgjodh ${group.label}. Vija me ngjyrë shfaqet në tablaturë.`);
}
function renderSongs() {
    const selected = selectedId;
    const select = $('songSelect');
    select.replaceChildren();
    if (draft) {
        const opt = new Option(`● PROVË — ${draft.name}`, '__draft');
        select.add(opt);
    }
    for (const song of allSongs(savedSongs, catalogSongs))
        select.add(new Option((catalogSongs.some(s => s.id === song.id) ? '♫ ' : '') + song.name, song.id));
    select.value = selected;
    if (select.selectedIndex < 0)
        select.selectedIndex = 0;
    selectedId = select.value;
    const selectedSong = currentSong();
    if (selectedId !== '__draft' && !audio.playing && originalPlayer.paused)
        selectSongPlayback(selectedSong);
    const isCatalogSong = !!selectedSong && catalogSongs.some(s => s.id === selectedSong.id);
    const isUserSong = !!selectedSong && savedSongs.some(s => s.id === selectedSong.id);
    const isOverride = isUserSong && (isCatalogSong || DEMO.some(s => s.id === selectedSong.id));
    $('deleteBtn').textContent = selectedId === '__draft' ? 'Fshi provën' : isOverride ? 'Rikthe origjinalin' : 'Fshi';
    $('catalogAudioBtn').hidden = !isCatalogSong;
    $('saveBtn').toggleAttribute('disabled', !draft);
    $('analysisEditSavedBtn').toggleAttribute('disabled', !selectedSong || (!selectedSong.notes.length && !selectedSong.originalAudioId) || selectedId === '__draft');
    $('deleteBtn').toggleAttribute('disabled', !isUserSong && selectedId !== '__draft');
    $('exportBtn').toggleAttribute('disabled', !selectedSong);
    $('jsonEditBtn').toggleAttribute('disabled', !selectedSong);
    $('songMeta').textContent = `${selectedSong?.notes.length ?? 0} nota · ${selectedSong ? fmt((selectedSong.notes.at(-1)?.time ?? 0) + 300) : '00:00.00'}`;
    if (isOverride)
        $('songMeta').textContent += ' · Ndryshime lokale';
    refreshGroupPicker(selectedSong);
    refreshGroupCopyControls();
    clearPlayedNote();
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
            const number = n;
            const name = string === 1 ? `Perdja ${n}, teli poshtë, ${labelFor(n)}` : `Teli lart, perdja ${n}`;
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
}
function showActive(events, groupColor = '#e8b45a', history = events) {
    const visualEvents = withOpenF(events, audio.upperEnabled);
    const expandedHistory = withOpenF(history, audio.upperEnabled);
    const key = visualEvents.map(e => `${e.string}/${e.noteNumber}/${e.time}`).join('|') + '@' + groupColor;
    if (key === lastDisplayKey)
        return;
    lastDisplayKey = key;
    highlights.replaceChildren();
    const shown = new Set();
    for (const ev of visualEvents) {
        const id = `${ev.string}-${ev.noteNumber}`;
        if (shown.has(id))
            continue;
        shown.add(id);
        const cx = ev.noteNumber >= 14 ? 1175 : (fretXs[ev.noteNumber - 1] + fretXs[ev.noteNumber]) / 2;
        const cy = ev.string === 1 ? 240 : 219;
        const color = noteAttackColor(expandedHistory, ev, ev.string === 2 ? '#63d9c9' : groupColor);
        const label = ev.noteNumber === 14 ? 'F' : ev.noteNumber === 15 ? 'G' : String(ev.noteNumber);
        highlights.append(sEl('circle', { cx, cy, r: 23, fill: color, opacity: .33, filter: 'url(#glow)' }));
        highlights.append(sEl('circle', { cx, cy, r: 14.5, fill: color, stroke: '#fff4e0', 'stroke-width': 2.4 }));
        highlights.append(sEl('text', { x: cx, y: cy + 5.4, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 850, fill: '#122133', 'pointer-events': 'none' }, label));
    }
}
/** Active markings represent the attack, not a latch that persists until another note. */
function updatePlaybackNotes(song, ms) {
    const history = withOpenF(song.notes, audio.upperEnabled);
    const active = notesAtMoment(history, ms);
    const lead = active.find(n => n.string === 1) ?? active[0];
    const groups = activeSongGroups(song);
    const color = lead ? groups[groupForNote(groups, lead)]?.color || GROUP_COLORS[0] : GROUP_COLORS[0];
    showActive(active, color, history);
}
function clearPlayedNote() {
    showActive([]);
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
    if (!audio.upperEnabled && (string === 2 || noteNumber === 14)) {
        setStatus('Teli lart është i heshtur: është zgjedhur vetëm teli poshtë.');
        return;
    }
    const config = accompaniment();
    const event = { string, noteNumber, time: performance.now(), ...config };
    void audio.hit(noteNumber, string, config.withF, config.upperNoteNumber).catch(e => setStatus(String(e.message || e)));
    liveAttacks.push(event);
    if (liveAttacks.length > 200)
        liveAttacks.splice(0, 100);
    showActive([event], '#e8b45a', liveAttacks);
    if (keyboardRecordStart !== null) {
        const now = performance.now();
        if (keyboardEvents.length === 0)
            keyboardRecordStart = now;
        keyboardEvents.push({ ...event, time: Math.round(now - keyboardRecordStart), velocity: audio.strength === 'lehte' ? .35 : .92 });
        $('recordCounter').textContent = `${keyboardEvents.length} nota`;
    }
    const upper = audio.upperEnabled && string === 1 && config.withF
        ? ` + ${config.upperNoteNumber === 14 ? 'F hapur' : `teli lart, perdja ${config.upperNoteNumber}`}` : '';
    setStatus(`${noteNumber === 14 ? 'F' : noteNumber === 15 ? 'G' : `Perdja ${noteNumber}`} · ${Math.round(noteFrequency(noteNumber, string))} Hz · Teli ${string === 1 ? 'poshtë' : 'lart'}${upper}`);
}
function createDraftFromNotes(notes, name) {
    draft = newSong(name, notes);
    editingSongId = null;
    groupUndo = null;
    importedHits = notes.map(n => ({ ...n, confidence: n.confidence ?? 1, detail: 'Vendosur' }));
    stanzas = sanitizeStanzas(draft.stanzas);
    selectedId = '__draft';
    renderSongs();
    renderImportedHits();
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
    const notes = micHits.filter(h => h.noteNumber !== null).map(h => ({ string: (h.noteNumber === 14 ? 2 : 1), noteNumber: h.noteNumber, time: h.time, measuredHz: h.hz ?? undefined, confidence: h.clarity, withF: h.withF, upperNoteNumber: h.upperNoteNumber }));
    if (draft && selectedId === '__draft') {
        draft.notes = notes;
        importedHits = notes.map(n => ({ ...n, confidence: n.confidence ?? 1, detail: 'Nga mikrofoni' }));
        renderSongs();
        renderImportedHits();
    }
}
function stopMic() {
    mic.stop();
    micActive = false;
    $('micBtn').textContent = '🎙 Nis mikrofonin';
    $('micBtn').classList.remove('recording');
    const notes = micHits.filter(h => h.noteNumber !== null).map(h => ({ string: (h.noteNumber === 14 ? 2 : 1), noteNumber: h.noteNumber, time: h.time, measuredHz: h.hz ?? undefined, confidence: h.clarity, withF: h.withF, upperNoteNumber: h.upperNoteNumber }));
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
    Object.assign(hit, accompaniment());
    micHits.push(hit); // keep editable list separate from worklet-owned array
    $('micCurrent').textContent = hit.noteNumber ? `${labelFor(hit.noteNumber)} · ${HZ[hit.noteNumber - 1]} Hz` : '? · notë e paqartë';
    $('micMeasured').textContent = hit.hz ? `${hit.hz.toFixed(1)} Hz` : '— Hz';
    $('micInterval').textContent = micHits.length > 1 ? `${hit.time - micHits[micHits.length - 2].time} ms` : '0 ms';
    $('micCount').textContent = `${micHits.filter(h => h.noteNumber !== null).length} / ${micHits.length}`;
    if (hit.noteNumber)
        showActive([hit], '#e8b45a', micHits.filter(h => h.noteNumber !== null));
    renderMicHits();
};
function stopPlayback() {
    playToken++;
    cancelAnimationFrame(playFrame);
    audio.stop();
    originalPlayer.pause();
    activeGroupEndMs = null;
    currentPlayMode = 'all';
    clearPlayedNote();
    $('playBtn').textContent = '▶ Luaj';
    $('groupPlayBtn').textContent = '▶ Luaj grupin';
    $('studioState').textContent = 'GATI';
    syncTabTransport();
}
function selectedGroupRange(song) {
    const groups = activeSongGroups(song);
    const i = Math.max(0, groups.findIndex(g => g.start === selectedGroupStart));
    const start = groups[i].start;
    const audioEnd = usingOriginal(song) && Number.isFinite(originalPlayer.duration) ? Math.round(originalPlayer.duration * 1000) : tabSongEnd(song);
    const end = Math.max(start + 100, Math.min(audioEnd, groups[i + 1]?.start ?? audioEnd));
    return { start, end, name: groups[i].label, index: i };
}
function configurePlaybackSpeed() {
    originalPlayer.playbackRate = playbackSpeed;
    if ('preservesPitch' in originalPlayer)
        originalPlayer.preservesPitch = true;
}
function completeGroupPlayback() {
    stopPlayback();
    setStatus('Luajtja e grupit përfundoi.');
}
async function playSelectedGroup() {
    if (micActive) {
        setStatus('Ndalo mikrofonin përpara luajtjes.');
        return;
    }
    if (keyboardRecordStart !== null)
        recordKeyboard();
    const song = currentSong();
    if (!song) {
        setStatus('Zgjidh një këngë.');
        return;
    }
    const range = selectedGroupRange(song);
    stopPlayback();
    currentPlayMode = 'group';
    tabCurrentMs = range.start;
    tabFollowPlayback = true;
    tabViewStartMs = clampTimelineStart(range.start - visibleTab().visibleMs * .25, visibleTab().visibleMs, tabSongEnd(song));
    redrawTab();
    if (usingOriginal(song)) {
        if (!originalPlayer.src) {
            setStatus('Mungon audioja origjinale në këtë pajisje.');
            return;
        }
        activeGroupEndMs = range.end;
        configurePlaybackSpeed();
        try {
            originalPlayer.currentTime = range.start / 1000;
            await originalPlayer.play();
            $('groupPlayBtn').textContent = '▶ Po luhet grupi';
            setStatus(`Po luhet vetëm ${range.name} · ${playbackSpeed.toFixed(2)}×`);
        }
        catch (e) {
            stopPlayback();
            setStatus('Gabim gjatë luajtjes së grupit: ' + String(e));
        }
        return;
    }
    const notes = song.notes.filter(n => groupForNote(activeSongGroups(song), n) === range.index);
    if (!notes.length) {
        stopPlayback();
        setStatus('Grupi i zgjedhur nuk ka nota.');
        return;
    }
    const first = Math.min(...notes.map(n => n.time));
    syntheticStartMs = first;
    const clip = { ...song, notes: notes.map(n => ({ ...n, time: n.time - first })) };
    const token = ++playToken;
    try {
        await audio.play(clip, playbackSpeed);
        if (token !== playToken)
            return;
        $('groupPlayBtn').textContent = '▶ Po luhet grupi';
        $('studioState').textContent = 'GRUPI';
        const loop = () => {
            if (token !== playToken)
                return;
            const ms = first + audio.elapsedMs * playbackSpeed;
            drawTab(song, ms);
            $('timeLabel').textContent = `${fmt(ms)} / ${fmt(range.end)}`;
            updatePlaybackNotes(song, ms);
            if (ms >= range.end || audio.done()) {
                completeGroupPlayback();
                return;
            }
            playFrame = requestAnimationFrame(loop);
        };
        loop();
    }
    catch (e) {
        stopPlayback();
        setStatus('Gabim gjatë luajtjes së grupit: ' + String(e));
    }
}
/** All tab controls share the exact original audio clock and position. */
function playbackPositionMs() {
    return usingOriginal(currentSong()) && Number.isFinite(originalPlayer.currentTime)
        ? originalPlayer.currentTime * 1000
        : audio.playing ? syntheticStartMs + audio.elapsedMs * playbackSpeed : tabCurrentMs;
}
function activeSeekEndMs() {
    const song = currentSong();
    if (usingOriginal(song) && Number.isFinite(originalPlayer.duration) && originalPlayer.duration > 0)
        return Math.round(originalPlayer.duration * 1000);
    return tabSongEnd(song);
}
function preciseTime(ms) {
    return (Math.max(0, ms) / 1000).toFixed(3);
}
function syncTabTransport() {
    const song = currentSong(), maxMs = activeSeekEndMs();
    const ms = Math.max(0, Math.min(tabCurrentMs, maxMs));
    const seconds = $('tabSeekSeconds');
    if (document.activeElement !== seconds)
        seconds.value = preciseTime(ms);
    seconds.max = preciseTime(maxMs);
    const slider = $('tabSeekSlider');
    slider.max = preciseTime(maxMs);
    if (document.activeElement !== slider)
        slider.value = preciseTime(ms);
    $('tabSeekReadout').textContent = `${fmt(ms)} · ${preciseTime(ms)} s`;
    const playing = usingOriginal(song) ? !originalPlayer.paused : audio.playing;
    $('playBtn').textContent = playing ? '⏸ Pauzë' : '▶ Luaj';
    $('practicePauseBtn').textContent = playing ? '⏸ Pauzë' : '▶ Vazhdo';
    $('practiceSpeedSelect').value = String(playbackSpeed);
}
/** Pause before seeking so the player cannot overwrite the clicked position. */
function seekToMs(target) {
    const song = currentSong();
    if (!song)
        return;
    const end = activeSeekEndMs();
    const ms = Math.max(0, Math.min(end, Number.isFinite(target) ? Math.round(target) : 0));
    if (usingOriginal(song)) {
        originalPlayer.pause();
        try {
            if (originalPlayer.readyState > 0) {
                originalPlayer.currentTime = ms / 1000;
                seekPendingUntilMetadata = null;
            }
            else
                seekPendingUntilMetadata = ms;
        }
        catch {
            seekPendingUntilMetadata = ms;
        }
    }
    else {
        playToken++;
        cancelAnimationFrame(playFrame);
        audio.stop();
    }
    activeGroupEndMs = null;
    currentPlayMode = 'all';
    clearPlayedNote();
    tabCurrentMs = ms;
    tabFollowPlayback = false;
    const geom = visibleTab(), x = timelineX(ms, tabViewStartMs, geom.left, geom.scale);
    if (x < geom.left || x > geom.width - geom.right) {
        tabViewStartMs = clampTimelineStart(ms - geom.visibleMs * .45, geom.visibleMs, tabSongEnd(song));
    }
    drawTab(song, ms);
    $('timeLabel').textContent = `${fmt(ms)} / ${fmt(activeSeekEndMs())}`;
    setStatus(`U ndal te ${preciseTime(ms)} s. Kliko telin në tablaturë për të vendosur notën.`);
}
/** For synthesized demos, play only notes after the chosen cursor. */
async function playSynthFromCursor() {
    const song = currentSong();
    if (!song || !song.notes.length)
        return;
    const first = Math.max(0, tabCurrentMs);
    const events = song.notes.filter(n => n.time >= first);
    if (!events.length) {
        seekToMs(0);
        return;
    }
    const clip = { ...song, notes: events.map(e => ({ ...e, time: e.time - first })) };
    playToken++;
    const token = playToken;
    syntheticStartMs = first;
    try {
        await audio.play(clip, playbackSpeed);
        if (token !== playToken)
            return;
        $('studioState').textContent = 'NOTAT';
        setStatus(audio.upperEnabled ? 'Po luhen notat me shoqërimin e zgjedhur.' : 'Po luhet vetëm teli poshtë, sipas notave.');
        const frame = () => {
            if (token !== playToken || !audio.playing)
                return;
            const ms = Math.min(activeSeekEndMs(), syntheticStartMs + audio.elapsedMs * playbackSpeed);
            drawTab(song, ms);
            $('timeLabel').textContent = `${fmt(ms)} / ${fmt(activeSeekEndMs())}`;
            updatePlaybackNotes(song, ms);
            if (audio.done()) {
                audio.stop();
                clearPlayedNote();
                syncTabTransport();
                return;
            }
            playFrame = requestAnimationFrame(frame);
        };
        frame();
    }
    catch (e) {
        setStatus(`Luajtja nuk nisi: ${String(e)}`);
        syncTabTransport();
    }
}
/** Same Play/Pause button resumes from the chosen second; never resets unexpectedly. */
async function toggleTabPlay() {
    if (micActive) {
        setStatus('Ndalo mikrofonin përpara luajtjes.');
        return;
    }
    if (manualPending) {
        setStatus('Vendos ose anulo notën e hapur para luajtjes.');
        return;
    }
    const song = currentSong();
    if (!song)
        return;
    if (usingOriginal(song)) {
        if (!originalPlayer.src) {
            setStatus('Audioja origjinale nuk është gati.');
            return;
        }
        if (!originalPlayer.paused) {
            originalPlayer.pause();
            clearPlayedNote();
            tabCurrentMs = originalPlayer.currentTime * 1000;
            redrawTab();
            return;
        }
        if (Number.isFinite(originalPlayer.duration) && originalPlayer.currentTime >= originalPlayer.duration - .02) {
            seekToMs(0);
        }
        configurePlaybackSpeed();
        try {
            await originalPlayer.play();
        }
        catch (e) {
            setStatus('Luajtja nuk nisi: ' + String(e));
        }
    }
    else {
        if (audio.playing) {
            const at = playbackPositionMs();
            playToken++;
            cancelAnimationFrame(playFrame);
            audio.stop();
            clearPlayedNote();
            tabCurrentMs = at;
            redrawTab();
            return;
        }
        await playSynthFromCursor();
    }
    syncTabTransport();
}
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
    syntheticStartMs = 0;
    currentPlayMode = 'all';
    configurePlaybackSpeed();
    tabCurrentMs = 0;
    tabViewStartMs = 0;
    tabFollowPlayback = true;
    if (usingOriginal(song)) {
        if (!originalPlayer.src) {
            setStatus('Mungon audioja origjinale në këtë pajisje. Zgjidh këngën sërish.');
            return;
        }
        try {
            originalPlayer.currentTime = 0;
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
        await audio.play(song, playbackSpeed);
        if (token !== playToken)
            return;
        $('playBtn').textContent = '▶ Po luhet';
        $('studioState').textContent = 'DUKE LUAJTUR';
        setStatus(`Po luhet ${song.name} · ${song.notes.length} nota`);
        const loop = () => {
            if (token !== playToken)
                return;
            const ms = audio.elapsedMs * playbackSpeed;
            updatePlaybackNotes(song, ms);
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
    if (manualPending) {
        setStatus('Vendos ose anulo notën e hapur para ruajtjes.');
        return;
    }
    if (!draft) {
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
    const saved = { ...draft, id: editingSongId || newSong(title, []).id, name: title.trim(), stanzas: sanitizeStanzas(stanzas) };
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
    const next = upsertSong(savedSongs, saved);
    if (!saveSongs(next)) {
        if (draft.originalAudioId === '__draft' && importFile)
            void deleteOriginal(saved.id).catch(() => { });
        setStatus('Ruajtja dështoi: hapësira e shfletuesit është plot. Eksporto JSON.');
        return;
    }
    stopPlayback();
    savedSongs = next;
    draft = null;
    editingSongId = null;
    groupUndo = null;
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
            editingSongId = null;
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
    if (!song || !savedSongs.some(s => s.id === song.id))
        return;
    const isOverride = DEMO.some(s => s.id === song.id) || catalogSongs.some(s => s.id === song.id);
    if (!confirm(isOverride ? 'Të hiqen ndryshimet lokale dhe të rikthehet kënga origjinale?' : `Ta fshijmë këngën “${song.name}”?`))
        return;
    const next = savedSongs.filter(s => s.id !== song.id);
    if (!saveSongs(next)) {
        setStatus('Fshirja nuk u ruajt.');
        return;
    }
    savedSongs = next;
    if (song.originalAudioId === song.id)
        try {
            await deleteOriginal(song.originalAudioId);
        }
        catch { }
    selectedId = isOverride ? song.id : DEMO[0].id;
    renderSongs();
    void prepareOriginalForSelection();
    setStatus(isOverride ? 'U rikthye kënga origjinale.' : 'Kënga u fshi nga ky shfletues.');
}
const canvas = $('tabCanvas');
function tabSongEnd(song) {
    const maxNote = Math.max(0, ...(song?.notes ?? []).map(n => n.time));
    const maxGroup = Math.max(0, ...(song?.stanzas ?? []).map(g => g.start));
    const audioEnd = importedSong(song) && Number.isFinite(originalPlayer.duration) ? originalPlayer.duration * 1000 : 0;
    return Math.max(1600, maxNote + 950, maxGroup + 850, audioEnd);
}
function visibleTab() {
    return timelineGeometry(canvas.getBoundingClientRect().width || 360);
}
function tabCurrentGroups(song) {
    return activeSongGroups(song);
}
function editableTab() { return selectedId === '__draft' && !!draft; }
function redrawTab() { drawTab(songForDisplay(), tabCurrentMs); }
function focusTimelineAt(time) {
    const geom = visibleTab();
    tabViewStartMs = clampTimelineStart(time - geom.visibleMs * .25, geom.visibleMs, tabSongEnd(songForDisplay()));
    tabFollowPlayback = false;
    redrawTab();
}
function moveTimeline(direction) {
    const song = songForDisplay();
    if (!song)
        return;
    const geom = visibleTab();
    tabViewStartMs = clampTimelineStart(tabViewStartMs + direction * geom.visibleMs * .66, geom.visibleMs, tabSongEnd(song));
    tabFollowPlayback = false;
    redrawTab();
}
function applyGroupMarkerPosition(index, proposed) {
    if (!editableTab()) {
        setStatus('Për të lëvizur grupet, hap Redakto këngën.');
        return;
    }
    const marker = stanzas[index];
    if (!marker || index === 0)
        return;
    const old = marker.start;
    const next = clampGroupBoundary(stanzas, index, proposed, tabSongEnd(draft));
    if (next === null) {
        setStatus('Grupet janë shumë afër për ta lëvizur këtë vijë.');
        return;
    }
    if (next === old) {
        redrawTab();
        return;
    }
    marker.start = next;
    for (const hit of importedHits)
        if (hit.groupStart === old)
            hit.groupStart = next;
    if (selectedGroupStart === old)
        selectedGroupStart = next;
    stanzas = sanitizeStanzas(stanzas);
    updateImportDraft();
    renderImportedHits();
    tabFollowPlayback = false;
    redrawTab();
    setStatus(`Vija e ${marker.label} u zhvendos nga ${fmt(old)} në ${fmt(next)}. Shtyp Ruaj për ta ruajtur.`);
}
function moveSelectedMarker(delta) {
    const index = stanzas.findIndex(g => g.start === selectedGroupStart);
    if (index <= 0) {
        setStatus('Zgjidh grupin 2 ose një grup pas tij. Grupi i parë fillon në 0.');
        return;
    }
    applyGroupMarkerPosition(index, stanzas[index].start + delta);
}
function setTabControls(song, geom) {
    const groups = tabCurrentGroups(song);
    const canMove = editableTab() && groups.findIndex(g => g.start === selectedGroupStart) > 0;
    $('tabLeftBtn').toggleAttribute('disabled', !song || tabViewStartMs <= 0);
    $('tabRightBtn').toggleAttribute('disabled', !song || tabViewStartMs >= clampTimelineStart(tabSongEnd(song), geom.visibleMs, tabSongEnd(song)));
    $('tabMarkLeftBtn').toggleAttribute('disabled', !canMove);
    $('tabMarkRightBtn').toggleAttribute('disabled', !canMove);
    $('tabFollowBtn').classList.toggle('is-on', tabFollowPlayback);
    $('tabFollowBtn').setAttribute('aria-pressed', String(tabFollowPlayback));
    $('tabViewRange').textContent = `${fmt(tabViewStartMs)} – ${fmt(tabViewStartMs + geom.visibleMs)}`;
}
function drawTab(song, elapsed = tabCurrentMs) {
    tabCurrentMs = Math.max(0, elapsed);
    const rect = canvas.getBoundingClientRect();
    const geom = timelineGeometry(rect.width);
    const { width: w, left, right, scale, visibleMs } = geom;
    const h = 175, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }
    const c = canvas.getContext('2d');
    if (!c)
        return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (song && tabFollowPlayback && (audio.playing || (!originalPlayer.paused && usingOriginal(song)))) {
        const x = timelineX(tabCurrentMs, tabViewStartMs, left, scale);
        if (x > left + (w - left - right) * .79 || x < left + 8)
            tabViewStartMs = clampTimelineStart(tabCurrentMs - visibleMs * .24, visibleMs, tabSongEnd(song));
    }
    tabViewStartMs = clampTimelineStart(tabViewStartMs, visibleMs, tabSongEnd(song));
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#101c2c';
    c.fillRect(0, 0, w, h);
    const groups = tabCurrentGroups(song);
    const visualGroups = groups.map((g, i) => tabDrag?.index === i ? { ...g, start: tabDrag.previewMs } : g);
    // Each group has a continuous colored region, so manually corrected starts are visible.
    for (let i = 0; i < visualGroups.length; i++) {
        const g = visualGroups[i], start = g.start, end = visualGroups[i + 1]?.start ?? tabSongEnd(song);
        const x1 = Math.max(left, timelineX(start, tabViewStartMs, left, scale));
        const x2 = Math.min(w - right, timelineX(end, tabViewStartMs, left, scale));
        if (x2 <= x1)
            continue;
        const color = g.color || STANZA_COLORS[i % STANZA_COLORS.length];
        c.fillStyle = color;
        c.globalAlpha = g.start === selectedGroupStart ? .21 : .11;
        c.fillRect(x1, 27, x2 - x1, 131);
        c.globalAlpha = 1;
        c.fillStyle = color;
        c.globalAlpha = .65;
        c.fillRect(x1, 3, x2 - x1, 22);
        c.globalAlpha = 1;
        if (x2 - x1 > 28) {
            c.fillStyle = '#101c2c';
            c.font = 'bold 10px system-ui';
            c.fillText(g.label.slice(0, Math.max(3, Math.floor((x2 - x1) / 8))), x1 + 5, 17);
        }
    }
    c.strokeStyle = '#33465b';
    c.lineWidth = 1;
    for (const y of [60, 120]) {
        c.beginPath();
        c.moveTo(left, y);
        c.lineTo(w - right, y);
        c.stroke();
    }
    c.fillStyle = '#9baebc';
    c.font = w < 430 ? '10px system-ui' : '12px system-ui';
    c.fillText('LART', 12, 62);
    c.fillText('POSHTË', 12, 122);
    // Accurate 0.5 s grid, 0.1 s subdivisions; labels show decimal seconds.
    c.font = '10px system-ui';
    c.fillStyle = '#9bb4c6';
    for (let tick = Math.ceil(tabViewStartMs / 100); tick * 100 <= tabViewStartMs + visibleMs; tick++) {
        const at = tick * 100, sx = timelineX(at, tabViewStartMs, left, scale);
        if (sx < left || sx > w - right)
            continue;
        const major = tick % 5 === 0, whole = tick % 10 === 0;
        c.strokeStyle = major ? '#50677f' : '#304154';
        c.lineWidth = major ? 1 : .6;
        c.globalAlpha = major ? .65 : .28;
        c.beginPath();
        c.moveTo(sx, major ? 26 : 146);
        c.lineTo(sx, 155);
        c.stroke();
        c.globalAlpha = 1;
        if (major && sx < w - right - 32)
            c.fillText(`${(at / 1000).toFixed(whole ? 0 : 1)} s`, sx + 3, 170);
    }
    // Colored boundary lines and draggable handles. The first group starts at zero (fixed).
    for (let i = 1; i < visualGroups.length; i++) {
        const group = visualGroups[i], sx = timelineX(group.start, tabViewStartMs, left, scale);
        if (sx < left - 8 || sx > w - right + 8)
            continue;
        const color = group.color || STANZA_COLORS[i % STANZA_COLORS.length];
        c.strokeStyle = color;
        c.lineWidth = group.start === selectedGroupStart ? 4.5 : 3;
        c.beginPath();
        c.moveTo(sx, 23);
        c.lineTo(sx, 157);
        c.stroke();
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(sx - 9, 24);
        c.lineTo(sx + 9, 24);
        c.lineTo(sx, 37);
        c.closePath();
        c.fill();
        if (tabDrag?.index === i) {
            c.fillStyle = '#f8f4ed';
            c.font = 'bold 11px system-ui';
            const text = fmt(group.start);
            c.fillText(text, Math.min(w - 65, Math.max(left + 4, sx + 12)), 48);
        }
    }
    const playerX = timelineX(tabCurrentMs, tabViewStartMs, left, scale);
    if (playerX >= left && playerX <= w - right) {
        c.strokeStyle = '#f8cc76';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(playerX, 26);
        c.lineTo(playerX, 159);
        c.stroke();
    }
    if (song) {
        const events = withOpenF(song.notes, audio.upperEnabled);
        for (const e of events) {
            const drawTime = tabNoteDrag && selectedImportedHit && e.time === tabNoteDrag.startTime && e.noteNumber === tabNoteDrag.hit.noteNumber && e.string === tabNoteDrag.hit.string ? tabNoteDrag.previewMs : e.time;
            const x = timelineX(drawTime, tabViewStartMs, left, scale);
            if (x < left - 11 || x > w - right + 11)
                continue;
            const y = e.string === 1 ? 120 : 60;
            const gi = groupForNote(groups, e);
            const groupColor = noteAttackColor(events, e, groups[gi]?.color || STANZA_COLORS[gi % STANZA_COLORS.length]);
            c.beginPath();
            c.arc(x, y, 11, 0, Math.PI * 2);
            c.fillStyle = Math.abs(e.time - tabCurrentMs) < 60 ? groupColor : '#203f4f';
            c.fill();
            c.strokeStyle = groupColor;
            c.lineWidth = 2;
            c.stroke();
            if (selectedImportedHit && e.time === selectedImportedHit.time && e.noteNumber === selectedImportedHit.noteNumber && e.string === selectedImportedHit.string) {
                c.beginPath();
                c.arc(x, y, 15, 0, Math.PI * 2);
                c.strokeStyle = '#f8f9fa';
                c.lineWidth = 2;
                c.stroke();
            }
            c.fillStyle = Math.abs(e.time - tabCurrentMs) < 60 ? '#141e2b' : '#f6e6ca';
            c.font = 'bold 12px system-ui';
            c.textAlign = 'center';
            c.fillText(e.noteNumber <= 13 ? String(e.noteNumber) : labelFor(e.noteNumber), x, y + 4);
            c.textAlign = 'start';
            // Notes manually moved between groups keep their original time but take their target group's color.
            if (Number.isFinite(e.groupStart) && gi !== groupAtTime(groups, e.time)) {
                c.fillStyle = groupColor;
                c.fillRect(x + 6, y - 15, 5, 5);
            }
        }
    }
    else {
        c.font = '13px system-ui';
        c.fillStyle = '#8d9bac';
        c.fillText('Zgjidh këngën.', left + 20, 92);
    }
    if (manualPending && editableTab()) {
        const px = timelineX(manualPending.time, tabViewStartMs, left, scale);
        if (px >= left && px <= w - right) {
            const py = manualPending.string === 2 ? 60 : 120;
            c.beginPath();
            c.arc(px, py, 14, 0, Math.PI * 2);
            c.fillStyle = '#f0b75b';
            c.fill();
            c.strokeStyle = '#fff4db';
            c.lineWidth = 2;
            c.stroke();
            c.fillStyle = '#1b2532';
            c.textAlign = 'center';
            c.font = 'bold 14px system-ui';
            c.fillText('?', px, py + 5);
            c.textAlign = 'start';
        }
    }
    c.fillStyle = '#132437';
    c.fillRect(0, 0, left - 1, h);
    c.fillStyle = '#a7bccc';
    c.font = 'bold 11px system-ui';
    c.fillText('TELI LART', 7, 47);
    c.fillText('TELI POSHTË', 7, 106);
    setTabControls(song, geom);
    syncTabTransport();
}
/** Editing a note on the canvas never moves its neighbors. */
function editSelectedTabNote(delta) {
    const hit = selectedImportedHit;
    if (!editableTab() || !hit || !importedHits.includes(hit))
        return;
    hit.time = Math.max(0, Math.min(activeSeekEndMs(), Math.round(hit.time + delta)));
    hit.detail = 'Koha u korrigjua në tablaturë';
    updateImportDraft();
    renderImportedHits();
    redrawTab();
    setStatus(`Nota ${hit.noteNumber ?? '?'} u vendos te ${preciseTime(hit.time)} s. Shtyp Ruaj.`);
}
function deleteSelectedTabNote() {
    const hit = selectedImportedHit;
    if (!editableTab() || !hit || !importedHits.includes(hit))
        return;
    importedHits = importedHits.filter(n => n !== hit);
    selectedImportedHit = null;
    updateImportDraft();
    renderImportedHits();
    redrawTab();
    setStatus('Nota e zgjedhur u fshi. Shtyp Ruaj që ndryshimi të mbetet.');
}
function refreshTabNoteEditor() {
    const hit = selectedImportedHit;
    const canEdit = editableTab() && !!hit && importedHits.includes(hit);
    $('tabNoteEditBar').hidden = !canEdit;
    const upper = $('tabUpperNote');
    upper.disabled = !canEdit || hit?.string === 2;
    upper.value = hit?.withF === false ? 'off' : String(upperFret(hit?.upperNoteNumber));
    if (canEdit)
        $('tabNoteSelected').textContent = `Perdja ${hit.noteNumber ?? '?'} · ${preciseTime(hit.time)} s`;
}
function findExistingCanvasHit(x, y, geom) {
    if (!editableTab() || x < geom.left || x > geom.width - geom.right)
        return null;
    const line = y >= 38 && y < 89 ? 2 : y >= 92 && y <= 146 ? 1 : 0;
    if (!line)
        return null;
    let nearest = null, distance = 17;
    for (const hit of importedHits) {
        if (hit.noteNumber === null)
            continue;
        const shownOnLine = hit.string === line || (line === 2 && hit.string === 1 && hit.withF !== false && hit.noteNumber !== 14);
        if (!shownOnLine)
            continue;
        const px = timelineX(hit.time, tabViewStartMs, geom.left, geom.scale);
        const d = Math.abs(px - x);
        if (d < distance) {
            nearest = hit;
            distance = d;
        }
    }
    return nearest;
}
function renderTimeline() {
    drawTab(songForDisplay(), tabCurrentMs);
    const song = songForDisplay();
    $('timeLabel').textContent = `${fmt(tabCurrentMs)} / ${fmt(tabSongEnd(song))}`;
}
/** A click must use its own position, even if music was playing elsewhere. */
function captureManualTime(x, geom) {
    return manualAnywhereTime(x, tabViewStartMs, geom.left, geom.scale, geom.width, geom.right, activeSeekEndMs());
}
function renderManualMode() {
    const btn = $('manualModeBtn');
    btn.classList.toggle('is-on', manualMode);
    btn.setAttribute('aria-pressed', String(manualMode));
    btn.textContent = manualMode ? '✍ Shënim manual: AKTIV' : '✍ Shëno manualisht';
    const quickBtn = $('instantTabNoteBtn');
    quickBtn.classList.toggle('is-on', instantTabNoteMode);
    quickBtn.setAttribute('aria-pressed', String(instantTabNoteMode));
    quickBtn.textContent = instantTabNoteMode ? '📍 Kliko kudo: AKTIV' : '📍 Kliko kudo → Notë';
    document.querySelector('.tab-canvas-wrap')?.classList.toggle('instant-note-active', instantTabNoteMode);
    $('manualEntryPanel').hidden = !manualPending;
    $('manualClearBtn').toggleAttribute('disabled', !editableTab() || !importedHits.length);
    $('tabHelp').textContent = instantTabNoteMode ? 'Kliko kudo mbi tablaturë — edhe te numrat e sekondave ose hapësira bosh. Muzika ndalet në atë sekondë dhe shfaqet ?. Për ta tërhequr vijën e grupit, përdor trekëndëshin e saj.' : manualMode
        ? 'Kliko te sekonda ku dëshiron notën: kënga ndalet në atë pozicion. Zgjidh perden dhe përdor Vendos & Vazhdo. Koha mund të rregullohet në 0.001 sekonda.'
        : 'Tërhiq vijën e grupit për të korrigjuar kufirin. Përdor ✍ Shëno manualisht për të vendosur notat ndërsa dëgjon muzikën.';
}
function cancelManualNote() {
    manualPending = null;
    renderManualMode();
    redrawTab();
}
function beginManualNote(x, y, geom) {
    if (!editableTab()) {
        setStatus('Për shënim manual, importo një audio ose hap Redakto këngën.');
        return;
    }
    if (manualPending) {
        setStatus('Përfundo ose anulo notën e mëparshme.');
        return;
    }
    const time = captureManualTime(x, geom);
    const string = 1;
    seekToMs(time);
    manualPending = { time, string };
    const select = $('manualFretSelect');
    select.value = '';
    $('manualUpperNote').value = '14';
    $('manualUpperNote').disabled = false;
    $('manualTimeLabel').textContent = `${preciseTime(time)} s`;
    $('manualTimeSeconds').value = preciseTime(time);
    renderManualMode();
    tabFollowPlayback = false;
    // Preserve the exact horizontal point that was tapped: do not auto-pan.
    redrawTab();
    setStatus(`Shënim në ${fmt(time)}. Zgjidh perden dhe shtyp Vendos ose Vendos & Vazhdo.`);
    $('manualEntryPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    select.focus({ preventScroll: true });
}
function commitManualNote(resume) {
    if (!manualPending || !editableTab())
        return;
    const noteNumber = Number($('manualFretSelect').value);
    if (!Number.isInteger(noteNumber) || !(noteNumber >= 1 && noteNumber <= 13 || noteNumber === 15)) {
        setStatus('Zgjidh perden poshtë 1–13 ose G hapur.');
        return;
    }
    const entered = Number($('manualTimeSeconds').value);
    if (!Number.isFinite(entered) || entered < 0 || entered * 1000 > activeSeekEndMs()) {
        setStatus('Shkruaj sekonda të vlefshme për notën.');
        return;
    }
    const time = Math.round(entered * 1000);
    // The saved note follows the precise user-selected second, not the old playback clock.
    seekToMs(time);
    const groupStart = stanzas[groupAtTime(stanzas, time)]?.start ?? 0;
    const h = manualEntryNote(noteNumber, time, $('manualUpperNote').value, groupStart);
    importedHits.push(h);
    selectedImportedHit = h;
    const count = stanzas.flatMap((_, i) => importedHits.filter(v => groupForNote(stanzas, v) === i)).indexOf(h);
    analysisRowsVisible = Math.max(analysisRowsVisible, count + 1);
    manualPending = null;
    updateImportDraft();
    renderImportedHits();
    renderManualMode();
    selectImportedHit(h);
    redrawTab();
    if (h.withF === false || (h.upperNoteNumber !== undefined && h.upperNoteNumber !== 14))
        useNotePlayback();
    setStatus(`Nota ${noteNumber === 15 ? 'G' : noteNumber} u vendos te ${fmt(time)}. ${resume ? 'Vazhdo dëgjimin.' : 'Mund të korrigjosh kohën në listë.'}`);
    if (resume) {
        if (importedSong(currentSong()) && originalPlayer.src) {
            stopPlayback();
            playbackSource = 'original';
            seekToMs(time);
        }
        configurePlaybackSpeed();
        void toggleTabPlay();
    }
}
function setManualMode(on) {
    if (!on) {
        cancelManualNote();
        instantTabNoteMode = false;
    }
    manualMode = on;
    renderManualMode();
    setStatus(on ? 'Shënim manual aktiv. Shtyp Luaj; prek tablaturën në goditjen që dëgjon.' : 'Shënimi manual u çaktivizua.');
}
function installTabInteraction() {
    $('tabLeftBtn').addEventListener('click', () => moveTimeline(-1));
    $('tabRightBtn').addEventListener('click', () => moveTimeline(1));
    $('tabFollowBtn').addEventListener('click', () => {
        tabFollowPlayback = true;
        tabViewStartMs = clampTimelineStart(tabCurrentMs - visibleTab().visibleMs * .25, visibleTab().visibleMs, tabSongEnd(songForDisplay()));
        redrawTab();
    });
    $('tabMarkLeftBtn').addEventListener('click', () => moveSelectedMarker(-50));
    $('tabMarkRightBtn').addEventListener('click', () => moveSelectedMarker(50));
    $('tabBackBtn').addEventListener('click', () => seekToMs(playbackPositionMs() - 1000));
    $('tabNextBtn').addEventListener('click', () => seekToMs(playbackPositionMs() + 1000));
    $('tabFineBackBtn').addEventListener('click', () => seekToMs(playbackPositionMs() - 100));
    $('tabFineNextBtn').addEventListener('click', () => seekToMs(playbackPositionMs() + 100));
    const seekSeconds = $('tabSeekSeconds');
    const submitSeek = () => {
        if (!seekSeconds.value.trim() || !Number.isFinite(Number(seekSeconds.value)))
            return;
        seekToMs(Number(seekSeconds.value) * 1000);
    };
    $('tabSeekGoBtn').addEventListener('click', submitSeek);
    seekSeconds.addEventListener('keydown', e => { if (e.key === 'Enter') {
        e.preventDefault();
        submitSeek();
        seekSeconds.blur();
    } });
    seekSeconds.addEventListener('change', submitSeek);
    const seekSlider = $('tabSeekSlider');
    seekSlider.addEventListener('input', () => seekToMs(Number(seekSlider.value) * 1000));
    seekSlider.addEventListener('change', () => { seekSlider.blur(); syncTabTransport(); });
    canvas.addEventListener('pointerdown', (event) => {
        const song = songForDisplay();
        if (!song)
            return;
        const rect = canvas.getBoundingClientRect(), geom = visibleTab();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        // Tap an existing marker to select it. Drag horizontally or use the precise buttons.
        if (!manualPending) {
            const note = findExistingCanvasHit(x, y, geom);
            if (note) {
                seekToMs(note.time);
                selectImportedHit(note);
                tabNoteDrag = { pointerId: event.pointerId, hit: note, startX: x, startTime: note.time, previewMs: note.time, moved: false };
                canvas.setPointerCapture(event.pointerId);
                event.preventDefault();
                return;
            }
        }
        // Alternative direct mode: any visible pixel, including rulers, empty bands
        // and the left labels, selects the exact horizontal second. Marker triangles
        // remain reserved for intentionally dragging group boundaries.
        if (instantTabNoteMode) {
            if (!editableTab()) {
                setStatus('Importo një audio ose hap Redakto këngën për të shtuar notë.');
                return;
            }
            const safeX = Math.max(geom.left, Math.min(geom.width - geom.right, x));
            const boundary = y >= 16 && y < 38 ? findGroupBoundary(tabCurrentGroups(song), safeX, tabViewStartMs, geom.left, geom.scale, 13) : -1;
            if (boundary < 1) {
                const chosenY = y < 37 ? 119 : y; // ruler means the melodic (lower) string
                beginManualNote(safeX, chosenY, geom);
                event.preventDefault();
                return;
            }
        }
        if (y < 16 || y > 162 || x < geom.left || x > geom.width - geom.right)
            return;
        // In the string area, a tap ALWAYS selects the tapped second, not a nearby group marker.
        if (y >= 37) {
            if (manualMode && editableTab())
                beginManualNote(x, y, geom);
            else
                seekToMs(timelineTime(x, tabViewStartMs, geom.left, geom.scale));
            event.preventDefault();
            return;
        }
        // Group boundaries can only be dragged by their top triangles.
        const groups = tabCurrentGroups(song);
        const index = findGroupBoundary(groups, x, tabViewStartMs, geom.left, geom.scale, 13);
        if (index < 1) {
            seekToMs(timelineTime(x, tabViewStartMs, geom.left, geom.scale));
            event.preventDefault();
            return;
        }
        if (!editableTab()) {
            selectedGroupStart = groups[index].start;
            refreshGroupPicker(song);
            redrawTab();
            setStatus('Për të tërhequr këtë vijë, shtyp Redakto këngën.');
            return;
        }
        selectedGroupStart = groups[index].start;
        tabFollowPlayback = false;
        tabDrag = { pointerId: event.pointerId, index, oldStart: groups[index].start, previewMs: groups[index].start };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'ew-resize';
        event.preventDefault();
        redrawTab();
    });
    canvas.addEventListener('pointermove', (event) => {
        if (tabNoteDrag && event.pointerId === tabNoteDrag.pointerId) {
            const geom = visibleTab(), rect = canvas.getBoundingClientRect();
            const dx = event.clientX - rect.left - tabNoteDrag.startX;
            if (Math.abs(dx) > 5)
                tabNoteDrag.moved = true;
            if (tabNoteDrag.moved) {
                tabNoteDrag.previewMs = Math.max(0, Math.min(activeSeekEndMs(), Math.round(tabNoteDrag.startTime + dx / geom.scale)));
                redrawTab();
            }
            event.preventDefault();
            return;
        }
        if (!tabDrag || event.pointerId !== tabDrag.pointerId)
            return;
        const geom = visibleTab(), rect = canvas.getBoundingClientRect();
        const proposed = timelineTime(event.clientX - rect.left, tabViewStartMs, geom.left, geom.scale);
        const value = clampGroupBoundary(stanzas, tabDrag.index, proposed, tabSongEnd(draft));
        if (value !== null)
            tabDrag.previewMs = value;
        redrawTab();
        event.preventDefault();
    });
    canvas.addEventListener('pointerup', (event) => {
        if (tabNoteDrag && event.pointerId === tabNoteDrag.pointerId) {
            const drag = tabNoteDrag;
            tabNoteDrag = null;
            if (canvas.hasPointerCapture(event.pointerId))
                canvas.releasePointerCapture(event.pointerId);
            if (drag.moved) {
                drag.hit.time = drag.previewMs;
                updateImportDraft();
                renderImportedHits();
            }
            else
                refreshTabNoteEditor();
            redrawTab();
            event.preventDefault();
            return;
        }
        if (!tabDrag || event.pointerId !== tabDrag.pointerId)
            return;
        const drag = tabDrag;
        tabDrag = null;
        if (canvas.hasPointerCapture(event.pointerId))
            canvas.releasePointerCapture(event.pointerId);
        canvas.style.cursor = 'crosshair';
        applyGroupMarkerPosition(drag.index, drag.previewMs);
        event.preventDefault();
    });
    canvas.addEventListener('pointercancel', () => { tabDrag = null; tabNoteDrag = null; canvas.style.cursor = 'crosshair'; redrawTab(); });
    canvas.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            if (event.altKey && selectedImportedHit)
                editSelectedTabNote(event.key === 'ArrowLeft' ? -50 : 50);
            else if (event.shiftKey)
                moveSelectedMarker(event.key === 'ArrowLeft' ? -50 : 50);
            else
                moveTimeline(event.key === 'ArrowLeft' ? -1 : 1);
        }
    });
    window.addEventListener('resize', redrawTab);
}
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
            return { string: n.string, noteNumber: n.noteNumber, time: n.time, withF: n.withF !== false, upperNoteNumber: upperFret(n.upperNoteNumber),
                ...(Number.isInteger(n.groupStart) && n.groupStart >= 0 ? { groupStart: n.groupStart } : {}) };
        });
        const name = typeof obj.name === 'string' ? obj.name : 'Këngë e importuar';
        stopPlayback();
        createDraftFromNotes(notes, name);
        const markers = data.stanzas;
        stanzas = sanitizeStanzas(Array.isArray(markers) ? markers : undefined);
        if (draft)
            draft.stanzas = stanzas;
        renderSongs();
        renderImportedHits();
        setStatus('Kënga u importua si PROVË. Shtyp Luaj dhe pastaj Ruaj nëse dëshiron.');
    }
    catch (e) {
        setStatus(`Importimi dështoi: ${e instanceof Error ? e.message : String(e)}`);
    }
}
/** Edit a saved transcription in a draft; the original stored recording remains untouched. */
async function editSavedAudio() {
    const song = currentSong();
    if (!song || selectedId === '__draft')
        return;
    stopPlayback();
    editingSongId = song.id;
    groupUndo = null;
    importFile = null;
    selectedImportedHit = null;
    $('analyzeBtn').setAttribute('disabled', '');
    draft = { ...song, notes: song.notes.map(n => ({ ...n })) };
    stanzas = sanitizeStanzas(song.stanzas);
    importedHits = song.notes.map(n => ({ ...n, string: n.noteNumber === 14 ? 2 : n.string, confidence: n.confidence ?? 1, withF: n.withF !== false, upperNoteNumber: upperFret(n.upperNoteNumber), detail: 'Ruajtur' }));
    analysisRowsVisible = 60;
    selectedId = '__draft';
    manualPending = null;
    manualMode = true;
    instantTabNoteMode = false;
    renderSongs();
    renderImportedHits();
    renderManualMode();
    await prepareOriginalForSelection();
    setStatus('Po redakton këngën e ruajtur. Ndryshimet ruhen vetëm kur shtyp Ruaj.');
}
function sanitizeStanzas(value) {
    const valid = (value ?? []).filter(s => Number.isFinite(s.start) && s.start >= 0 && typeof s.label === 'string' && s.label.trim())
        .map(s => ({ start: Math.round(s.start), label: s.label.slice(0, 65), color: /^#[0-9a-f]{6}$/i.test(s.color ?? '') ? s.color : undefined }))
        .sort((a, b) => a.start - b.start);
    const unique = valid.filter((s, i, a) => i === 0 || s.start !== a[i - 1].start);
    return [{ start: 0, label: unique.find(s => s.start === 0)?.label || 'Grupi 1', color: unique.find(s => s.start === 0)?.color || GROUP_COLORS[0] },
        ...unique.filter(s => s.start > 0).map((s, i) => ({ ...s, color: s.color || GROUP_COLORS[(i + 1) % GROUP_COLORS.length] }))].slice(0, 90);
}
function autoStanzas(hits) {
    const sensitivity = $('groupSensitivity').value;
    return detectNoteGroups(hits, 3, sensitivity);
}
function groupColorAt(time) {
    const i = groupAtTime(stanzas, time);
    return stanzas[i]?.color || STANZA_COLORS[i % STANZA_COLORS.length];
}
function colorForHit(hit) {
    const i = groupForNote(stanzas, hit);
    return noteAttackColor(importedHits.filter(h => h.noteNumber !== null), hit, stanzas[i]?.color || STANZA_COLORS[i % STANZA_COLORS.length]);
}
function moveHitGroup(hit, direction) {
    const index = groupForNote(stanzas, hit);
    const destination = stanzas[index + direction];
    if (!destination) {
        setStatus(direction < 0 ? 'Kjo notë është në grupin e parë.' : 'Kjo notë është në grupin e fundit.');
        return;
    }
    hit.groupStart = destination.start;
    selectedImportedHit = hit;
    selectedGroupStart = destination.start;
    const groupOrder = stanzas.flatMap((_, i) => importedHits.filter(h => groupForNote(stanzas, h) === i).sort((a, b) => a.time - b.time));
    analysisRowsVisible = Math.max(analysisRowsVisible, groupOrder.indexOf(hit) + 1);
    updateImportDraft();
    renderImportedHits();
    document.querySelector('.analysis-note-row.is-selected')?.scrollIntoView({ block: 'nearest' });
    setStatus(`Nota u zhvendos te ${destination.label} dhe mori ngjyrën e tij. Koha mbeti ${fmt(hit.time)}.`);
}
function createGroupAtHit(hit) {
    const start = Math.round(hit.time);
    if (!draft || !importedHits.includes(hit))
        return;
    if (start <= 0) {
        setStatus('Grupi i parë fillon në 0 ms. Zgjidh një notë tjetër.');
        return;
    }
    if (stanzas.length >= 90) {
        setStatus('U arrit numri maksimal i grupeve.');
        return;
    }
    const existing = stanzas.find(s => s.start === start);
    if (existing) {
        hit.groupStart = existing.start;
        selectedGroupStart = existing.start;
        setStatus('Grupi ekziston tashmë. U zgjodh ai grup.');
    }
    else {
        const index = stanzas.findIndex(s => s.start > start);
        const position = index < 0 ? stanzas.length : index;
        stanzas.push({ start, label: `Grupi ${stanzas.length + 1}`, color: GROUP_COLORS[position % GROUP_COLORS.length] });
        stanzas = sanitizeStanzas(stanzas);
        hit.groupStart = start;
        selectedGroupStart = start;
        focusTimelineAt(start);
        setStatus(`U krijua grupi i ri në ${fmt(start)}. Kufiri i tij shihet tani te Tablatura.`);
    }
    selectedImportedHit = hit;
    const groupOrder = stanzas.flatMap((_, i) => importedHits.filter(h => groupForNote(stanzas, h) === i).sort((a, b) => a.time - b.time));
    analysisRowsVisible = Math.max(analysisRowsVisible, groupOrder.indexOf(hit) + 1);
    updateImportDraft();
    renderImportedHits();
}
function renderStanzas() {
    const target = $('stanzaList');
    target.replaceChildren();
    stanzas = sanitizeStanzas(stanzas);
    if (!stanzas.some(g => g.start === selectedGroupStart))
        selectedGroupStart = stanzas[0].start;
    for (let i = 0; i < stanzas.length; i++) {
        const s = stanzas[i];
        const row = document.createElement('div');
        row.className = 'stanza-entry';
        row.style.setProperty('--stanza-color', s.color || STANZA_COLORS[i % STANZA_COLORS.length]);
        row.dataset.groupStart = String(s.start);
        row.classList.toggle('group-active', s.start === selectedGroupStart);
        const label = document.createElement('input');
        label.type = 'text';
        label.maxLength = 65;
        label.value = s.label;
        label.setAttribute('aria-label', `Emri i grupit ${i + 1}`);
        label.addEventListener('change', () => { s.label = label.value.trim() || `Grupi ${i + 1}`; updateImportDraft(); renderImportedHits(); });
        const time = document.createElement('input');
        time.type = 'number';
        time.min = '0';
        time.step = '1';
        time.value = String(s.start);
        time.disabled = i === 0;
        time.setAttribute('aria-label', `Fillimi i grupit ${i + 1} në milisekonda`);
        time.addEventListener('change', () => {
            const index = stanzas.findIndex(g => g.start === s.start);
            applyGroupMarkerPosition(index, Number(time.value));
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-minimal';
        remove.textContent = '×';
        remove.disabled = i === 0;
        remove.setAttribute('aria-label', `Fshi ndarjen e grupit ${i + 1}`);
        remove.addEventListener('click', () => {
            // Grupet e fshira nuk duhet të lënë referenca të vdekura në notat e ruajtura.
            for (const hit of importedHits)
                if (hit.groupStart === s.start)
                    delete hit.groupStart;
            stanzas = stanzas.filter(x => x !== s);
            updateImportDraft();
            renderImportedHits();
        });
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'btn btn-minimal group-choose';
        choose.textContent = s.start === selectedGroupStart ? '✓ Zgjedhur' : 'Zgjidh';
        choose.setAttribute('aria-label', `Zgjidh ${s.label}`);
        choose.addEventListener('click', () => { selectGroup(s.start); renderStanzas(); });
        const color = document.createElement('input');
        color.type = 'color';
        color.className = 'group-color-picker';
        color.value = s.color || GROUP_COLORS[i % GROUP_COLORS.length];
        color.setAttribute('aria-label', `Ngjyra e grupit ${i + 1}`);
        color.addEventListener('change', () => { s.color = color.value; updateImportDraft(); renderImportedHits(); });
        row.append(label, time, color, choose, remove);
        target.append(row);
    }
}
/** Importimi ruan skedarin e plotë, ndërsa notat e zbuluara mbeten propozime të korrigjueshme. */
function updateImportDraft() {
    if (!draft)
        return;
    groupUndo = null;
    draft.notes = importedHits.filter(h => h.noteNumber !== null).map(h => ({
        time: Math.round(h.time), noteNumber: h.noteNumber, string: (h.noteNumber === 14 ? 2 : h.string),
        confidence: h.confidence, velocity: h.velocity, measuredHz: h.measuredHz, withF: h.string === 2 ? undefined : h.withF !== false, upperNoteNumber: upperFret(h.upperNoteNumber),
        ...(Number.isFinite(h.groupStart) ? { groupStart: h.groupStart } : {})
    })).sort((a, b) => a.time - b.time || a.string - b.string);
    draft.stanzas = sanitizeStanzas(stanzas);
    renderSongs();
    renderManualMode();
    refreshTabNoteEditor();
}
/** Notat shtohen te pozicioni i zgjedhur në listë, jo te koha e riprodhuesit. */
function selectImportedHit(hit) {
    selectedImportedHit = hit;
    selectedGroupStart = stanzas[groupForNote(stanzas, hit)]?.start ?? 0;
    $('selectedGroupSelect').value = String(selectedGroupStart);
    document.querySelectorAll('.stanza-entry').forEach(el => el.classList.toggle('group-active', el.dataset.groupStart === String(selectedGroupStart)));
    document.querySelectorAll('.analysis-note-row.is-selected').forEach(row => row.classList.remove('is-selected'));
    document.querySelectorAll('.analysis-note-row').forEach(row => {
        if (row.dataset.noteIndex === String(importedHits.indexOf(hit)))
            row.classList.add('is-selected');
    });
    $('analysisAddBtn').toggleAttribute('disabled', false);
    $('stanzaAddBtn').toggleAttribute('disabled', false);
    $('selectedNoteHint').textContent = `Nota e zgjedhur: ${hit.noteNumber ?? '?'} · ${fmt(hit.time)}. Butoni + shton notë poshtë këtij rreshti.`;
    refreshTabNoteEditor();
    redrawTab();
}
function insertNoteBelow(hit) {
    if (!draft)
        return;
    importedHits.sort((a, b) => a.time - b.time);
    const index = importedHits.indexOf(hit);
    if (index < 0)
        return;
    const sameGroup = importedHits.filter(h => groupForNote(stanzas, h) === groupForNote(stanzas, hit)).sort((a, b) => a.time - b.time);
    const following = sameGroup[sameGroup.indexOf(hit) + 1] || importedHits[index + 1];
    // Koha vendoset mes dy goditjeve; nëse janë njëkohësisht, ruajmë të njëjtën kohë.
    const durationMs = Number.isFinite(originalPlayer.duration) ? Math.round(originalPlayer.duration * 1000) : 3_600_000;
    const nextTime = following ? (following.time > hit.time + 1 ? Math.floor((hit.time + following.time) / 2) : hit.time) : Math.min(durationMs, hit.time + 200);
    const newHit = { time: nextTime, noteNumber: null, string: 1, ...accompaniment(),
        groupStart: stanzas[groupForNote(stanzas, hit)]?.start,
        confidence: 0, detail: 'Shtuar pas notës së zgjedhur' };
    importedHits.splice(index + 1, 0, newHit);
    selectedImportedHit = newHit;
    analysisRowsVisible = Math.max(analysisRowsVisible, index + 2);
    updateImportDraft();
    renderImportedHits();
    // Fokuso fushën e perdes së notës së re për ta plotësuar menjëherë.
    const selected = document.querySelector('.analysis-note-row.is-selected');
    selected?.scrollIntoView({ block: 'nearest' });
    selected?.querySelector('.analysis-fret')?.focus({ preventScroll: true });
    setStatus('Nota e re u shtua poshtë notës së zgjedhur. Vendos numrin e perdes.');
}
function renderImportedHits() {
    const editor = $('analysisEdit'), rows = $('analysisRows');
    rows.replaceChildren();
    editor.hidden = selectedId !== '__draft' || !draft;
    const editable = editableTab();
    if (!importedHits.includes(selectedImportedHit))
        selectedImportedHit = null;
    $('analysisAddBtn').toggleAttribute('disabled', !editable || !selectedImportedHit);
    $('stanzaAddBtn').toggleAttribute('disabled', !editable || !selectedImportedHit);
    $('groupAutoBtn').toggleAttribute('disabled', !editable || importedHits.length < 3);
    if (!editable) {
        $('stanzaList').replaceChildren();
        $('selectedNoteHint').textContent = 'Prek një notë për ta zgjedhur.';
        refreshTabNoteEditor();
        return;
    }
    $('selectedNoteHint').textContent = selectedImportedHit ? `Nota e zgjedhur: ${selectedImportedHit.noteNumber ?? '?'} · ${fmt(selectedImportedHit.time)}` : 'Prek një rresht note që ta zgjedhësh, pastaj shto notën poshtë saj.';
    const unknown = importedHits.filter(h => h.noteNumber === null).length;
    $('analysisCount').textContent = `${importedHits.length} goditje · ${unknown} për t’u plotësuar`;
    importedHits.sort((a, b) => a.time - b.time);
    renderStanzas();
    // Shfaq notat brenda grupit ku i ka vendosur përdoruesi, edhe kur audioja është më herët.
    const grouped = stanzas.flatMap((_, groupIndex) => importedHits
        .filter(hit => groupForNote(stanzas, hit) === groupIndex).sort((a, b) => a.time - b.time));
    const visible = grouped.slice(0, analysisRowsVisible);
    let previousStanza = -1;
    visible.forEach((hit) => {
        const assignedGroup = groupForNote(stanzas, hit);
        if (assignedGroup !== previousStanza) {
            const group = stanzas[assignedGroup];
            const title = document.createElement('div');
            title.className = 'stanza-divider';
            title.style.setProperty('--stanza-color', group.color || STANZA_COLORS[assignedGroup % STANZA_COLORS.length]);
            title.textContent = `${group.label} · ${fmt(group.start)}`;
            title.classList.toggle('group-active', group.start === selectedGroupStart);
            title.addEventListener('click', () => { selectGroup(group.start); renderImportedHits(); });
            rows.append(title);
            previousStanza = assignedGroup;
        }
        const row = document.createElement('div');
        row.className = 'analysis-note-row';
        row.style.setProperty('--group-color', colorForHit(hit));
        if (groupAtTime(stanzas, hit.time) !== assignedGroup) {
            row.classList.add('group-moved');
            row.title = `Nota është në ${stanzas[assignedGroup].label}, me kohën origjinale ${fmt(hit.time)}.`;
        }
        row.dataset.noteIndex = String(importedHits.indexOf(hit));
        if (hit === selectedImportedHit)
            row.classList.add('is-selected');
        row.addEventListener('pointerdown', () => selectImportedHit(hit));
        row.addEventListener('focusin', () => selectImportedHit(hit));
        if (hit.noteNumber === null)
            row.classList.add('unknown');
        const ms = document.createElement('input');
        ms.type = 'number';
        ms.min = '0';
        ms.step = '1';
        ms.max = String(Math.round((originalPlayer.duration || 150) * 1000));
        ms.value = String(hit.time);
        ms.setAttribute('aria-label', 'Koha në milisekonda');
        const fret = document.createElement('input');
        fret.type = 'number';
        fret.min = '1';
        fret.max = '15';
        fret.step = '1';
        fret.placeholder = 'Perdja';
        fret.classList.add('analysis-fret');
        fret.setAttribute('aria-label', 'Perdja 1–13; 14 F; 15 i hapur poshtë');
        fret.value = hit.noteNumber === null ? '' : String(hit.noteNumber);
        const fLabel = document.createElement('label');
        fLabel.className = 'f-companion';
        const fCheck = document.createElement('input');
        fCheck.type = 'checkbox';
        fCheck.checked = hit.string === 1 && hit.noteNumber !== 14 && hit.withF !== false;
        fCheck.disabled = hit.string === 2 || hit.noteNumber === 14;
        fCheck.setAttribute('aria-label', 'Teli lart shoqërues për këtë notë');
        const upper = document.createElement('select');
        upper.className = 'upper-pick';
        upper.setAttribute('aria-label', 'Perdja e telit lart për këtë notë');
        fillUpperOptions(upper);
        upper.value = String(upperFret(hit.upperNoteNumber));
        upper.disabled = fCheck.disabled || !fCheck.checked;
        fCheck.addEventListener('change', () => { hit.withF = fCheck.checked; upper.disabled = !fCheck.checked; useNotePlayback(); updateImportDraft(); });
        upper.addEventListener('change', () => { hit.upperNoteNumber = upperFret(Number(upper.value)); useNotePlayback(); updateImportDraft(); });
        fLabel.append(fCheck, upper);
        const status = document.createElement('span');
        status.className = 'analysis-confidence';
        status.textContent = hit.noteNumber === null ? '?' : hit.confidence < .65 ? 'Kontrollo' : '✓';
        status.title = hit.detail;
        const seek = document.createElement('button');
        seek.type = 'button';
        seek.className = 'btn btn-minimal';
        seek.textContent = '▶';
        seek.title = 'Dëgjo nga kjo goditje';
        seek.addEventListener('click', () => { seekToMs(hit.time); void toggleTabPlay(); });
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'btn btn-minimal';
        plus.textContent = '+';
        plus.title = 'Shto notë direkt poshtë kësaj note';
        plus.addEventListener('click', () => insertNoteBelow(hit));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-minimal';
        remove.textContent = '×';
        remove.title = 'Fshi goditjen';
        remove.addEventListener('click', () => { if (selectedImportedHit === hit)
            selectedImportedHit = null; importedHits = importedHits.filter(x => x !== hit); updateImportDraft(); renderImportedHits(); });
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'btn btn-minimal move-group';
        up.textContent = '↑';
        up.disabled = assignedGroup === 0;
        up.title = 'Kalo notën te grupi sipër';
        up.setAttribute('aria-label', up.title);
        up.addEventListener('click', () => moveHitGroup(hit, -1));
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'btn btn-minimal move-group';
        down.textContent = '↓';
        down.disabled = assignedGroup === stanzas.length - 1;
        down.title = 'Kalo notën te grupi poshtë';
        down.setAttribute('aria-label', down.title);
        down.addEventListener('click', () => moveHitGroup(hit, 1));
        const split = document.createElement('button');
        split.type = 'button';
        split.className = 'btn btn-minimal stanza-split';
        split.textContent = 'Grup';
        split.title = 'Krijo grup të ri me këtë notë si fillim';
        split.addEventListener('click', () => createGroupAtHit(hit));
        ms.addEventListener('change', () => { hit.time = Math.max(0, Math.min(Math.round((originalPlayer.duration || 150) * 1000), Math.round(Number(ms.value) || 0))); updateImportDraft(); renderImportedHits(); });
        fret.addEventListener('change', () => {
            const value = fret.value.trim(), n = value === '' ? null : Number(value);
            if (n !== null && (!Number.isInteger(n) || n < 1 || n > 15)) {
                setStatus('Zgjidh perden 1–13, 14 (F), ose 15 (i hapur).');
                fret.value = hit.noteNumber === null ? '' : String(hit.noteNumber);
                return;
            }
            hit.noteNumber = n;
            hit.string = n === 14 ? 2 : n === 15 ? 1 : hit.string;
            hit.confidence = n === null ? 0 : 1;
            hit.detail = n === null ? 'Pa notë' : 'Korrigjuar manualisht';
            updateImportDraft();
            renderImportedHits();
        });
        row.append(ms, fret, fLabel, status, seek, plus, remove, up, down, split);
        rows.append(row);
    });
    $('analysisMoreBtn').hidden = analysisRowsVisible >= grouped.length;
    refreshTabNoteEditor();
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
    manualPending = null;
    manualMode = true;
    instantTabNoteMode = false;
    selectedGroupStart = 0;
    tabCurrentMs = 0;
    tabViewStartMs = 0;
    tabFollowPlayback = true;
    importFile = file;
    importedHits = [];
    selectedImportedHit = null;
    stanzas = [{ start: 0, label: 'Grupi 1', color: GROUP_COLORS[0] }];
    editingSongId = null;
    analysisRowsVisible = 60;
    draft = newSong(file.name.replace(/\.[^.]+$/, ''), []);
    draft.originalAudioId = '__draft';
    draft.stanzas = stanzas;
    selectedId = '__draft';
    renderSongs();
    renderImportedHits();
    showOriginalBlob(file, '__draft');
    $('analyzeBtn').removeAttribute('disabled');
    $('analysisProgress').setAttribute('value', '0');
    $('analysisStatus').textContent = 'Audioja është gati. Luaj dhe prek tablaturën te çdo notë. Onset Detection është opsionale.';
    renderManualMode();
    setStatus('Audioja është ngarkuar. Shënimi manual është aktiv: Luaj, prek tablaturën dhe zgjidh perden.');
}
async function analyzeImported() {
    if (!importFile || analyzing)
        return;
    if (importedHits.length && !confirm('Ta analizojmë përsëri? Korrigjimet manuale të paruajtura do të zëvendësohen.'))
        return;
    cancelManualNote();
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
        importedHits = report.hits.map(h => ({ ...h, ...accompaniment() }));
        selectedImportedHit = null;
        analysisRowsVisible = 60;
        stanzas = autoStanzas(importedHits);
        updateImportDraft();
        renderImportedHits();
        setStatus(`U gjetën ${report.detectedOnsets} goditje të mundshme. ${report.uncertainCount} janë të pasigurta. U propozuan ${stanzas.length} grupe sipas pauzave; kontrolloji para Ruaj.`);
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
async function loadPublicCatalog() {
    try {
        const res = await fetch('./songs/catalog.json', { cache: 'no-store' });
        if (!res.ok)
            return;
        const metas = (await res.json());
        if (!Array.isArray(metas))
            return;
        for (const m of metas) {
            if (typeof m.id !== 'string' || typeof m.json !== 'string' || typeof m.name !== 'string')
                continue;
            const file = await fetch(m.json);
            if (!file.ok)
                continue;
            const song = (await file.json());
            if (!Array.isArray(song.notes) || !song.notes.length)
                continue;
            const id = 'catalog:' + m.id;
            catalogSongs.push({ ...song, id: m.id, name: m.name, originalAudioId: id });
            if (typeof m.audio === 'string')
                catalogAudioURLs.set(id, m.audio);
        }
        renderSongs();
    }
    catch (e) {
        console.warn('Katalogu nuk u ngarkua', e);
    }
}
async function connectCatalogAudio(file) {
    const song = currentSong();
    if (!song?.originalAudioId || !catalogSongs.some(s => s.id === song.id))
        return;
    if (!/\.(mp3|m4a|wav|ogg)$/i.test(file.name)) {
        setStatus('Zgjidh MP3/M4A/WAV/OGG.');
        return;
    }
    try {
        await putOriginal(song.originalAudioId, file);
        if (selectedId === song.id)
            showOriginalBlob(file, song.originalAudioId);
        setStatus('MP3 u lidh në këtë pajisje. Tani mund të luash këngën dhe grupet.');
    }
    catch (e) {
        setStatus('Ruajtja e MP3 dështoi: ' + String(e));
    }
}
function init() {
    $('groupCopyBtn').addEventListener('click', copySelectedGroup);
    $('groupPasteBtn').addEventListener('click', () => void pasteCopiedGroup());
    $('groupDeleteBtn').addEventListener('click', () => void deleteSelectedGroup());
    $('groupPasteTarget').addEventListener('change', () => {
        const value = $('groupPasteTarget').value;
        if (value && value !== '__end')
            selectGroup(Number(value));
        else
            refreshGroupCopyControls();
    });
    $('groupUndoBtn').addEventListener('click', undoGroupPaste);
    $('jsonEditBtn').addEventListener('click', openJSONEditor);
    $('jsonValidateBtn').addEventListener('click', () => validateJSONEditor());
    $('jsonFormatBtn').addEventListener('click', () => validateJSONEditor(true));
    $('jsonApplyBtn').addEventListener('click', applyJSONEditor);
    $('jsonCancelBtn').addEventListener('click', () => $('jsonEditorDialog').close());
    initNoteControls();
    installTabInteraction();
    $('practiceAllBtn').addEventListener('click', () => void playCurrent());
    $('practiceGroupBtn').addEventListener('click', () => void playSelectedGroup());
    $('practicePauseBtn').addEventListener('click', () => void toggleTabPlay());
    $('practiceStopBtn').addEventListener('click', () => $('stopBtn').click());
    $('practiceGroupSelect').addEventListener('change', e => selectGroup(Number(e.target.value)));
    $('practiceSpeedSelect').addEventListener('change', e => {
        const shared = $('playbackSpeed');
        shared.value = e.target.value;
        shared.dispatchEvent(new Event('change', { bubbles: true }));
    });
    $('tabNoteLeftBtn').addEventListener('click', () => editSelectedTabNote(-50));
    $('tabNoteRightBtn').addEventListener('click', () => editSelectedTabNote(50));
    $('tabNoteDeleteBtn').addEventListener('click', deleteSelectedTabNote);
    $('instantTabNoteBtn').addEventListener('click', () => {
        if (!instantTabNoteMode && !editableTab()) {
            const song = currentSong();
            if (song && selectedId !== '__draft') {
                void editSavedAudio().then(() => { instantTabNoteMode = true; manualMode = true; renderManualMode(); setStatus('Kliko kudo mbi tablaturë për të vendosur notën te sekonda e zgjedhur.'); });
            }
            else
                setStatus('Importo një këngë audio për të përdorur Kliko kudo → Notë.');
            return;
        }
        instantTabNoteMode = !instantTabNoteMode;
        if (instantTabNoteMode)
            manualMode = true;
        renderManualMode();
        setStatus(instantTabNoteMode ? 'Kliko kudo në tablaturë për të ndalur te sekonda dhe për të shkruar perden.' : 'Mënyra Kliko kudo u çaktivizua.');
    });
    $('manualModeBtn').addEventListener('click', () => {
        if (!editableTab()) {
            const song = currentSong();
            if (song && selectedId !== '__draft') {
                void editSavedAudio().then(() => { manualMode = true; renderManualMode(); setStatus('Shënimi manual është aktiv te kënga e ruajtur.'); });
            }
            else
                setStatus('Importo këngë audio që të shënosh notat me dorë.');
            return;
        }
        setManualMode(!manualMode);
    });
    $('manualSetBtn').addEventListener('click', () => commitManualNote(false));
    $('manualContinueBtn').addEventListener('click', () => commitManualNote(true));
    $('manualCancelBtn').addEventListener('click', cancelManualNote);
    $('manualClearBtn').addEventListener('click', () => {
        if (!editableTab() || !importedHits.length)
            return;
        if (!confirm('Të fshihen të gjitha notat e kësaj prove? Audioja origjinale dhe grupet mbeten.'))
            return;
        cancelManualNote();
        importedHits = [];
        selectedImportedHit = null;
        updateImportDraft();
        renderImportedHits();
        renderManualMode();
        setStatus('U pastruan notat e provës. Ndryshimi ruhet vetëm kur shtyp Ruaj.');
    });
    renderManualMode();
    renderInstrument();
    renderKeys();
    renderSongs();
    renderMicHits();
    audio.setVolume(Number($('volume').value) / 100);
    $('catalogAudioBtn').addEventListener('click', () => $('catalogAudioFile').click());
    $('catalogAudioFile').addEventListener('change', () => { const el = $('catalogAudioFile'); if (el.files?.[0])
        void connectCatalogAudio(el.files[0]); el.value = ''; });
    $('songSelect').addEventListener('change', e => { stopPlayback(); manualPending = null; manualMode = false; instantTabNoteMode = false; renderManualMode(); selectedGroupStart = 0; tabViewStartMs = 0; tabCurrentMs = 0; tabFollowPlayback = true; selectedId = e.target.value; $('groupPasteTarget').value = ''; renderSongs(); renderImportedHits(); void prepareOriginalForSelection(); });
    $('recordBtn').addEventListener('click', recordKeyboard);
    $('micBtn').addEventListener('click', () => void toggleMic());
    $('playBtn').addEventListener('click', () => void toggleTabPlay());
    $('groupPlayBtn').addEventListener('click', () => void playSelectedGroup());
    $('selectedGroupSelect').addEventListener('change', e => selectGroup(Number(e.target.value)));
    $('playbackSpeed').addEventListener('change', e => {
        if (audio.playing)
            seekToMs(playbackPositionMs()); // Ndalo planifikimin e vjetër para ndryshimit të shpejtësisë.
        const requestedSpeed = Number(e.target.value);
        playbackSpeed = ([1, 0.5, 0.25].includes(requestedSpeed) ? requestedSpeed : 1);
        configurePlaybackSpeed();
        setStatus(`Shpejtësia: ${playbackSpeed.toFixed(2)}×`);
    });
    $('stopBtn').addEventListener('click', () => { stopPlayback(); if (micActive)
        stopMic(); if (keyboardRecordStart !== null)
        recordKeyboard(); seekToMs(0); setStatus('Ndaluar në fillim.'); });
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
    $('analysisEditSavedBtn').addEventListener('click', () => void editSavedAudio());
    $('stanzaAddBtn').addEventListener('click', () => {
        if (!draft || !selectedImportedHit)
            return;
        createGroupAtHit(selectedImportedHit);
    });
    $('groupAutoBtn').addEventListener('click', () => {
        if (!draft || !importedHits.length)
            return;
        if (stanzas.length > 1 && !confirm('Të zëvendësohen ndarjet e grupeve me ato të zbuluara nga pauzat?'))
            return;
        // Rigrupimi automatik e rivendos anëtarësinë sipas kohës; zgjedhjet manuale zëvendësohen.
        importedHits.forEach(h => delete h.groupStart);
        stanzas = autoStanzas(importedHits);
        selectedGroupStart = 0;
        updateImportDraft();
        renderImportedHits();
        setStatus(`U ndanë ${stanzas.length} grupe sipas pauzave. Mund t’i korrigjosh vetë.`);
    });
    $('analysisAddBtn').addEventListener('click', () => {
        if (!draft || !selectedImportedHit) {
            setStatus('Prek së pari një notë në listë.');
            return;
        }
        insertNoteBelow(selectedImportedHit);
    });
    $('analysisMoreBtn').addEventListener('click', () => { analysisRowsVisible += 60; renderImportedHits(); });
    originalPlayer.addEventListener('loadedmetadata', () => {
        if (seekPendingUntilMetadata !== null) {
            originalPlayer.currentTime = Math.min(originalPlayer.duration, seekPendingUntilMetadata / 1000);
            seekPendingUntilMetadata = null;
        }
        redrawTab();
        syncTabTransport();
    });
    originalPlayer.addEventListener('play', () => {
        const song = currentSong();
        if (!usingOriginal(song)) {
            originalPlayer.pause();
            return;
        }
        audio.stop();
        cancelAnimationFrame(playFrame);
        const token = ++playToken;
        $('playBtn').textContent = currentPlayMode === 'group' ? '▶ Luaj' : '▶ Po luhet';
        $('studioState').textContent = currentPlayMode === 'group' ? 'GRUPI' : 'ORIGJINAL';
        const tick = () => {
            if (token !== playToken || originalPlayer.paused)
                return;
            const ms = originalPlayer.currentTime * 1000;
            if (currentPlayMode === 'group' && activeGroupEndMs !== null && ms >= activeGroupEndMs - 12) {
                completeGroupPlayback();
                return;
            }
            drawTab(song, ms);
            $('timeLabel').textContent = `${fmt(ms)} / ${fmt((originalPlayer.duration || 0) * 1000)}`;
            updatePlaybackNotes(song, ms);
            playFrame = requestAnimationFrame(tick);
        };
        tick();
        setStatus('Po luhet regjistrimi origjinal. 220 Hz nuk shtohet artificialisht.');
    });
    originalPlayer.addEventListener('pause', () => { if (!usingOriginal(currentSong()))
        return; cancelAnimationFrame(playFrame); clearPlayedNote(); if (usingOriginal(currentSong())) {
        $('playBtn').textContent = '▶ Luaj';
        $('studioState').textContent = 'PAUZË';
        syncTabTransport();
    } });
    originalPlayer.addEventListener('ended', () => { if (!usingOriginal(currentSong()))
        return; stopPlayback(); setStatus('Kënga origjinale përfundoi.'); });
    originalPlayer.addEventListener('timeupdate', () => {
        const song = currentSong();
        if (!usingOriginal(song))
            return;
        const ms = originalPlayer.currentTime * 1000;
        if (currentPlayMode === 'group' && activeGroupEndMs !== null && ms >= activeGroupEndMs - 12) {
            completeGroupPlayback();
            return;
        }
        drawTab(song, ms);
        $('timeLabel').textContent = `${fmt(ms)} / ${fmt((originalPlayer.duration || 0) * 1000)}`;
        if (!originalPlayer.paused)
            updatePlaybackNotes(song, ms);
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
            void hit(index + 1, index === 13 ? 2 : 1);
        }
        if (e.code === 'Space') {
            e.preventDefault();
            void toggleTabPlay();
        }
    });
    window.addEventListener('resize', () => renderTimeline());
    window.addEventListener('pagehide', () => { if (micActive)
        mic.stop(); audio.stop(); originalPlayer.pause(); });
    $('status').textContent = 'Gati për të luajtur.';
    // Marrja e regjistrimeve nuk nis zërin pa një veprim të përdoruesit.
    void audio.prepare();
    void loadPublicCatalog();
}
init();
window.dispatchEvent(new Event('ciftelia-studio-ready'));
