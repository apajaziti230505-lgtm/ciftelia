export class AudioEngine {
    context = null;
    buffers = new Map();
    downloads = new Map();
    sources = new Set();
    master = null;
    playbackStart = 0;
    finish = 0;
    active = false;
    warmupStarted = false;
    volume = 0.8;
    mode = 'short';
    get ctx() { return this.context; }
    get playing() { return this.active; }
    get elapsedMs() { return this.context && this.active ? Math.max(0, (this.context.currentTime - this.playbackStart) * 1000) : 0; }
    get endMs() { return Math.max(0, (this.finish - this.playbackStart) * 1000); }
    // Kërkohet me HTTPS ose localhost për mikrofonin; WAV mund të ngarkohet në të dyja.
    async prepare() {
        const variants = ['', '_shkurt'];
        const tasks = [];
        for (let n = 1; n <= 14; n++)
            for (const v of variants) {
                const key = `nota${n}${v}`;
                if (!this.downloads.has(key))
                    this.downloads.set(key, fetch(`assets/audio/${key}.m4a`).then(r => { if (!r.ok)
                        throw new Error(`${key}.m4a: HTTP ${r.status}`); return r.arrayBuffer(); }));
                tasks.push(this.downloads.get(key).catch(() => undefined));
            }
        await Promise.all(tasks);
    }
    async unlock() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
            this.master = this.context.createGain();
            this.master.gain.value = this.volume;
            this.master.connect(this.context.destination);
        }
        // Duhet të thirret direkt në veprimin e përdoruesit për Safari.
        if (this.context.state !== 'running')
            await this.context.resume();
        return this.context;
    }
    setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master)
        this.master.gain.value = this.volume; }
    async loadNote(noteNumber) {
        const ctx = await this.unlock();
        const order = this.mode === 'short' ? [`nota${noteNumber}_shkurt`, `nota${noteNumber}`] : [`nota${noteNumber}`, `nota${noteNumber}_shkurt`];
        for (const key of order) {
            if (this.buffers.has(key))
                return this.buffers.get(key);
            try {
                let task = this.downloads.get(key);
                if (!task) {
                    task = fetch(`assets/audio/${key}.m4a`).then(r => { if (!r.ok)
                        throw Error(`${r.status}`); return r.arrayBuffer(); });
                    this.downloads.set(key, task);
                }
                const arr = await task;
                const decoded = await ctx.decodeAudioData(arr.slice(0));
                this.buffers.set(key, decoded);
                return decoded;
            }
            catch (e) {
                console.warn(`Nuk u ngarkua ${key}`, e);
            }
        }
        throw new Error(`Mungon tingulli nota${noteNumber}.m4a. Kontrollo assets/audio.`);
    }
    async preload() { await Promise.all([...Array(14)].map((_, i) => this.loadNote(i + 1))); }
    makeSource(buffer, at) {
        const ctx = this.context, src = ctx.createBufferSource();
        src.buffer = buffer;
        const gain = ctx.createGain();
        const playDuration = Math.min(buffer.duration, this.mode === 'short' ? 0.49 : 1.76);
        gain.gain.setValueAtTime(0.92, at);
        gain.gain.setValueAtTime(0.92, at + Math.max(0, playDuration - 0.16));
        gain.gain.exponentialRampToValueAtTime(0.001, at + playDuration);
        src.connect(gain).connect(this.master);
        this.sources.add(src);
        src.onended = () => { this.sources.delete(src); src.disconnect(); gain.disconnect(); };
        src.start(at);
        src.stop(at + playDuration);
    }
    async hit(noteNumber) {
        // Nxjerr zë edhe kur nota përsëritet shpejt.
        await this.unlock();
        const buff = await this.loadNote(noteNumber);
        this.makeSource(buff, this.context.currentTime + 0.006);
        if (!this.warmupStarted) {
            this.warmupStarted = true;
            void this.preload().catch(() => { });
        }
    }
    stop() {
        this.active = false;
        for (const s of this.sources) {
            try {
                s.stop();
            }
            catch { }
        }
        this.sources.clear();
    }
    async play(song) {
        await this.unlock();
        this.stop();
        if (!song.notes.length)
            throw new Error('Kjo këngë nuk ka nota.');
        const unique = [...new Set(song.notes.map(n => n.noteNumber))];
        await Promise.all(unique.map(n => this.loadNote(n)));
        const ctx = this.context;
        this.playbackStart = ctx.currentTime + 0.080;
        for (const ev of song.notes) {
            const key = this.mode === 'short' ? `nota${ev.noteNumber}_shkurt` : `nota${ev.noteNumber}`;
            const b = this.buffers.get(key) || this.buffers.get(`nota${ev.noteNumber}`) || this.buffers.get(`nota${ev.noteNumber}_shkurt`);
            if (b)
                this.makeSource(b, this.playbackStart + ev.time / 1000);
        }
        this.active = true;
        this.finish = this.playbackStart + Math.max(...song.notes.map(n => n.time)) / 1000 + (this.mode === 'short' ? 0.55 : 1.8);
        return Math.round((this.finish - this.playbackStart) * 1000);
    }
    done() { if (this.active && this.context && this.context.currentTime >= this.finish) {
        this.active = false;
        return true;
    } return false; }
}
