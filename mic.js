"use strict";

// Akordimi i dhënë nga përdoruesi (Hz):
// Perdet 1-13 = Q-D; teli i hapur (F) = 292 Hz.
// Përdoren për NJOHJEN me mikrofon; sample-t WAV mbeten të pandryshuar.
// Janë vlera reference, jo garanci absolute për çdo akordim.
const MIC_REFERENCE_HZ = [
  329, 358, 389, 440, 477, 521, 587,
  660, 719, 784, 880, 960, 1050, 292
];
const MIC_NOTE_KEYS = [..."qwertyuiopasdf"];
// Secila notë pranohet vetëm brenda ±15 Hz nga vlera e saj.
// Intervalet e Q=329 dhe W=358 mbivendosen në 343–344 Hz;
// në atë rast zgjedhim frekuencën reference më të afërt.
const MIC_TOLERANCE_HZ = 15;
const MIC_MIN_GAP_MS = 65; // Mbështet goditje të shpejta, jo vetëm 500 ms.
const MIC_PITCH_SETTLE_MS = 98; // Analizë disa herë (jo vetëm një frame), ora e sulmit ruhet.
const MIC_FIRST_PITCH_MS = 24; // Fillojmë pas sulmit, për të shmangur zhurmën fillestare.
const MIC_PITCH_CHECK_MS = 11; // Ritmi minimal mes matjeve të frekuencës.

const micButton = document.getElementById("micButton");
const micSensitivity = document.getElementById("micSensitivity");
const micSensitivityLabel = document.getElementById("micSensitivityLabel");
const micStatus = document.getElementById("micStatus");
const micNote = document.getElementById("micNote");
const micHz = document.getElementById("micHz");
const micDelta = document.getElementById("micDelta");
const micCount = document.getElementById("micCount");
const micEvents = document.getElementById("micEvents");
// Filtrat e mikrofonit: Low Cut 80 Hz aktiv nga fillimi.
const micLowCutControl = document.getElementById("lowCut80");
const micVoiceFilterControl = document.getElementById("voiceFilter");
const micNoiseControl = document.getElementById("micNoiseSuppression");
const micEchoControl = document.getElementById("micEchoCancellation");
const micGainControl = document.getElementById("micAutoGain");

const MIC_LIMIT_MS = 3 * 60 * 1000;
let micIsRecording = false;
let micIsSaving = false;
let micStream = null;
let micContext = null;
let micPitchAnalyser = null;
let micEnergyAnalyser = null;
let micSource = null;
let micHighpass = null;
let micVoiceHighpass = null;
let micVoiceLowpass = null;
let micSilentGain = null;
let micFrameID = 0;
let micStartContextTime = 0;
let micLastOnsetTimeMs = -9999;
let micPreviousRMS = 0;
let micNoiseFloor = 0.002;
let micEventsAll = [];
let micAudioChunks = [];
let micRecorder = null;
let micFolder = null;
let micRawMimeType = "";
let micPendingEvents = [];
let micFrequencyBuffer = null;
let micEnergyBuffer = null;
let micPitchTimeBuffer = null;
let micLastFrameMs = 0;
let micWorkletNode = null;
let micUseWorklet = false;
let micRealtimeStartContextTime = 0;
let micLastAcceptedNote = null;
let micLevelThreshold = .02;
let micOnsetQueue = [];


micSensitivity.addEventListener("input", () => {
  micSensitivityLabel.textContent = `${micSensitivity.value}/10`;
  micWorkletNode?.port.postMessage({ sensitivity: Number(micSensitivity.value) });
});

function micUpdateFilterSettings() {
  if (!micContext) return;
  const now = micContext.currentTime;
  if (micHighpass) micHighpass.frequency.setTargetAtTime(micLowCutControl.checked ? 80 : 10, now, .012);
  // Voice Filter opsional: kufizo spektrin, ruaj frekuencat themelore 292–1050 Hz.
  if (micVoiceHighpass) micVoiceHighpass.frequency.setTargetAtTime(micVoiceFilterControl.checked ? 170 : 10, now, .012);
  if (micVoiceLowpass) micVoiceLowpass.frequency.setTargetAtTime(micVoiceFilterControl.checked ? 1800 : 18000, now, .012);
}
for (const input of [micLowCutControl, micVoiceFilterControl]) {
  input.addEventListener('change', micUpdateFilterSettings);
}
function micDisableSystemControls(disabled) {
  for (const input of [micNoiseControl, micEchoControl, micGainControl]) input.disabled = disabled;
}

