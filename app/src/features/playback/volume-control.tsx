import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { nativeCall, usePlayer } from "@/lib/player";
import { ActionButton } from "@/components/music/action-button";

export function VolumeControl({ onError }: { onError: (error: unknown) => void }) {
  const state = usePlayer();
  const [volume, setVolume] = useState(state.volume);
  const currentVolume = useRef(state.volume);
  const control = useRef<HTMLDivElement>(null);
  const previousVolume = useRef(state.volume > 0 ? state.volume : 0.8);
  const request = useRef(0);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    currentVolume.current = state.volume;
    setVolume(state.volume);
    if (state.volume > 0) previousVolume.current = state.volume;
  }, [state.volume]);
  function changeVolume(value: number) {
    currentVolume.current = value;
    if (value > 0) previousVolume.current = value;
    setVolume(value);
    const serial = ++request.current;
    void nativeCall("player_volume", { volume: value }).catch((error) => {
      if (serial === request.current) {
        currentVolume.current = state.volume;
        setVolume(state.volume);
      }
      onError(error);
    });
  }
  useEffect(() => {
    const element = control.current;
    if (!element || !isTauri()) return;
    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const value = Math.max(0, Math.min(1, Math.round((currentVolume.current + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
      if (value !== currentVolume.current) changeVolume(value);
    }
    // React wheel handlers are passive; a native listener can prevent page scrolling.
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  });
  return <div ref={control} className="volume-control" data-dismissed={dismissed} onMouseEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); setDismissed(true); event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus(); setDismissed(true); }
  }}>
    <ActionButton variant="ghost" size="icon-sm" className="volume-button" aria-label={volume === 0 ? "取消静音" : "静音"} aria-pressed={volume === 0} aria-describedby="playback-volume-value" disabled={!isTauri()} onClick={() => changeVolume(volume === 0 ? previousVolume.current : 0)}>
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
