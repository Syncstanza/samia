"""Compare src/engine/fbank.js with kaldi-native-fbank (what sherpa-onnx uses).
    pip install kaldi-native-fbank numpy
    python tools/check-fbank.py
"""
import json, subprocess, sys, os
import numpy as np
import kaldi_native_fbank as knf

rng = np.random.default_rng(0)
t = np.arange(16000 * 2) / 16000
wave = (0.3 * np.sin(2 * np.pi * 220 * t) + 0.1 * np.sin(2 * np.pi * 1700 * t) + 0.05 * rng.standard_normal(t.size)).astype(np.float32)

opts = knf.FbankOptions()
opts.frame_opts.dither = 0
opts.frame_opts.snip_edges = False
opts.mel_opts.num_bins = 80
opts.mel_opts.high_freq = -400
fb = knf.OnlineFbank(opts)
fb.accept_waveform(16000, wave.tolist())
fb.input_finished()
ref = np.array([fb.get_frame(i) for i in range(fb.num_frames_ready)])

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
js = subprocess.run(["node", "-e", """
import('./src/engine/fbank.js').then(m => {
  const w = Float32Array.from(JSON.parse(require('fs').readFileSync(0, 'utf8')));
  const r = m.fbank(w);
  process.stdout.write(JSON.stringify({frames: r.frames, data: Array.from(r.data)}));
});"""], input=json.dumps(wave.tolist()), capture_output=True, text=True, cwd=root, check=True)
out = json.loads(js.stdout)
mine = np.array(out["data"]).reshape(out["frames"], 80)
n = min(len(ref), len(mine))
print("frames kaldi", len(ref), "js", len(mine))
diff = np.abs(ref[:n] - mine[:n])
print("max abs diff", diff.max(), "mean", diff.mean())
sys.exit(0 if len(ref) == len(mine) and diff.max() < 1e-2 else 1)