function micRMS(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
  return Math.sqrt(sum / values.length);
}

function micPeakNear(hz) {
  const bin = micContext.sampleRate / micPitchAnalyser.fftSize;
  const center = hz / bin;
  // Vlerëso spektrin afër notës; pranimi ±15 Hz bëhet më poshtë.
  const radius = Math.max(1.4, (MIC_TOLERANCE_HZ + bin) / bin);
  const begin = Math.max(1, Math.round(center - radius));
  const end = Math.min(micFrequencyBuffer.length - 2, Math.round(center + radius));
  let bestDB = -160, bestIndex = -1;
  for (let i = begin; i <= end; i++) {
    if (micFrequencyBuffer[i] > bestDB) {
      bestDB = micFrequencyBuffer[i]; bestIndex = i;
    }
  }
  if (bestIndex < 0) return { amplitude: 0, hz };
  const a = micFrequencyBuffer[bestIndex - 1];
  const b = micFrequencyBuffer[bestIndex];
  const c = micFrequencyBuffer[bestIndex + 1];
  const denom = a - 2 * b + c;
  const shift = Number.isFinite(denom) && Math.abs(denom) > 1e-6
    ? Math.max(-.5, Math.min(.5, .5 * (a - c) / denom)) : 0;
  return {
    amplitude: Math.pow(10, Math.max(-150, bestDB) / 20),
    hz: (bestIndex + shift) * bin
  };
}

// YIN/CMNDF mbi pjesën MË TË FUNDIT të audios. Ka rezolucion
// nën 1 Hz me interpolim të periodës; nuk përdor vetëm bin-in FFT.
// Matja përdor rreth 40 ms të fundit, ndaj është më pak e ndikuar
// nga nota e mëparshme kur luhet shpejt.
function micYinFundamental() {
  micPitchAnalyser.getFloatTimeDomainData(micPitchTimeBuffer);
  const input = micPitchTimeBuffer;
  const sampleRate = micContext.sampleRate;
  const minLag = Math.max(2, Math.floor(sampleRate / 1100));
  const maxLag = Math.min(256, Math.ceil(sampleRate / 275));
  const windowLen = Math.min(1600, input.length - maxLag - 2);
  const start = input.length - windowLen - maxLag - 1;
  if (start < 0 || windowLen < 300) return null;
  // Shmang njohjen nga zhurmë shumë e ulët ose heshtje.
  let energy = 0;
  for (let i = start; i < input.length; i++) energy += input[i] * input[i];
  const rms = Math.sqrt(energy / (input.length - start));
  if (rms < .005) return null;

  const cmnd = new Float32Array(maxLag + 1);
  let cumulative = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let difference = 0;
    for (let i = 0; i < windowLen; i++) {
      const delta = input[start + i] - input[start + i + tau];
      difference += delta * delta;
    }
    cumulative += difference;
    cmnd[tau] = difference * tau / Math.max(cumulative, 1e-12);
  }

  let bestTau = -1, bestValue = Infinity;
  // Merr periudhën e PARË bindëse, duke ndjekur minimumin lokal.
  // Kjo shmang zgjedhjen e dyfishit / gjysmës së frekuencës.
  for (let tau = minLag + 1; tau < maxLag; tau++) {
    const value = cmnd[tau];
    if (value < bestValue) { bestValue = value; bestTau = tau; }
    if (value < .17 && value <= cmnd[tau - 1] && value <= cmnd[tau + 1]) {
      bestTau = tau; bestValue = value;
      break;
    }
  }
  if (bestTau < 2 || bestValue > .42) return null;

  // Kur ka një harmonik të fortë (p.sh. 292/584 Hz), shiko edhe
  // periudhën e dyfishuar përpara se të pranosh një oktavë gabimisht.
  const tau2 = bestTau * 2;
  if (tau2 < maxLag - 1 && cmnd[tau2] < bestValue * .77) {
    bestTau = tau2;
    bestValue = cmnd[tau2];
  }
  const left = cmnd[bestTau - 1];
  const center = cmnd[bestTau];
  const right = cmnd[bestTau + 1];
  const denom = left - 2 * center + right;
  const correction = Math.abs(denom) > 1e-9
    ? Math.max(-.5, Math.min(.5, .5 * (left - right) / denom)) : 0;
  const hz = sampleRate / (bestTau + correction);
  if (!Number.isFinite(hz) || hz < 270 || hz > 1100) return null;
  return { hz, quality: 1 - bestValue, rms };
}

