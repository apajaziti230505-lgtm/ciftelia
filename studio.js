'use strict';
/* Çiftelia Studio — pamje e re me tablaturë vizuale. Nuk ndryshon analizën e mikrofonit.
 * Përdor të njëjtën listë notash dhe të njëjtin motor audio të script.js. */
(function () {
  const studioNeck = document.getElementById('studioNeck');
  const currentNote = document.getElementById('studioCurrentNote');
  const currentHz = document.getElementById('studioCurrentHz');
  const stateLabel = document.getElementById('studioPlayState');
  const countLabel = document.getElementById('studioNoteCount');
  const timeLabel = document.getElementById('studioTime');
  const meter = document.getElementById('studioMeterFill');
  const canvas = document.getElementById('studioTabCanvas');
  const video = document.getElementById('studioVideo');
  const emptyVideo = document.getElementById('studioVideoEmpty');
  const videoInput = document.getElementById('studioVideoUpload');
  const removeVideo = document.getElementById('studioRemoveVideo');
  const syncVideo = document.getElementById('studioSyncVideo');
  const openF = document.getElementById('studioOpenF');
  const keys = 'QWERTYUIOPASDF';
  const frequencies = [329, 358, 389, 440, 477, 521, 587, 660, 719, 784, 880, 960, 1050, 292];
  const spots = new Map();
  let events = [];
  let playing = false;
  let startPerformanceMs = 0;
  let context = null;
  let contextStartTime = 0;
  let durationMs = 0;
  let animationFrame = 0;
  let latestIndex = -1;
  let pulseTimeout = 0;
  let videoUrl = '';
  let canvasCtx;
  let lastDrawnTime = 0;

  for (let fret = 1; fret <= 13; fret++) {
    const div = document.createElement('div');
    div.className = 'studio-fret' + ([4,7,8,11].includes(fret) ? ' inlay' : '');
    const width = fretXs[fret] - fretXs[fret - 1];
    div.style.flex = `${width} 1 0px`;
    const label = document.createElement('span');
    label.className = 'studio-fret-label';
    label.textContent = `${fret}`;
    div.appendChild(label);
    for (let string = 1; string <= 2; string++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'studio-fret-hit';
      button.dataset.string = String(string);
      button.setAttribute('aria-label', `Teli ${string}, perdja ${fret}, nota ${keys[fret - 1]}`);
      button.title = `Teli ${string} · ${keys[fret - 1]} (${frequencies[fret - 1]} Hz)`;
      const dot = document.createElement('i');
      dot.className = 'studio-note-dot';
      button.appendChild(dot);
      button.addEventListener('click', () => luajNoten(string, fret));
      div.appendChild(button);
      spots.set(`${string}-${fret}`, button);
    }
    studioNeck.appendChild(div);
  }
  openF.addEventListener('click', () => luajNoten(1, 14));

  function keyName(note) {
    return keys[note.noteNumber - 1] || '?';
  }
  function formatTime(t) {
    const ms = Math.max(0, Math.round(t));
    return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(Math.floor(ms / 10) % 100).padStart(2, '0')}`;
  }
  function selectedNotes() {
    const id = songSelect.value;
    const result = databazaKengeve[id] || (draftSong?.id === id ? draftSong.notes : customSongs.find(s => s.id === id)?.notes);
    return Array.isArray(result) ? result : [];
  }
  function validNotes(input) {
    return (Array.isArray(input) ? input : [])
      .filter(n => Number.isInteger(n.noteNumber) && n.noteNumber >= 1 && n.noteNumber <= 14 && Number.isFinite(n.time) && n.time >= 0)
      .map(n => ({string:n.string === 2 ? 2 : 1, noteNumber:n.noteNumber,time:n.time}))
      .sort((a,b) => a.time - b.time);
  }
  function clearDots() {
    for (const button of spots.values()) button.classList.remove('is-on');
    openF.classList.remove('is-on');
  }
  function lightNotes(group) {
    clearDots();
    if (!group?.length) {
      currentNote.textContent = '—';
      currentHz.textContent = '13 perde + teli i hapur F';
      return;
    }
    for (const note of group) {
      if (note.noteNumber === 14) openF.classList.add('is-on');
      else spots.get(`${note.string}-${note.noteNumber}`)?.classList.add('is-on');
    }
    const principal = group.find(n => n.string === 1) || group[0];
    currentNote.textContent = keyName(principal);
    currentHz.textContent = `${frequencies[principal.noteNumber - 1]} Hz · ${principal.noteNumber === 14 ? 'Teli i hapur' : 'Perdja ' + principal.noteNumber}`;
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(170 * ratio);
    canvasCtx = canvas.getContext('2d');
    canvasCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawAt(lastDrawnTime);
  }
  function drawAt(currentMs) {
    lastDrawnTime = currentMs;
    if (!canvasCtx) return;
    const c = canvasCtx;
    const w = canvas.getBoundingClientRect().width;
    const h = 170;
    c.clearRect(0,0,w,h);
    c.fillStyle = '#0b111e'; c.fillRect(0,0,w,h);
    const x0 = Math.max(60, w * .25);
    const scale = .19; // 190 px / sekondë, njësi milisekondash
    for (let t = Math.max(0, Math.floor((currentMs - x0 / scale) / 250) * 250); t <= currentMs + (w - x0) / scale; t += 250) {
      if (t < 0) continue;
      const x = x0 + (t - currentMs) * scale;
      c.strokeStyle = t % 1000 === 0 ? '#34455b' : '#1b2a3a';
      c.lineWidth = t % 1000 === 0 ? 1.3 : .75;
      c.beginPath(); c.moveTo(x,18);c.lineTo(x,144);c.stroke();
      if (t % 1000 === 0) {
        c.fillStyle = '#718aa0'; c.font = '10px Arial';
        c.fillText((t/1000).toFixed(0)+'s',x+4,15);
      }
    }
    for (let string = 1; string <= 2; string++) {
      const y = string === 1 ? 59 : 110;
      c.lineWidth = string === 1 ? 2 : 1.6;
      c.strokeStyle = string === 1 ? '#3d9fb2' : '#9e74ab';
      c.beginPath(); c.moveTo(43,y); c.lineTo(w,y);c.stroke();
      c.fillStyle = string === 1 ? '#67c4d5' : '#baa0d4';
      c.font = 'bold 10px Arial';
      c.fillText(string === 1 ? 'T1' : 'T2',10,y+3);
    }
    // Numrat lëvizin nga e djathta drejt vijës së bardhë.
    const visible = events.filter(n => n.time >= currentMs - (x0 + 40) / scale && n.time <= currentMs + (w - x0 + 25) / scale);
    for (const note of visible) {
      const x = x0 + (note.time - currentMs) * scale;
      const y = note.string === 1 ? 59 : 110;
      const past = note.time < currentMs - 35;
      c.beginPath(); c.arc(x, y, past ? 11 : 12, 0, Math.PI * 2);
      c.fillStyle = past ? '#715844' : '#e6a24e';
      c.shadowBlur = past ? 0 : 14;
      c.shadowColor = '#efab54';
      c.fill(); c.shadowBlur = 0;
      c.strokeStyle = past ? '#997354' : '#ffe1aa';
      c.lineWidth = 1.3; c.stroke();
      c.fillStyle = '#161d26';c.textAlign = 'center';c.font = 'bold 10px Arial';
      c.fillText(keyName(note),x,y+3.4);c.textAlign='start';
    }
    // Në video vije e bardhë qendrore udhëheq luajtjen.
    c.strokeStyle = '#f6faff'; c.lineWidth = 2.4;
    c.shadowBlur = 6; c.shadowColor = '#eff6ff';
    c.beginPath();c.moveTo(x0,21);c.lineTo(x0,143);c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = '#eaf2f9'; c.beginPath();c.moveTo(x0-5,20);c.lineTo(x0+5,20);c.lineTo(x0,27);c.fill();
  }
  function clockNow() {
    if (context && context.state === 'running') return Math.max(0,(context.currentTime - contextStartTime)*1000);
    return Math.max(0, performance.now() - startPerformanceMs);
  }
  function tick() {
    if (!playing) return;
    const t = Math.max(0, clockNow());
    const index = lastEventIndex(t);
    if (index !== latestIndex) {
      latestIndex = index;
      if (index < 0) clearDots();
      else {
        const at = events[index].time;
        lightNotes(events.filter(n => n.time === at));
      }
    }
    drawAt(t);
    const fraction = durationMs > 0 ? Math.min(1,t/durationMs) : 0;
    meter.style.width = `${(fraction*100).toFixed(1)}%`;
    timeLabel.textContent = `${formatTime(t)} / ${formatTime(durationMs)}`;
    if (t > durationMs + 350) {
      playing = false;stateLabel.textContent = 'PËRFUNDOI';
      if (video && !video.paused && syncVideo.checked) video.pause();
      clearDots();
      return;
    }
    animationFrame = requestAnimationFrame(tick);
  }
  function lastEventIndex(t) {
    let left=0,right=events.length-1,answer=-1;
    while(left<=right){const m=(left+right)>>1;if(events[m].time<=t+14){answer=m;left=m+1;}else right=m-1;}
    return answer;
  }
  function preview() {
    if (playing) return;
    events = validNotes(selectedNotes());
    durationMs = Math.max(0,...events.map(n => n.time)) + (events.length ? 480 : 0);
    countLabel.textContent = events.length ? `${events.length} nota · ${formatTime(durationMs)}` : 'Nuk ka nota për këtë këngë';
    timeLabel.textContent = `00:00.00 / ${formatTime(durationMs)}`;
    meter.style.width = '0%';
    drawAt(0);
  }
  function start(input, options = {}) {
    cancelAnimationFrame(animationFrame);
    clearTimeout(pulseTimeout);
    events = validNotes(input);
    durationMs = Math.max(0,...events.map(n=>n.time)) + (events.length ? 500 : 0);
    if (!events.length) {preview();return;}
    playing = true;
    latestIndex = -1;
    context = options.audioContext || null;
    contextStartTime = Number.isFinite(options.startAt) ? options.startAt : 0;
    startPerformanceMs = performance.now() + (options.startDelayMs || 0);
    stateLabel.textContent = '● PO LUHET';
    countLabel.textContent = `${events.length} nota · ndiq vijën e bardhë`;
    clearDots();
    tick();
    if (videoUrl && syncVideo.checked) {
      try { video.pause(); video.currentTime = 0; video.play().catch(()=>{ /* Safari mund të kërkojë klikim mbi video */ }); } catch (_) {}
    }
  }
  function stop() {
    cancelAnimationFrame(animationFrame);
    clearTimeout(pulseTimeout);
    playing = false;context=null;
    stateLabel.textContent = 'GATI';
    clearDots();
    lightNotes([]);
    if (videoUrl && syncVideo.checked && !video.paused) video.pause();
    preview();
  }
  function manual(note) {
    if (playing) stop();
    clearTimeout(pulseTimeout);
    lightNotes([note]);
    stateLabel.textContent = '● NOTË LIVE';
    pulseTimeout = setTimeout(()=>{
      if (!playing) {lightNotes([]);stateLabel.textContent='GATI';}
    }, 350);
  }
  function micEvent(event) {
    if (event?.noteNumber >= 1 && event.noteNumber <= 14) {
      manual({ string: 1,noteNumber:event.noteNumber,time:event.time || 0 });
      stateLabel.textContent = '● MIKROFON';
    } else {
      stateLabel.textContent = '? FREKUENCË E PAQARTË';
    }
  }

  document.getElementById('studioPlay').addEventListener('click',()=>void luajKengen());
  document.getElementById('studioStop').addEventListener('click',ndaloGjithcka);
  songSelect.addEventListener('change',()=>{
    if (playing) ndaloKengen();
    preview();
  });
  videoInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {alert('Zgjidh një skedar video MP4, MOV ose WebM.');return;}
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(file);
    video.src = videoUrl;
    video.hidden = false;emptyVideo.hidden = true;emptyVideo.style.display='none';
    removeVideo.disabled = false;
  });
  removeVideo.addEventListener('click',()=>{
    video.pause();video.removeAttribute('src');video.load();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl='';videoInput.value='';
    video.hidden=true;emptyVideo.hidden=false;emptyVideo.style.display='flex';
    removeVideo.disabled=true;
  });
  if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe(canvas);
  else window.addEventListener('resize',resizeCanvas);
  window.CifteliaStudio = { start,stop,preview,manual,micEvent };
  requestAnimationFrame(()=>{resizeCanvas();preview();});
})();
