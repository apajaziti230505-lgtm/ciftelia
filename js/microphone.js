import { matchPitch } from './pitch.js';
export class MicrophoneRecorder {
    audio;
    stream = null;
    source = null;
    worklet = null;
    sink = null;
    highpass = null;
    baseAt = null;
    hits = [];
    recording = false;
    onHit = () => { };
    onMessage = () => { };
    constructor(audio) {
        this.audio = audio;
    }
    async start(options) {
        if (this.recording)
            return;
        if (!navigator.mediaDevices?.getUserMedia)
            throw new Error('Mikrofoni kërkon HTTPS ose localhost dhe leje nga Safari/Chrome.');
        const ctx = await this.audio.unlock();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: {
                channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
            }, video: false });
        try {
            if (!ctx.audioWorklet?.addModule)
                throw new Error('Ky shfletues nuk mbështet AudioWorklet. Provo Safari ose Chrome të përditësuar.');
            await ctx.audioWorklet.addModule('./js/mic-onset-worklet.js');
            this.stream = stream;
            this.source = ctx.createMediaStreamSource(stream);
            this.highpass = ctx.createBiquadFilter();
            this.highpass.type = 'highpass';
            this.highpass.Q.value = .707;
            this.setFilters(options);
            this.worklet = new AudioWorkletNode(ctx, 'ciftelia-onsets', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
            this.worklet.port.onmessage = e => {
                if (!this.recording || e.data?.type !== 'onset')
                    return;
                const { at, sampleRate, samples } = e.data;
                const result = matchPitch(samples, sampleRate);
                if (this.baseAt === null)
                    this.baseAt = at;
                const hit = { string: 1, noteNumber: result.noteNumber, time: Math.max(0, Math.round((at - this.baseAt) * 1000)), hz: result.hz, clarity: result.clarity };
                this.hits.push(hit);
                this.onHit(hit);
            };
            this.worklet.port.postMessage({ sensitivity: options.sensitivity });
            this.sink = ctx.createGain();
            this.sink.gain.value = 0; // never route microphone to speaker: prevents feedback
            this.source.connect(this.highpass).connect(this.worklet).connect(this.sink).connect(ctx.destination);
            this.baseAt = null;
            this.hits = [];
            this.recording = true;
        }
        catch (e) {
            stream.getTracks().forEach(t => t.stop());
            this.stream = null;
            throw e;
        }
    }
    setFilters(options) {
        if (this.highpass)
            this.highpass.frequency.value = options.lowCut ? 80 : 15;
    }
    setSensitivity(s) { this.worklet?.port.postMessage({ sensitivity: s }); }
    stop() {
        this.recording = false;
        this.worklet?.disconnect();
        this.worklet?.port.close();
        this.worklet = null;
        this.source?.disconnect();
        this.source = null;
        this.highpass?.disconnect();
        this.highpass = null;
        this.sink?.disconnect();
        this.sink = null;
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        return [...this.hits];
    }
}