function micNearestReference(measuredHz) {
  if (!Number.isFinite(measuredHz) || measuredHz <= 0) return null;
  let closest = null;
  for (let i = 0; i < MIC_REFERENCE_HZ.length; i++) {
    const deltaHz = measuredHz - MIC_REFERENCE_HZ[i];
    if (!closest || Math.abs(deltaHz) < Math.abs(closest.deltaHz)) {
      closest = {
        noteNumber: i + 1,
        referenceHz: MIC_REFERENCE_HZ[i],
        deltaHz
      };
    }
  }
  return closest && Math.abs(closest.deltaHz) <= MIC_TOLERANCE_HZ ? closest : null;
}

function micIdentify() {
  // Përparësi YIN: mat Hz reale dhe pastaj krahason me ±15 Hz.
  const yin = micYinFundamental();
  if (yin && yin.quality >= .58) {
    const nearest = micNearestReference(yin.hz);
    if (nearest) {
      return {
        ...nearest, measuredHz: yin.hz, clear: true,
        confidenceRatio: yin.quality / .71,
        quality: yin.quality, deviationHz: nearest.deltaHz, method: 'YIN'
      };
    }
    // Matja e besueshme jashtë tolerancës mbetet e panjohur;
    // nuk e kthejmë pa arsye në një notë tjetër nga harmonikët FFT.
    if (yin.quality >= .87) {
      return {
        noteNumber: null, referenceHz: null,
        measuredHz: yin.hz, deviationHz: null, clear: false,
        confidenceRatio: 0, quality: yin.quality, method: 'YIN'
      };
    }
  }

  // Rezervë spektrale: kontrollon frekuencën themelore dhe harmonikët.
  micPitchAnalyser.getFloatFrequencyData(micFrequencyBuffer);
  const nyquist = micContext.sampleRate / 2;
  const candidates = MIC_REFERENCE_HZ.map((referenceHz, index) => {
    const fundamental = micPeakNear(referenceHz);
    const h2 = 2 * referenceHz < nyquist ? micPeakNear(2 * referenceHz) : { amplitude: 0, hz: 0 };
    const h3 = 3 * referenceHz < nyquist ? micPeakNear(3 * referenceHz) : { amplitude: 0, hz: 0 };
    const score = fundamental.amplitude + .35 * h2.amplitude + .13 * h3.amplitude;
    const measuredHz = fundamental.amplitude >= .06 * Math.max(h2.amplitude, h3.amplitude)
      ? fundamental.hz : (h2.amplitude > h3.amplitude ? h2.hz / 2 : h3.hz / 3);
    return { noteNumber: index + 1, referenceHz, measuredHz, score,
      fundamentalAmp: fundamental.amplitude };
  }).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  const ratio = best.score / Math.max(runnerUp.score, 1e-8);
  const nearest = micNearestReference(best.measuredHz);
  // Kërkojmë dallim të dukshëm, jo vetëm një pik spektral të rastësishëm.
  const clear = best.score > .00008 && ratio >= 1.15 &&
    nearest !== null && nearest.noteNumber === best.noteNumber;
  return {
    noteNumber: clear ? nearest.noteNumber : null,
    referenceHz: clear ? nearest.referenceHz : null,
    measuredHz: yin?.hz ?? best.measuredHz,
    deviationHz: clear ? nearest.deltaHz : null,
    confidenceRatio: ratio, quality: clear ? .72 : 0, clear,
    method: 'FFT'
  };
}

