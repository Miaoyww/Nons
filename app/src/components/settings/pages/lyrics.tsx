import { Button } from "@/components/ui/button";
import { defaultBackgroundSpeed, useLyricsSettings } from "@/hooks/use-lyrics-settings";
import { SettingsCard } from "../settings-card";

export function LyricsPage() {
  const { backgroundSpeed, setBackgroundSpeed } = useLyricsSettings();
  return <div className="flex flex-col gap-8">
    <div><h2 className="text-xl font-bold">歌词</h2><p className="mt-2 text-sm text-muted-foreground">调整全屏播放器的歌词背景。</p></div>
    <SettingsCard title="背景流速" description="调整封面背景的流动速度，即时生效并自动保存。设为 0 可停止流动；系统减少动态效果设置优先。">
      <div className="flex w-60 flex-col gap-2">
        <div className="flex items-center gap-3">
          <input type="range" className="music-range min-w-0 flex-1" aria-label="背景流速" min={0} max={4} step={0.1}
            value={backgroundSpeed} onChange={(event) => setBackgroundSpeed(Number(event.target.value))} />
          <output className="w-8 text-right text-sm tabular-nums" aria-label="当前背景流速">{backgroundSpeed.toFixed(1)}</output>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground"><span>静止</span><span>快</span></div>
        <Button variant="ghost" size="sm" className="self-end" onClick={() => setBackgroundSpeed(defaultBackgroundSpeed)}>恢复默认</Button>
      </div>
    </SettingsCard>
  </div>;
}
