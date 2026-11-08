import { upperFret, upperPlaybackRate, withOpenF } from './constants.js';
/** Sample-based instrument: 30 authentic attacks from the user's own instrument.
 * Lower frets use their own recordings. Upper frets reuse the open F recording
 * at the matching fret ratio; there is no artificial oscillator.
 */
export class AudioEngine {
    context = null;
    master = null;
    buffers = new Map();
    decoding = new Map();
    downloads = new Map();
    sources = new Set();
    lastByString = new Map();
    playbackStart = 0;
    finish = 0;
    active = false;
    generation = 0;
    volume = .8;
    upperEnabled = true;
    upperNoteNumber = 14;
    mode = 'short';
    strength = 'fort';
    get ctx() { return this.context; }
    get playing() { return this.active; }
    get elapsedMs() { return this.context && this.active ? Math.max(0, (this.context.currentTime - this.playbackStart) * 1000) : 0; }
    get endMs() { return Math.max(0, (this.finish - this.playbackStart) * 1000); }
    async unlock() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
            const master = this.context.createGain();
            master.gain.value = this.volume;
            // Gentle peak guard only; not a voice filter, noise gate, or pitch converter.
            const limiter = this.context.createDynamicsCompressor();
            limiter.threshold.value = -3;
            limiter.knee.value = 3;
            limiter.ratio.value = 12;
            limiter.attack.value = .003;
            limiter.release.value = .14;
            master.connect(limiter).connect(this.context.destination);
            this.master = master;
        }
        if (this.context.state !== 'running')
            await this.context.resume();
        return this.context;
    }
    setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master)
        this.master.gain.value = this.volume; }
    request(key, url) {
        let job = this.downloads.get(key);
        if (!job) {
            job = fetch(url).then(r => { if (!r.ok)
                throw Error(`${url}: HTTP ${r.status}`); return r.arrayBuffer(); });
            this.downloads.set(key, job);
        }
        return job;
    }
    async decode(key, url) {
        const cached = this.buffers.get(key);
        if (cached)
            return cached;
        let task = this.decoding.get(key);
        if (task)
            return task;
        task = (async () => {
            const ctx = await this.unlock();
            const arr = await this.request(key, url);
            // Some Safari versions detach the ArrayBuffer passed to decodeAudioData.
            const decoded = await ctx.decodeAudioData(arr.slice(0));
            this.buffers.set(key, decoded);
            return decoded;
        })();
        this.decoding.set(key, task);
        try {
            return await task;
        }
        catch (e) {
            this.decoding.delete(key);
            this.downloads.delete(key);
            throw e;
        }
    }
    key(n, strength) { return `nota${n}_${strength}`; }
    async loadNote(n, strength = this.strength) {
        if (!Number.isInteger(n) || n < 1 || n > 15)
            throw Error('Numri i notës nuk është i vlefshëm.');
        const key = this.key(n, strength);
        try {
            return await this.decode(key, `./assets/audio-real/${key}.m4a`);
        }
        catch (e) {
            // Old samples remain as a last-resort compatibility fallback for 1-14.
            if (n === 15)
                throw Error('Mungon regjistrimi real i telit poshtë 293 Hz.');
            const old = `nota${n}${this.mode === 'short' ? '_shkurt' : ''}`;
            console.warn('Regjistrimi i ri nuk u ngarkua, po përdoret rezervë:', key, e);
            return this.decode(old, `./assets/audio/${old}.m4a`);
        }
    }
    /** Start downloads without unlocking audio. All 30 recordings can be used offline after being loaded once. */
    async prepare() {
        const keys = Array.from({ length: 15 }, (_, i) => i + 1).flatMap(n => [this.key(n, 'fort'), this.key(n, 'lehte')]);
        // Limit concurrent network work, especially on mobile.
        let index = 0;
        const worker = async () => { while (index < keys.length) {
            const key = keys[index++];
            try {
                await this.request(key, `./assets/audio-real/${key}.m4a`);
            }
            catch { }
        } };
        await Promise.all(Array.from({ length: 4 }, worker));
    }
    async preload() { await Promise.all(Array.from({ length: 15 }, (_, i) => this.loadNote(i + 1, this.strength))); }
    schedule(buffer, at, string, level, rate = 1) {
        const ctx = this.context;
        const previous = this.lastByString.get(string);
        if (previous && at < previous.end && at >= previous.at) {
            // Actual string is damped by the next pluck; avoids muddy overlaps.
            const release = .07;
            previous.gain.gain.cancelScheduledValues(at);
            previous.gain.gain.setValueAtTime(previous.level, at);
            previous.gain.gain.linearRampToValueAtTime(.0001, at + release);
            try {
                previous.source.stop(at + release + .01);
            }
            catch { }
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        if (rate !== 1)
            src.playbackRate.value = rate;
        const gain = ctx.createGain();
        const realDuration = buffer.duration / rate;
        const duration = Math.min(realDuration, this.mode === 'short' ? 1.45 : realDuration);
        const end = at + duration;
        const fade = Math.min(.14, duration * .17);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(level, at + .003);
        gain.gain.setValueAtTime(level, Math.max(at + .004, end - fade));
        gain.gain.linearRampToValueAtTime(.0001, end);
        src.connect(gain).connect(this.master);
        const voice = { source: src, gain, at, end, level, string };
        this.lastByString.set(string, voice);
        this.sources.add(src);
        src.onended = () => { this.sources.delete(src); if (this.lastByString.get(string) === voice)
            this.lastByString.delete(string); try {
            src.disconnect();
            gain.disconnect();
        }
        catch { } };
        src.start(at);
        src.stop(end + .01);
        return duration;
    }
    async hit(noteNumber, string = noteNumber === 14 ? 2 : 1, withF = true, upperNoteNumber = this.upperNoteNumber) {
        const events = withOpenF([{ noteNumber, string, time: 0, withF, upperNoteNumber: upperFret(upperNoteNumber) }], this.upperEnabled);
        if (!events.length)
            return;
        const generation = this.generation;
        await this.unlock();
        const types = events.map((e, i) => e.string === 2 && i > 0 ? 'lehte' : this.strength);
        const buffers = await Promise.all(events.map((e, i) => this.loadNote(e.string === 2 ? 14 : e.noteNumber, types[i])));
        if (generation !== this.generation)
            return;
        const at = this.context.currentTime + .014;
        events.forEach((e, i) => {
            const base = e.string === 2 ? (events.length === 1 ? .76 : .49) : .9;
            const level = base * (types[i] === 'lehte' ? .82 : 1);
            this.schedule(buffers[i], at, e.string, level, e.string === 2 ? upperPlaybackRate(e.noteNumber) : 1);
        });
    }
    stop() {
        this.generation++;
        this.active = false;
        for (const s of this.sources) {
            try {
                s.stop();
            }
            catch { }
        }
        this.sources.clear();
        this.lastByString.clear();
    }
    async play(song, tempo = 1) {
        this.stop();
        const generation = this.generation;
        await this.unlock();
        if (generation !== this.generation)
            return 0;
        if (!song.notes.length)
            throw Error('Kënga nuk ka nota.');
        if (!Number.isFinite(tempo) || tempo <= 0)
            throw Error('Shpejtësi e pavlefshme.');
        const events = withOpenF(song.notes, this.upperEnabled).sort((a, b) => a.time - b.time || a.string - b.string);
        if (!events.length)
            throw Error('Nuk ka nota për telin poshtë në këtë pjesë.');
        const sampleNumber = (e) => e.string === 2 ? 14 : e.noteNumber;
        const strengthFor = (e) => e.velocity !== undefined ? (e.velocity < .56 ? 'lehte' : 'fort') : (e.string === 2 ? 'lehte' : this.strength);
        const keys = new Map();
        for (const e of events) {
            const strength = strengthFor(e);
            const n = sampleNumber(e);
            keys.set(this.key(n, strength), { n, strength });
        }
        const loaded = new Map();
        await Promise.all([...keys.entries()].map(async ([key, v]) => loaded.set(key, await this.loadNote(v.n, v.strength))));
        if (generation !== this.generation)
            return 0;
        const ctx = this.context;
        this.playbackStart = ctx.currentTime + .10;
        let finish = this.playbackStart;
        for (const e of events) {
            const strength = strengthFor(e);
            const buffer = loaded.get(this.key(sampleNumber(e), strength));
            if (!buffer)
                continue;
            const at = this.playbackStart + e.time / (1000 * tempo);
            const base = e.string === 2 ? .48 : .9;
            const level = base * (strength === 'lehte' ? .82 : 1);
            const duration = this.schedule(buffer, at, e.string, level, e.string === 2 ? upperPlaybackRate(e.noteNumber) : 1);
            finish = Math.max(finish, at + duration);
        }
        this.finish = finish;
        this.active = true;
        return Math.round((finish - this.playbackStart) * 1000);
    }
    done() { if (this.active && this.context && this.context.currentTime >= this.finish) {
        this.active = false;
        return true;
    } return false; }
}