// Vendos notën vetëm pasi disa lexime të shkurtra pajtohen.
// Gabimet e një frame-i të vetëm nuk kthehen në notë të këngës.
function micResolvePitch(samples) {
  const valid = samples.filter(s => s.clear && Number.isFinite(s.measuredHz));
  if (!valid.length) {
    const last = samples.at(-1);
    return last ? { ...last, clear: false, noteNumber: null,
      referenceHz: null, deviationHz: null } : {
        clear: false, noteNumber: null, referenceHz: null,
        measuredHz: NaN, deviationHz: null, confidenceRatio: 0,
        quality: 0, method: 'pa sinjal'
      };
  }
  const counts = new Map();
  for (const sample of valid) {
    const list = counts.get(sample.noteNumber) || [];
    list.push(sample);
    counts.set(sample.noteNumber, list);
  }
  let winner = null;
  for (const [noteNumber, list] of counts) {
    if (!winner || list.length > winner.samples.length ||
      (list.length === winner.samples.length &&
        list.reduce((s, x) => s + (x.quality || 0), 0) >
        winner.samples.reduce((s, x) => s + (x.quality || 0), 0))) {
      winner = { noteNumber, samples: list };
    }
  }
  // Kur kemi disa lexime, duhen >=2 matje të njëjta.
  // Për një goditje shumë të shpejtë lejohet edhe një YIN shumë i mirë.
  const alternatives = [...counts.entries()]
    .filter(([number]) => number !== winner.noteNumber)
    .reduce((total, [, list]) => total + list.length, 0);
  // Konsensus mbi së paku dy matje. Një matje YIN jashtëzakonisht
  // e qartë lejohet vetëm kur nuk ka note kundërshtuese.
  const consensus = (winner.samples.length >= 2 && winner.samples.length > alternatives) ||
    (winner.samples.length === 1 && alternatives === 0 &&
     winner.samples[0].method === 'YIN' && winner.samples[0].quality >= .93);
  const values = winner.samples.map(s => s.measuredHz).sort((a, b) => a - b);
  const median = values.length % 2 ? values[values.length >> 1]
    : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
  const nearest = micNearestReference(median);
  if (!consensus || !nearest || nearest.noteNumber !== winner.noteNumber) {
    return { ...winner.samples[0], clear: false, noteNumber: null,
      referenceHz: null, measuredHz: median, deviationHz: null,
      confidenceRatio: 0, method: 'pasigurt' };
  }
  return {
    ...winner.samples[0], ...nearest, measuredHz: median,
    deviationHz: nearest.deltaHz, clear: true,
    confidenceRatio: winner.samples.length / Math.max(1, samples.length),
    quality: winner.samples.reduce((sum, v) => sum + (v.quality || 0), 0) / winner.samples.length,
    method: 'shumë matje'
  };
}

// Përdoruesi mund ta korrigjojë një notë të pasigurt duke klikuar te "?".
// Nuk e shpikim notën kur matja nuk jep rezultat brenda ±15 Hz.
function micUpdateDraftFromEvents() {
  if (!draftSong || draftSong.source !== 'microphone') return;
  const accepted = micEventsAll.filter(e => Number.isInteger(e.noteNumber));
  const first = accepted[0]?.time ?? 0;
  draftSong.notes = accepted.map(e => ({
    string: 1, noteNumber: e.noteNumber, time: Math.max(0, Math.round(e.time - first))
  }));
  draftSong.events = micEventsAll.map(e => ({ ...e }));
  micCount.textContent = `${accepted.length}/${micEventsAll.length}`;
  status.textContent = accepted.length
    ? `✓ ${accepted.length} nota gati për Luaj/Ruaj. Kliko mbi ? për ta plotësuar notën që mungon.`
    : 'Asnjë notë ende e sigurt. Kliko mbi ? për t’i caktuar manualisht.';
  perditesoButonat();
}

function micRefreshEventChips() {
  micEvents.replaceChildren();
  for (let i = 0; i < micEventsAll.length; i++) {
    const ev = micEventsAll[i];
    const key = Number.isInteger(ev.noteNumber) ? MIC_NOTE_KEYS[ev.noteNumber - 1].toUpperCase() : '?';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mic-event-chip' + (key === '?' ? ' is-uncertain' : '');
    button.textContent = `${key} · ${ev.deltaMs === null ? '0' : '+' + ev.deltaMs}ms${key === '?' ? ' ?' : ''}`;
    button.title = `Goditja ${i + 1} · ${ev.measuredHz === null ? 'pa Hz të qëndrueshme' : ev.measuredHz + ' Hz'} · Kliko për korrigjim pas ndalimit`;
    button.setAttribute('aria-label', `Goditja ${i+1}, nota ${key}. Kliko për ta korrigjuar`);
    button.addEventListener('click', () => micEditEvent(i));
    micEvents.appendChild(button);
  }
  micEvents.scrollTop = micEvents.scrollHeight;
}

