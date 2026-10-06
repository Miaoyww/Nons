import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { nativeCall, usePlayer } from "@/lib/player";
import { ActionButton } from "./action-button";

export function VolumeControl({ onError }: { onError: (error: unknown) => void }) {
  const state = usePlayer();
  const [volume, setVolume] = useState(state.volume);
  const previousVolume = useRef(state.volume > 0 ? state.volume : 0.8);
  const request = useRef(0);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setVolume(state.volume);
    if (state.volume > 0) previousVolume.current = state.volume;
  }, [state.volume]);
  function changeVolume(value: number) {
    if (value > 0) previousVolume.current = value;
    setVolume(value);
    const serial = ++request.current;
    void nativeCall("player_volume", { volume: value }).catch((error) => {
      if (serial === request.current) setVolume(state.volume);
      onError(error);
    });
  }
  return <div className="volume-control" data-dismissed={dismissed} onMouseEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); setDismissed(true); event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus(); setDismissed(true); }
  }}>
    <ActionButton variant="ghost" size="icon-lg" className="volume-button glass-surface" aria-label={volume === 0 ? "取消静音" : "静音"} aria-pressed={volume === 0} aria-describedby="playback-volume-value" disabled={!isTauri()} onClick={() => changeVolume(volume === 0 ? previousVolume.current : 0)}>
      {volume === 0 ? <VolumeX aria-hidden="true" /> : volume < 0.5 ? <Volume1 aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </ActionButton>
    <div className="volume-card-slot">
      <div className="volume-card glass-surface">
        <input type="range" aria-label="音量" aria-orientation="vertical" min={0} max={1} step={0.01} value={volume} disabled={!isTauri()} onChange={(event) => changeVolume(Number(event.target.value))}
          style={{ "--volume-progress": `${volume * 100}%` } as CSSProperties} className="music-range volume-range" />
        <output id="playback-volume-value" className="volume-percentage tabular-nums">{Math.round(volume * 100)}%</output>
      </div>
    </div>
  </div>;
}
