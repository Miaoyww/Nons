import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { currentPosition, formatTime, getProgress, nativeCall, useProgress } from "@/lib/player";
import { PlayerSlider } from "@/features/playback/player-slider";

export function PlaybackTimeline({ onError, layout = "below", showTimeOnHover = false }: {
  onError: (error: unknown) => void;
  layout?: "below" | "inline" | "edge";
  showTimeOnHover?: boolean;
}) {
  const progress = useProgress();
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const slider = useRef<HTMLInputElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const duration = useRef<HTMLSpanElement>(null);
  const position = Math.min(drag ?? currentPosition(), Math.max(1, progress.durationMs));
  const labelsVisible = layout !== "edge" && !showTimeOnHover;
  const disabled = !isTauri() || !progress.durationMs || ["stopped", "error", "loading"].includes(progress.status);

  useEffect(() => {
    if (drag !== null || disabled) return;
    let frame = 0;
    function paint(now = performance.now()) {
      const input = slider.current;
      const live = getProgress();
      if (!input || document.visibilityState === "hidden" || live.revision !== progress.revision) return;
      const position = currentPosition(now);
      input.value = String(position);
      input.style.setProperty("--slider-progress", `${position / Math.max(1, live.durationMs) * 100}%`);
      const time = formatTime(position);
      const end = layout === "below" ? `-${formatTime(Math.max(0, live.durationMs - position))}` : formatTime(live.durationMs);
      if (elapsed.current && elapsed.current.textContent !== time) elapsed.current.textContent = time;
      if (duration.current && duration.current.textContent !== end) duration.current.textContent = end;
      const spoken = `${time} / ${formatTime(live.durationMs)}`;
      if (input.getAttribute("aria-valuetext") !== spoken) input.setAttribute("aria-valuetext", spoken);
      // Extrapolate only within the existing bounded playback clock. Late native
      // updates freeze the display instead of inventing continued playback.
      if (live.status === "playing" && now - live.receivedAt < 500) frame = requestAnimationFrame(paint);
    }
    function resume() { cancelAnimationFrame(frame); paint(); }
    paint();
    document.addEventListener("visibilitychange", resume);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", resume); };
  }, [progress, drag, disabled, layout]);

  function commit(value: number) {
    void nativeCall("player_seek", { positionMs: value }).catch(onError);
    setDrag(null);
  }

  return <div className={`playback-timeline playback-timeline-${layout} text-xs tabular-nums text-muted-foreground`}>
    {labelsVisible && <span ref={elapsed} className="timeline-elapsed">{formatTime(position)}</span>}
    <PlayerSlider ref={slider} aria-label="播放进度" min={0} max={Math.max(1, progress.durationMs)} step={1} value={position}
      aria-valuetext={`${formatTime(position)} / ${formatTime(progress.durationMs)}`} disabled={disabled}
      onPointerMove={showTimeOnHover ? (event) => { const rect = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * progress.durationMs); } : undefined}
      onPointerLeave={() => setHover(null)} onFocus={() => setFocused(true)}
      onChange={(event) => setDrag(Number(event.target.value))}
      onPointerUp={(event) => { if (drag !== null) commit(Number(event.currentTarget.value)); }}
      onPointerCancel={() => setDrag(null)} onBlur={() => { setDrag(null); setFocused(false); }}
      onKeyDown={(event) => {
        const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1000 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1000 : event.key === "PageDown" ? -10_000 : event.key === "PageUp" ? 10_000 : null;
        if (delta === null && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        setDrag(event.key === "Home" ? 0 : event.key === "End" ? progress.durationMs : Math.max(0, Math.min(progress.durationMs, Number(event.currentTarget.value) + (delta ?? 0))));
      }}
      onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key) && drag !== null) commit(Number(event.currentTarget.value)); }}
      className="timeline-slider" />
    {labelsVisible && <span ref={duration} className="timeline-duration">{layout === "below" ? `-${formatTime(Math.max(0, progress.durationMs - position))}` : formatTime(progress.durationMs)}</span>}
    {showTimeOnHover && (hover !== null || focused || drag !== null) && <span className="timeline-tooltip glass-surface" aria-hidden="true" style={{ left: `${Math.max(0, Math.min(100, (drag ?? hover ?? position) / Math.max(1, progress.durationMs) * 100))}%` }}>{formatTime(drag ?? hover ?? position)} / {formatTime(progress.durationMs)}</span>}
  </div>;
}