function micEditEvent(index) {
  if (micIsRecording || micIsSaving) {
    micStatus.textContent = 'Ndalo mikrofonin përpara se të korrigjosh notat.';
    return;
  }
  const event = micEventsAll[index];
  if (!event) return;
  const current = event.noteNumber ? MIC_NOTE_KEYS[event.noteNumber - 1].toUpperCase() : '?';
  const choice = prompt(
    `Goditja ${index + 1} (${event.measuredHz ?? 'Hz të paqarta'}). ` +
    `Shkruaj tastin Q W E R T Y U I O P A S D F. ` +
    `Lëre bosh për ta shënuar të panjohur.`, current === '?' ? '' : current
  );
  if (choice === null) return;
  const normalized = choice.trim().toLowerCase();
  const noteNumber = MIC_NOTE_KEYS.indexOf(normalized) + 1;
  if (normalized && !noteNumber) {
    micStatus.textContent = 'Tast i pavlefshëm. Përdor Q W E R T Y U I O P A S D F.';
    return;
  }
  event.noteNumber = noteNumber || null;
  event.referenceHz = noteNumber ? MIC_REFERENCE_HZ[noteNumber - 1] : null;
  event.deviationHz = noteNumber && Number.isFinite(event.measuredHz)
    ? Math.round((event.measuredHz - event.referenceHz) * 10) / 10 : null;
  event.confidence = 'manual';
  event.method = 'korrigjuar nga përdoruesi';
  micRefreshEventChips();
  micUpdateDraftFromEvents();
  micStatus.textContent = noteNumber
    ? `✓ Goditja ${index+1} u vendos ${normalized.toUpperCase()}; koha ${event.time} ms u ruajt e pandryshuar.`
    : `Goditja ${index+1} mbetet e panjohur, por koha e saj nuk humbi.`;
}

function micAddEvent(event) {
  micEventsAll.push(event);
  const key = Number.isInteger(event.noteNumber) ? MIC_NOTE_KEYS[event.noteNumber - 1].toUpperCase() : '?';
  micNote.textContent = event.noteNumber ? `${key} · ${event.noteNumber}` : '?';
  micHz.textContent = Number.isFinite(event.measuredHz) ? `${event.measuredHz.toFixed(1)} Hz` : '— Hz';
  micDelta.textContent = event.deltaMs === null ? 'Fillimi' : `${event.deltaMs} ms`;
  micCount.textContent = `${micEventsAll.filter(e => e.noteNumber).length}/${micEventsAll.length}`;
  micRefreshEventChips();
  if (event.noteNumber) {
    aktivizoNotat([{ string: 1, noteNumber: event.noteNumber }]);
    document.querySelectorAll('.note-key.is-playing').forEach(x => x.classList.remove('is-playing'));
    document.querySelector(`.note-key[data-note="${event.noteNumber}"]`)?.classList.add('is-playing');
  }
  micStatus.textContent = event.noteNumber
    ? `● Nota ${key} · ${event.measuredHz?.toFixed(1)} Hz / ref. ${event.referenceHz} Hz`
    : `● Goditja në ${event.time} ms nuk u njoh brenda ±15 Hz. Pas ndalimit kliko ? për ta korrigjuar.`;
}

function micQueueOnset(timeMs) {
  if (!micIsRecording || !Number.isFinite(timeMs)) return;
  const time = Math.max(0, Math.round(timeMs));
  if (time - micLastOnsetTimeMs < MIC_MIN_GAP_MS) return;
  micLastOnsetTimeMs = time;
  // Mos lejo matjet e kësaj goditjeje të përzihen me notën pasuese.
  const previousPending = micPendingEvents.at(-1);
  if (previousPending) previousPending.readyMs = Math.min(previousPending.readyMs, time - 1);
  // Koha vjen nga ora e audios dhe nuk ndryshohet nga analiza 57 ms më pas.
  micPendingEvents.push({
    time, readyMs: time + MIC_PITCH_SETTLE_MS,
    firstPitchMs: time + MIC_FIRST_PITCH_MS, lastSampleMs: -Infinity,
    samples: []
  });
}

function micCapturePending(nowMs) {
  // Matja bëhet disa herë pas sulmit, por koha e regjistruar
  // mbetet koha e goditjes nga AudioWorklet.
  for (const pending of micPendingEvents) {
    if (nowMs >= pending.firstPitchMs &&
        nowMs - pending.lastSampleMs >= MIC_PITCH_CHECK_MS &&
        nowMs <= pending.readyMs + 15 && micPitchAnalyser) {
      pending.samples.push(micIdentify());
      pending.lastSampleMs = nowMs;
    }
  }
  while (micPendingEvents.length && micPendingEvents[0].readyMs <= nowMs) {
    const pending = micPendingEvents.shift();
    const detected = micResolvePitch(pending.samples);
    const previous = micEventsAll.at(-1);
    const measuredHz = Number.isFinite(detected.measuredHz)
      ? Math.round(detected.measuredHz * 10) / 10 : null;
    micAddEvent({
      string: 1,
      noteNumber: detected.clear ? detected.noteNumber : null,
      time: pending.time,
      deltaMs: previous ? pending.time - previous.time : null,
      measuredHz,
      referenceHz: detected.clear ? detected.referenceHz : null,
      deviationHz: detected.clear ? Math.round(detected.deviationHz * 10) / 10 : null,
      toleranceHz: MIC_TOLERANCE_HZ,
      confidence: detected.clear && detected.confidenceRatio >= .55 ? 'e mire' : 'e ulet',
      method: detected.method,
      measurements: pending.samples.length
    });
  }
}

