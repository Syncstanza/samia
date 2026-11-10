// Microphone / line-in capture at 16 kHz. Sends ~100 ms chunks to onChunk.
// Browser audio processing (echo cancel, noise suppression, auto gain) is off
// by default: it distorts recitation and fights the mixer's own levels.

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1600); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('tap', Tap);`;

export function micError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone blocked. Windows: Settings → Privacy & security → Microphone → turn on "Let desktop apps access your microphone".';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found (or the chosen one was unplugged). Pick another in Settings.';
  if (name === 'NotReadableError') return 'The microphone is busy in another app, or Windows can\'t open it.';
  return `Microphone problem: ${e && e.message || e}`;
}

export async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export async function startCapture({ deviceId, cleanup = false } = {}, onChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: cleanup,
      noiseSuppression: cleanup,
      autoGainControl: cleanup,
    },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  if (ctx.state === 'suspended') await ctx.resume();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, 'tap');
  tap.port.onmessage = (e) => onChunk(e.data);
  src.connect(tap);
  return {
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
    label: stream.getAudioTracks()[0]?.label || 'Microphone',
    deviceId: stream.getAudioTracks()[0]?.getSettings().deviceId || '',
  };
}
