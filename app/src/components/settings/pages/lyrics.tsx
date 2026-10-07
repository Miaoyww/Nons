import { Button } from "@/components/ui/button";
import { defaultBackgroundSpeed, useLyricsSettings } from "@/hooks/use-lyrics-settings";
import { useLyricSources } from "@/hooks/use-lyric-sources";
import { SettingsCard } from "../settings-card";

export function LyricsPage() {
  const { backgroundSpeed, setBackgroundSpeed } = useLyricsSettings();
  const { sources, ready, busy, error, setSources } = useLyricSources();
  return <div className="flex flex-col gap-8">
    <div><h2 className="text-xl font-bold">歌词</h2><p className="mt-2 text-sm text-muted-foreground">调整歌词显示与在线歌词来源。</p></div>
    <section aria-labelledby="lyrics-display-heading" className="flex flex-col gap-8">
    <h3 id="lyrics-display-heading" className="text-base font-semibold">歌词显示</h3>
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
    </section>
    <section aria-labelledby="lyrics-sources-heading" className="flex flex-col gap-8">
      <div><h3 id="lyrics-sources-heading" className="text-base font-semibold">歌词来源</h3><p className="mt-2 text-sm text-muted-foreground">依次尝试 AMLL DB、QQ 音乐、网易云音乐。关闭的来源会跳过；全部关闭后仅使用网易云音乐。本地歌词文件始终优先。</p></div>
      <SettingsCard title="AMLL DB" description="优先使用社区制作的 TTML 逐字歌词。未找到或无法加载时继续尝试下一来源。">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sources.amll} disabled={!ready || busy} onChange={(event) => void setSources({ ...sources, amll: event.target.checked })} />从 AMLL DB 获取歌词</label>
      </SettingsCard>
      <SettingsCard title="QQ 音乐" description="按歌名、歌手、专辑及歌曲时长匹配歌词；匹配度不足时使用网易云音乐。">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sources.qq} disabled={!ready || busy} onChange={(event) => void setSources({ ...sources, qq: event.target.checked })} />从 QQ 音乐获取歌词</label>
      </SettingsCard>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  </div>;
}
