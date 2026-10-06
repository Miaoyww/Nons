"""Generate quiet synthetic audio; no copyrighted recordings or downloads."""
import math
import struct
import wave
from pathlib import Path

root = Path(__file__).resolve().parent.parent / ".local" / "fixtures"
root.mkdir(parents=True, exist_ok=True)
for number in (1, 2):
    path = root / f"Boundary {number}.wav"
    with wave.open(str(path), "wb") as output:
        output.setparams((2, 2, 48000, 0, "NONE", "not compressed"))
        frames = bytearray()
        for frame in range(48000 * 15):
            value = int(100 * math.sin(2 * math.pi * 220 * (frame + (number - 1) * 48000 * 15) / 48000))
            frames.extend(struct.pack("<hh", value, value))
        output.writeframes(frames)
    path.with_suffix(".lrc").write_text("[00:00.00]原生音频与歌词验证\n[00:05.00]同步播放时间线\n[00:10.00]连续曲目边界\n", encoding="utf-8")
print(root)
