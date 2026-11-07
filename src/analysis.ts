/** Offline audio-to-tablature assistant. This estimates, never certifies, played notes.
 * It works locally in the browser; no recording is uploaded to any service.
 */
export interface GuessedHit {
  time: number;
  noteNumber: number | null;
  string: 1 | 2;
  confidence: number;
  detail: string;
  withF?: boolean;
}
export interface AnalysisReport {
  hits: GuessedHit[];
  durationMs: number;
  uncertainCount: number;
  detectedOnsets: number;
}
const FS = 16000;
const HOP = 160;    // 10 ms timing grid
const N = 2048;     // 7.8 Hz bin spacing at 16 kHz
const START_BIN = 21;
const END_BIN = 441; // ~3.45 kHz
const COUNT = END_BIN - START_BIN;
const REF_NOTES = 15;
const MAX_SECONDS = 150;
const FAST_N=512;
const fastWindow=new Float32Array(FAST_N);
for(let i=0;i<FAST_N;i++)fastWindow[i]=.5-.5*Math.cos(2*Math.PI*i/(FAST_N-1));
const wav = new Float32Array(N);
for (let i = 0; i < N; i++) wav[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (N - 1));

function monoResample(buffer: AudioBuffer): Float32Array {
  const n = Math.min(Math.ceil(buffer.duration * FS), MAX_SECONDS * FS);
  const out = new Float32Array(n);
  const channels = Math.min(2, buffer.numberOfChannels);
  const c1 = buffer.getChannelData(0);
  const c2 = channels > 1 ? buffer.getChannelData(1) : c1;
  for (let i = 0; i < n; i++) {
    const pos = i * buffer.sampleRate / FS;
    const a = Math.floor(pos);
    const frac = pos - a;
    out[i] = (c1[a] * (1 - frac) + (c1[a + 1] ?? c1[a]) * frac +
      c2[a] * (1 - frac) + (c2[a + 1] ?? c2[a]) * frac) * .5;
  }
  return out;
}

/** In-place radix-2 FFT, returning magnitudes in our fixed frequency band. */
function spectrum(data: Float32Array, start: number): Float32Array {
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let i = 0; i < N; i++) real[i] = (data[start + i] ?? 0) * wav[i];
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      const r = real[i]; real[i] = real[j]; real[j] = r;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const even = i + k, odd = even + len / 2;
        const a = wr * real[odd] - wi * imag[odd];
        const b = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - a;
        imag[odd] = imag[even] - b;
        real[even] += a;
        imag[even] += b;
        const nextR = wr * c - wi * s;
        wi = wr * s + wi * c;
        wr = nextR;
      }
    }
  }
  const out = new Float32Array(COUNT);
  for (let i = START_BIN; i < END_BIN; i++) {
    const power = Math.hypot(real[i], imag[i]);
    out[i - START_BIN] = Math.sqrt(power);
  }
  return out;
}
function onsetSpectrum(data:Float32Array,start:number):Float32Array{
  const n=FAST_N,re=new Float32Array(n),im=new Float32Array(n);
  for(let i=0;i<n;i++)re[i]=(data[start+i]||0)*fastWindow[i];
  let j=0;for(let i=1;i<n;i++){let bit=n>>1;while(j&bit){j^=bit;bit>>=1;}j^=bit;if(i<j){const q=re[i];re[i]=re[j];re[j]=q;}}
  for(let len=2;len<=n;len<<=1){const angle=-2*Math.PI/len,c=Math.cos(angle),s=Math.sin(angle);for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let k=0;k<len/2;k++){const a=i+k,b=a+len/2;const u=wr*re[b]-wi*im[b],v=wr*im[b]+wi*re[b];re[b]=re[a]-u;im[b]=im[a]-v;re[a]+=u;im[a]+=v;const r=wr*c-wi*s;wi=wr*s+wi*c;wr=r;}}}
  const out=new Float32Array(n/2);
  for(let i=0;i<out.length;i++)out[i]=Math.hypot(re[i],im[i]);
  return out;
}
function norm(v: Float32Array): Float32Array {
  let s = 1e-12;
  for (let i = 0; i < v.length; i++) s += v[i] ** 2;
  const l = Math.sqrt(s);
  for (let i = 0; i < v.length; i++) v[i] /= l;
  return v;
}
function dot(a: Float32Array, b: Float32Array): number {
  let v = 0;
  for (let i = 0; i < a.length; i++) v += a[i] * b[i];
  return v;
}
function average(data: Float32Array, starts: number[]): Float32Array {
  const combined = new Float32Array(COUNT);
  let count = 0;
  for (const start of starts) {
    if (start < 0 || start + N > data.length) continue;
    const s = norm(spectrum(data, start));
    for (let i = 0; i < COUNT; i++) combined[i] += s[i];
    count++;
  }
  return count ? norm(combined) : combined;
}