// Rezervë për browser pa AudioWorklet; koha vjen nga AudioContext
// por rezolucioni i detektimit kufizohet nga ritmi i ekranit (~16 ms).
function micFallbackOnset(nowMs, rms) {
  const sensitivity = Number(micSensitivity.value);
  const minRms = .033 - sensitivity * .0025;
  const riseFactor = 1.54 - sensitivity * .025;
  if (rms < Math.max(.025, minRms * 1.4)) {
    micNoiseFloor = .99 * micNoiseFloor + .01 * rms;
  }
  const threshold = Math.max(minRms, micNoiseFloor * 2.8);
  const climbed = rms > micPreviousRMS * riseFactor && rms - micPreviousRMS > threshold * .12;
  const awakened = micPreviousRMS < threshold * .7 && rms >= threshold;
  if (rms > threshold && (climbed || awakened)) micQueueOnset(nowMs);
  micPreviousRMS = rms;
}

function micFrame() {
  if (!micIsRecording || !micContext) return;
  const nowMs = (micContext.currentTime - micStartContextTime) * 1000;
  if (nowMs >= MIC_LIMIT_MS) { void micStop(); return; }
  if (!micUseWorklet) {
    micEnergyAnalyser.getFloatTimeDomainData(micEnergyBuffer);
    micFallbackOnset(nowMs, micRMS(micEnergyBuffer));
  }
  micCapturePending(nowMs);
  micFrameID = requestAnimationFrame(micFrame);
}

function micSetButton(active) {
  micButton.classList.toggle("is-recording", active);
  micButton.setAttribute("aria-pressed", String(active));
  micButton.textContent = active ? "■ Ndalo mikrofonin" : "🎙 Nis mikrofonin";
  document.getElementById("playButton").disabled = active;
  recordPlus.disabled = active;
}

