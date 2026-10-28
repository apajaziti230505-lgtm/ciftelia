"use strict";
// AudioWorklet: sinjalin e mikrofonit e analizon për goditje (transient).
// Koha e raportuar vjen nga currentFrame/sampleRate, jo nga rifreskimi i ekranit.
// OUTPUT = 0 (heshtje): nuk e luan mikrofonin në altoparlant.
class CifteliaOnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sensitivity = 5;
    this.fast = 0;
    this.slow = 0;
    this.previousFast = 0;
    this.noise = 0.002;
    this.lastOnset = -99;
    this.waitUntil = 0;
    this.primed = false;
    this.port.onmessage = e => {
      if (typeof e.data?.sensitivity === 'number') {
        this.sensitivity = Math.max(1, Math.min(10, e.data.sensitivity));
      }
    };
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const samples = inputs[0]?.[0];
    if (!samples || samples.length === 0) return true;
    let power = 0;
    for (let i = 0; i < samples.length; i++) power += samples[i] * samples[i];
    const rms = Math.sqrt(power / samples.length);
    // Audio block 128 @48k ≈2.7ms: fast=~8ms, slow=~65ms.
    this.fast = this.fast * .69 + rms * .31;
    this.slow = this.slow * .96 + rms * .04;
    const t = currentFrame / sampleRate;
    const floor = .033 - this.sensitivity * .0025;
    const dynamicThreshold = Math.max(floor, this.noise * 2.6);
    if (this.fast < Math.max(.02, dynamicThreshold * 1.3)) {
      this.noise = .993 * this.noise + .007 * this.fast;
    }
    // Ndër goditje, telat vazhdojnë të rezonojnë. Kërko rritje të shpejtë
    // për të njohur goditjen e re pa e kthyer tingullin e gjatë në shumë nota.
    const attack = this.fast > dynamicThreshold &&
      this.fast > this.slow * (1.40 - .025 * this.sensitivity) &&
      this.fast > this.previousFast * (1.11 - .008 * this.sensitivity) &&
      this.fast - this.previousFast > dynamicThreshold * .06;
    const silenceToSignal = !this.primed && this.fast > dynamicThreshold;
    if ((attack || silenceToSignal) && t - this.lastOnset >= .065) {
      this.lastOnset = t;
      this.primed = true;
      this.port.postMessage({ type: 'onset', audioTime: t });
    }
    if (this.fast < dynamicThreshold * .55) this.primed = false;
    this.previousFast = this.fast;
    return true;
  }
}
registerProcessor('ciftelia-onset', CifteliaOnsetProcessor);