/** Energy + transient detection, retaining ambiguous attacks for manual correction. */
export function detectOnsets(data: Float32Array): number[] {
  const total = Math.floor((data.length - FAST_N) / HOP);
  if (total <= 0) return [];
  const env = new Float32Array(total);
  const novelty = new Float32Array(total);
  let peakEnv = 0;
  let prevSpec: Float32Array | null = null;
  for (let i = 0; i < total; i++) {
    const start = i * HOP;
    let energy = 0;
    for (let k = 0; k < HOP; k++) energy += data[start + k] ** 2;
    const amp = Math.sqrt(energy / HOP);
    env[i] = amp;
    peakEnv = Math.max(peakEnv, amp);
    // Short-window difference isolates a fresh pluck, even while the old string rings.
    if (i % 2 === 0) {
      const sp = onsetSpectrum(data, start);
      if (prevSpec) {
        let up = 0, totalEnergy = .0001;
        for (let k = 12; k < sp.length; k++) {
          up += Math.max(0, sp[k] - prevSpec[k]);
          totalEnergy += sp[k];
        }
        novelty[i] = up / totalEnergy;
      }
      prevSpec = sp;
    } else novelty[i] = novelty[i - 1] * .85;
  }
  const out: number[] = [];
  let last = -16;
  const validEnv = Math.max(.002, peakEnv * .075);
  for (let i = 5; i < total - 5; i++) {
    if (env[i] < validEnv || i - last < 9) continue;
    const prev = (env[i - 1] + env[i - 2] + env[i - 3] + env[i - 4]) / 4;
    const envelopeRise = Math.max(0, (env[i] - prev) / Math.max(env[i], .001));
    const score = .7 * novelty[i] + .3 * envelopeRise;
    if (score < .20 || novelty[i] < novelty[i-2] || novelty[i] < novelty[i+2]) continue;
    // Work backwards toward the leading edge; onset window is centred at a transient.
    let j = i;
    while (j > 0 && j > i - 5 && env[j - 1] > env[i] * .20 && env[j - 1] < env[j] * 1.05) j--;
    if (j - last < 9) continue;
    out.push(j * HOP);
    last = j;
    if (out.length >= 800) break;
    i += 7;
  }
  // A second, amplitude-based onset pass handles soft plucks or near-sinusoidal
  // signals whose spectral flux is too weak to pass the first detector.
  // Guard with a rise against prior energy to avoid mistaking a ringing tail
  // for another picked note. Time is still the original PCM sample position.
  const energyCandidates: {frame:number; rise:number}[] = [];
  const minEnergyRise = Math.max(.0035, peakEnv * .095);
  for (let i = 5; i < total-4; i++) {
    const before = (env[i-5]+env[i-4]+env[i-3]) / 3;
    const after = (env[i]+env[i+1]+env[i+2]) / 3;
    const absolute = after-before;
    const relative = absolute / Math.max(after, .005);
    if (after > validEnv && absolute > minEnergyRise && relative > .24)
      energyCandidates.push({frame:i,rise:absolute});
  }
  // Keep the earliest edge of each local attack cluster; if many adjacent
  // frames pass, they are one pluck, not repeated notes.
  const fallback: number[] = [];
  let clusterEnd = -1;
  for (const candidate of energyCandidates) {
    if (candidate.frame > clusterEnd + 3) {
      fallback.push(candidate.frame * HOP);
    }
    clusterEnd = candidate.frame;
  }
  // Combine spectral and energy detections; merge duplicate markers that
  // represent the same transient, but keep genuine fast repetitions >=90 ms.
  const merged = [...out, ...fallback].sort((a,b)=>a-b);
  const distinct: number[] = [];
  for (const at of merged) {
    if (!distinct.length || at-distinct[distinct.length-1] >= Math.round(.09*FS)) distinct.push(at);
    else if (at < distinct[distinct.length-1]) distinct[distinct.length-1] = at;
  }
  // A recording that starts with a pluck has no earlier transient.
  if (env[0] > validEnv*2 && (distinct.length===0 || distinct[0] > Math.round(.15*FS))) distinct.unshift(0);
  return distinct.slice(0,800);
}

export type ProgressCallback = (message: string, pct: number) => void;
export type DecodedReference = (noteNumber: number, intensity: 'fort'|'lehte') => Promise<AudioBuffer>;