async function micStart() {
  if (micIsRecording || micIsSaving) return;
  if (recording) {
    micStatus.textContent = "Ndalo së pari regjistrimin me butonin +.";
    return;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    micStatus.textContent = "Mikrofoni kërkon HTTPS ose localhost. Hape me Live Server në VS Code (jo direkt si file://).";
    return;
  }
  if (draftSong && !confirm("Ke një këngë provë të paregjistruar. Ta hedhim poshtë për të filluar një tjetër?")) return;
  if (draftSong) hiqDraftin();
  ndaloKengen(); // Shmang njohjen e zërit që luhet nga vetë telefoni.
  micButton.disabled = true;
  micStatus.textContent = "Po kërkohet vetëm leja e mikrofonit...";
  try {
    // Safari: AudioContext duhet krijuar/aktivizuar GJATË prekjes së butonit,
    // jo pas kërkesës asinkrone për lejen e mikrofonit.
    const AudioAPI = window.AudioContext || window.webkitAudioContext;
    if (!AudioAPI) throw new Error('Web Audio nuk mbështetet nga ky shfletues.');
    micContext = new AudioAPI();
    const resumeRequest = micContext.resume();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: micEchoControl.checked,
        noiseSuppression: micNoiseControl.checked,
        autoGainControl: micGainControl.checked,
        channelCount: { ideal: 1 }
      },
      video: false
    });
    await resumeRequest;
    if (micContext.state !== 'running') await micContext.resume();
    if (micContext.state !== 'running') throw new Error('AudioContext është pezulluar në Safari. Prek sërish mikrofonin.');
    micSource = micContext.createMediaStreamSource(micStream);
    micHighpass = micContext.createBiquadFilter();
    micHighpass.type = "highpass";
    micHighpass.frequency.value = micLowCutControl.checked ? 80 : 10;
    micHighpass.Q.value = 0.707;
    micVoiceHighpass = micContext.createBiquadFilter();
    micVoiceHighpass.type = "highpass";
    micVoiceHighpass.frequency.value = micVoiceFilterControl.checked ? 170 : 10;
    micVoiceHighpass.Q.value = 0.707;
    micVoiceLowpass = micContext.createBiquadFilter();
    micVoiceLowpass.type = "lowpass";
    micVoiceLowpass.frequency.value = micVoiceFilterControl.checked ? 1800 : 18000;
    micVoiceLowpass.Q.value = 0.707;
    micPitchAnalyser = micContext.createAnalyser();
    micPitchAnalyser.fftSize = 4096;
    micPitchAnalyser.smoothingTimeConstant = 0.16;
    micEnergyAnalyser = micContext.createAnalyser();
    micEnergyAnalyser.fftSize = 512;
    micEnergyAnalyser.smoothingTimeConstant = 0;
    micSource.connect(micHighpass);
    micHighpass.connect(micVoiceHighpass);
    micVoiceHighpass.connect(micVoiceLowpass);
    micVoiceLowpass.connect(micPitchAnalyser);
    micVoiceLowpass.connect(micEnergyAnalyser);
    // Pa këtë lidhje disa versione të iOS Safari nuk e përpunojnë
    // analizuesin në sfond. Gain 0: asnjë jehonë në altoparlant.
    micSilentGain = micContext.createGain();
    micSilentGain.gain.value = 0;
    micEnergyAnalyser.connect(micSilentGain);
    micSilentGain.connect(micContext.destination);
    // AudioWorklet mat fillimin e goditjes në blloqe 128 samplesh,
    // në vend të requestAnimationFrame (që mund të vonohet nga ekrani).
    // Dalja e worklet është HESHTJE, jo sinjali i mikrofonit.
    micUseWorklet = false;
    micWorkletNode = null;
    if (micContext.audioWorklet && window.AudioWorkletNode) {
      try {
        await micContext.audioWorklet.addModule('mic-onset-worklet.js');
        micWorkletNode = new AudioWorkletNode(micContext, 'ciftelia-onset');
        micWorkletNode.port.onmessage = event => {
          if (event.data?.type === 'onset') {
            micQueueOnset((event.data.audioTime - micStartContextTime) * 1000);
          }
        };
        micWorkletNode.port.postMessage({ sensitivity: Number(micSensitivity.value) });
        micVoiceLowpass.connect(micWorkletNode);
        micWorkletNode.connect(micContext.destination);
        micUseWorklet = true;
      } catch (error) { console.warn('AudioWorklet s’u ngarkua: përdoret detektimi rezervë.', error); }
    }
    // Nuk lidhet zëri i mikrofonit me altoparlantët: shmangim feedback-un.
    micFrequencyBuffer = new Float32Array(micPitchAnalyser.frequencyBinCount);
    micEnergyBuffer = new Float32Array(micEnergyAnalyser.fftSize);
    micPitchTimeBuffer = new Float32Array(micPitchAnalyser.fftSize);
    micAudioChunks = [];
    micRecorder = null;
    micRawMimeType = "";
    if (window.MediaRecorder) {
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", ""]
        .find(t => !t || MediaRecorder.isTypeSupported(t));
      try {
        micRecorder = new MediaRecorder(micStream, type ? { mimeType: type } : {});
        micRawMimeType = micRecorder.mimeType;
        micRecorder.addEventListener("dataavailable", e => { if (e.data.size > 0) micAudioChunks.push(e.data); });
        micRecorder.start(250);
      } catch (error) {
        console.warn("MediaRecorder nuk është në dispozicion. Notat do të ruhen:", error);
      }
    }
    micStartContextTime = micContext.currentTime;
    micLastOnsetTimeMs = -9999;
    micPreviousRMS = 0;
    micNoiseFloor = .002;
    micEventsAll = [];
    micPendingEvents = [];
    micCount.textContent = "0/0";
    micNote.textContent = "—";
    micHz.textContent = "— Hz";
    micDelta.textContent = "— ms";
    micEvents.replaceChildren();
    micIsRecording = true;
    micDisableSystemControls(true);
    micSetButton(true);
    micStatus.textContent = "● Mikrofoni po dëgjon. Gjatë regjistrimit nuk del zë nga telefoni (shmang jehonën). Pas ndalimit shtyp ▶ Luaj.";
    micFrameID = requestAnimationFrame(micFrame);
  } catch (error) {
    console.error("Mikrofoni nuk u hap:", error);
    micStatus.textContent = `Nuk u hap mikrofoni: ${error.message || "Leja u refuzua"}.`;
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    micStream = null;
    if (micSilentGain) { micSilentGain.disconnect(); micSilentGain = null; }
    micDisableSystemControls(false);
    if (micContext) await micContext.close().catch(() => {});
    micContext = null;
  } finally {
    micButton.disabled = false;
  }
}

