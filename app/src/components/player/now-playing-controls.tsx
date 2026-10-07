import { FastForward, ListMusic, Pause, Play, Rewind, Volume1, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { nativeCall, usePlayer } from "@/lib/player";
import { ActionButton } from "./action-button";
import { QualitySelect } from "./music-options";
import { Timeline } from "./playback-bar";
import { PlayerSlider } from "./player-slider";

export function NowPlayingControls({ onQueue, onError }: { onQueue: () => void; onError: (error: unknown) => void }) {
  const state = usePlayer();
  const [volume, setVolume] = useState(state.volume);
  useEffect(() => setVolume(state.volume), [state.volume]);
  const playing = ["playing", "buffering", "loading"].includes(state.status);
  const disabled = !isTauri() || state.index === null;
  const action = (action: string) => void nativeCall("player_action", { action }).catch(onError);
  return <div className="now-playing-controls flex shrink-0 flex-col" aria-label="正在播放控制">
    <Timeline layout="below" onError={onError} />
    <div className="now-playing-transport flex items-center justify-center">
      <ActionButton variant="ghost" size="icon-lg" disabled={disabled} aria-label="上一首" onClick={() => action("previous")}><Rewind className="size-6 fill-current" aria-hidden="true" /></ActionButton>
      <ActionButton variant="ghost" size="icon-lg" className="now-playing-toggle" disabled={disabled} aria-label={playing ? "暂停" : "播放"} onClick={() => action(playing ? "pause" : "resume")}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</ActionButton>
      <ActionButton variant="ghost" size="icon-lg" disabled={disabled || (state.index ?? 0) + 1 >= state.queue.length} aria-label="下一首" onClick={() => action("next")}><FastForward className="size-6 fill-current" aria-hidden="true" /></ActionButton>
    </div>
    <div className="flex items-center gap-3">
      <Volume1 className="size-4 shrink-0" aria-hidden="true" />
      <PlayerSlider className="min-w-0 flex-1" aria-label="音量" min={0} max={1} step={0.01} value={volume} disabled={!isTauri()}
        onChange={(event) => { const value = Number(event.target.value); setVolume(value); void nativeCall("player_volume", { volume: value }).catch(onError); }} />
      <Volume2 className="size-5 shrink-0" aria-hidden="true" />
    </div>
    <div className="flex items-center justify-between gap-3"><QualitySelect /><ActionButton variant="ghost" size="icon" aria-label="显示播放队列" onClick={onQueue}><ListMusic aria-hidden="true" /></ActionButton></div>
  </div>;
}