export async function analyzeAudio(original: AudioBuffer, reference: DecodedReference, progress: ProgressCallback = ()=>{}): Promise<AnalysisReport> {
  if (original.duration > MAX_SECONDS) throw new Error(`Kënga është tepër e gjatë. Maksimumi ${MAX_SECONDS} sekonda për një analizë.`);
  progress('Po përgatis regjistrimin...', 2);
  const data = monoResample(original);
  const starts = detectOnsets(data);
  if (!starts.length) return {hits:[], durationMs:Math.round(original.duration*1000), uncertainCount:0, detectedOnsets:0};
  progress('Po përgatis referencat e çiftelisë...', 12);
  const templates: Float32Array[] = [];
  for (let note = 1; note <= REF_NOTES; note++) {
    const merged = new Float32Array(COUNT);
    let count = 0;
    for (const intensity of ['fort', 'lehte'] as const) {
      try {
        const r = monoResample(await reference(note, intensity));
        // Samples are trimmed to the beginning of their attack by our sample library.
        const feature = average(r, [Math.round(.028*FS), Math.round(.075*FS)]);
        if (dot(feature, feature) < .02) continue;
        for (let k=0;k<COUNT;k++) merged[k] += feature[k];
        count++;
      } catch { /* one intensity may be absent on older versions */ }
    }
    if (!count) throw new Error(`Mungon referenca audio e notës ${note}.`);
    templates.push(norm(merged));
    if (note % 3 === 0) {progress(`Referencat: ${note}/15`, 12+note*2); await new Promise<void>(resolve=>setTimeout(resolve,0));}
  }
  const f = templates[13]; // 220 Hz: accompaniment, note 14
  const duo: Float32Array[] = templates.map((t,n) => {
    if (n===13) return t;
    const mixed = new Float32Array(COUNT);
    for(let k=0;k<COUNT;k++) mixed[k] = t[k] + .62 * f[k];
    return norm(mixed);
  });
  const hits: GuessedHit[] = [];
  for (let i = 0; i < starts.length; i++) {
    const at = starts[i];
    const next = starts[i+1] ?? data.length;
    const pos = Math.min(at + Math.round(.032*FS), Math.max(0,next-N));
    const current = average(data, [pos, pos + Math.round(.012*FS)]);
    // Remove the harmonic tail of the previous pluck before matching new attacks.
    const before = at > N/2 ? average(data,[Math.max(0,at-N-Math.round(.020*FS))]) : new Float32Array(COUNT);
    const fresh = new Float32Array(COUNT);
    for(let k=0;k<COUNT;k++)fresh[k]=Math.max(0,current[k]-.62*before[k]);
    const sampled = norm(fresh);
    let primary = -1, primaryScore = -1, runnerUp = -1;
    for (let n=0;n<REF_NOTES;n++) {
      const score=dot(sampled,templates[n]);
      if (score > primaryScore){ runnerUp=primaryScore; primaryScore=score; primary=n; }
      else runnerUp=Math.max(runnerUp,score);
    }
    let pair=-1, pairScore=-1;
    for(let n=0;n<REF_NOTES;n++) {
      if(n===13)continue;
      const score=dot(sampled,duo[n]);
      if(score>pairScore){ pairScore=score; pair=n; }
    }
    const withF = pairScore > primaryScore + .055 && pairScore > .68 && pair >= 0;
    const score = withF ? pairScore : primaryScore;
    const gap = withF ? pairScore-primaryScore : primaryScore-runnerUp;
    // Conservative confidence. The user decides low-confidence notes.
    const certainty = Math.max(0,Math.min(1, .48*score + 1.6*Math.max(0,gap)));
    const certain = score >= .72 && (withF ? pairScore-primaryScore>.075 : gap > .035);
    const time=Math.max(0,Math.round(at*1000/FS));
    if (!certain) hits.push({time,noteNumber:null,string:1,confidence:certainty,detail:`E pasigurt (${score.toFixed(2)})`});
    else {
      hits.push({time,noteNumber:withF?pair+1:primary+1,string:withF||primary!==13?1:2,confidence:certainty,detail:withF?'Dy tela të mundshëm':'Një tel i mundshëm'});
      if(withF)hits.push({time,noteNumber:14,string:2,confidence:certainty,detail:'Shoqërim 220 Hz i mundshëm'});
    }
    if (i % 12 === 0){progress(`Po analizohen goditjet ${i+1}/${starts.length}`,44+Math.round(i/starts.length*55));await new Promise<void>(resolve=>setTimeout(resolve,0));}
  }
  progress('Analiza përfundoi. Kontrollo notat para ruajtjes.',100);
  return {hits,durationMs:Math.round(original.duration*1000),uncertainCount:hits.filter(x=>x.noteNumber===null).length,detectedOnsets:starts.length};
}