function micExportCSV(events) {
  const header = ["nr", "nota", "tasti", "koha_ms", "intervali_ms", "frekuenca_matur_hz", "frekuenca_reference_hz", "devijimi_hz", "toleranca_hz", "besueshmeria"];
  const rows = events.map((ev, i) => [
    i + 1, ev.noteNumber ?? "?", ev.noteNumber ? MIC_NOTE_KEYS[ev.noteNumber - 1].toUpperCase() : "?",
    ev.time, ev.deltaMs ?? "", ev.measuredHz ?? "", ev.referenceHz ?? "", ev.deviationHz ?? "", MIC_TOLERANCE_HZ, ev.confidence
  ]);
  return '\uFEFF' + [header, ...rows].map(row => row.join(",")).join("\r\n") + "\r\n";
}

async function micSave(events, originalAudio) {
  micEventsAll = events.map(ev => ({...ev}));
  const recognizedEvents = events.filter(e => e.noteNumber !== null);
  const firstNoteTimeMs = recognizedEvents[0]?.time ?? 0;
  const playable = recognizedEvents.map(e => ({
    string: 1, noteNumber: e.noteNumber, time: e.time - firstNoteTimeMs
  }));
  if (!events.length) {
    micStatus.textContent = 'Nuk u dëgjua asnjë goditje. Afroje mikrofonin dhe provo sërish.';
    return;
  }
  if (playable.length) {
    krijoKengeProve(playable, 'microphone', { events, audio: originalAudio });
  } else {
    // Krijo këngë provë bosh, që notat e paqarta mund të plotësohen.
    // Ruaj është i çaktivizuar derisa të ketë të paktën një notë.
    draftSong = {
      id: `prove-${Date.now()}`, name: 'Nga mikrofoni · korrigjo notat',
      source: 'microphone', notes: [], events: events.map(e => ({ ...e }))
    };
    draftAudio = originalAudio;
    rifreskoKengePersonale(draftSong.id);
  }
  micRefreshEventChips();
  micUpdateDraftFromEvents();
  micStatus.textContent = `✓ ${playable.length}/${events.length} nota të njohura. ` +
    `Kliko mbi ? dhe zgjidh Q–F për të korrigjuar të panjohurat; pastaj Luaj dhe Ruaj nëse dëshiron.`;
}

async function micStop() {
  if (!micIsRecording || micIsSaving) return;
  micIsSaving = true;
  micButton.disabled = true;
  micStatus.textContent = "Po mbyllet mikrofoni dhe po përgatitet kënga provë...";
  // Prit notën e fundit në analizë (pa ndryshuar kohën e goditjes).
  await new Promise(resolve => setTimeout(resolve, 105));
  micIsRecording = false;
  cancelAnimationFrame(micFrameID);
  if (micPendingEvents.length && micPitchAnalyser) {
    for (const pending of micPendingEvents) pending.readyMs = 0;
    micCapturePending(Infinity);
  }
  micPendingEvents = [];
  const events = micEventsAll.slice();
  let originalAudio = null;
  if (micRecorder && micRecorder.state !== "inactive") {
    try {
      const recorder = micRecorder;
      await new Promise(resolve => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.stop();
      });
      if (micAudioChunks.length) originalAudio = new Blob(micAudioChunks, { type: micRawMimeType || "audio/webm" });
    } catch (error) { console.warn("Audioja origjinale nuk u ruajt:", error); }
  }
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  micStream = null;
  if (micSource) micSource.disconnect();
  if (micWorkletNode) { micWorkletNode.port.onmessage = null; micWorkletNode.disconnect(); micWorkletNode = null; }
  // Ruaje llojin e matjes deri pas eksportimit.
  if (micHighpass) micHighpass.disconnect();
  if (micVoiceHighpass) micVoiceHighpass.disconnect();
  if (micVoiceLowpass) micVoiceLowpass.disconnect();
  micHighpass = micVoiceHighpass = micVoiceLowpass = null;
  if (micContext) await micContext.close().catch(() => {});
  micContext = null;
  micSetButton(false);
  micDisableSystemControls(false);
  micButton.disabled = true;
  try {
    await micSave(events, originalAudio);
  } catch (error) {
    console.error("Ruajtja e mikrofonit dështoi:", error);
    micStatus.textContent = `Gabim gjatë ruajtjes: ${error.message}`;
  } finally {
    micUseWorklet = false;
    micIsSaving = false;
    micButton.disabled = false;
  }
}

micButton.addEventListener("click", () => {
  if (micIsRecording) void micStop(); else void micStart();
});
