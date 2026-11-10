// Test recording: the last 2 minutes of microphone audio and what the app
// heard and decided, kept in memory only. Saved to files only when asked
// (Settings -> Save test recording), so a problem can be replayed exactly.

const SR = 16000;
const SECONDS = 120;

export class TestRecorder {
  constructor() {
    this.audio = new Float32Array(SR * SECONDS);
    this.filled = 0;
    this.log = [];
    this.t0 = performance.now();
  }

  addAudio(chunk) {
    const a = this.audio, n = chunk.length;
    if (n >= a.length) a.set(chunk.subarray(n - a.length));
    else { a.copyWithin(0, n); a.set(chunk, a.length - n); }
    this.filled = Math.min(a.length, this.filled + n);
  }

  addUpdate(m) {
    this.log.push({
      t: +((performance.now() - this.t0) / 1000).toFixed(2),
      heard: m.heard || '',
      ayah: m.ayah ? `${m.ayah.surah}:${m.ayah.ayah}` : null,
      letter: m.letter,
      state: m.state,
      level: m.level ? +m.level.toFixed(4) : 0,
      ms: m.ms,
    });
    const cutoff = (performance.now() - this.t0) / 1000 - SECONDS;
    while (this.log.length && this.log[0].t < cutoff) this.log.shift();
  }

  save() {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const pcm = this.audio.subarray(this.audio.length - this.filled);
    download(`samia-test-${stamp}.wav`, wav(pcm));
    download(`samia-test-${stamp}.json`, new Blob([JSON.stringify({
      app: "Sami'a", saved: new Date().toISOString(), seconds: +(pcm.length / SR).toFixed(1),
      note: 'Audio and log from the last 2 minutes. t = seconds since the app opened.',
      log: this.log,
    }, null, 1)], { type: 'application/json' }));
  }
}

function wav(samples) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
