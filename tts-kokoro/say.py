"""把一段文本用 Kokoro-82M（ONNX, CPU）合成成 wav。
用法：python say.py <in.txt> <out.wav> <voice> <speed>
"""
import os
import sys
import wave

import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

text_path, out_path = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else "zf_xiaobei"
speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0

with open(text_path, "r", encoding="utf-8") as fh:
    text = fh.read().strip()

from misaki import zh  # noqa: E402
from kokoro_onnx import Kokoro  # noqa: E402

g2p = zh.ZHG2P()
phonemes, _tokens = g2p(text)

k = Kokoro(os.path.join(ROOT, "model_quantized.onnx"), os.path.join(ROOT, "voices.npz"))
audio, sr = k.create(phonemes, voice=voice, speed=speed, is_phonemes=True)

pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
with wave.open(out_path, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes(pcm.tobytes())

print(f"ok {len(audio) / sr:.2f}s sr={sr}")
