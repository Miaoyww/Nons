import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocalPreferences } from "@/hooks/use-local-preferences";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshCw } from "lucide-react";
import { nativeCall, errorText } from "@/lib/player";
import { useLocalOptions } from "@/hooks/use-local-options";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "../settings-card";
import { FolderManager } from "../folder-manager";

interface CacheOptions { enabled: boolean; maxMb: number; directory: string }
interface CacheStatus { options: CacheOptions; usedBytes: number; entries: number }
export function LocalCachePage() {
  const [status, setStatus] = useState<CacheStatus>();
  const [limit, setLimit] = useState("64");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const { options: localPreferences, setOptions: setLocalPreferences } = useLocalPreferences();
  const [separators, setSeparators] = useState("");
  useEffect(() => setSeparators(localPreferences.artistSeparators.join("\n")), [localPreferences]);
  const { showCovers, setShowCovers } = useLocalOptions();
  const desktop = isTauri();
  async function reload() {
    if (!desktop) return;
    const value = await nativeCall<CacheStatus>("local_cache_status"); setStatus(value); setLimit(String(value.options.maxMb));
  }
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void nativeCall<CacheStatus>("local_cache_status").then((value) => { if (!disposed) { setStatus(value); setLimit(String(value.options.maxMb)); } }).catch((cause) => { if (!disposed) setError(errorText(cause)); });
    return () => { disposed = true; };
  }, [desktop]);
  async function perform(action: () => Promise<unknown>, message?: string) {
    if (busy) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try { await action(); await reload(); if (message) setNotice(message); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const options = status?.options;
  const disabled = busy || !desktop || !options;
  return <div className="flex flex-col gap-8">
    <div><h2 className="text-xl font-bold">本地与缓存</h2><p className="mt-2 text-sm text-muted-foreground">管理本地音乐与歌词缓存。</p></div>
    <section aria-labelledby="local-heading" className="flex flex-col gap-8">
      <h3 id="local-heading" className="text-base font-semibold">本地歌曲</h3>
      <SettingsCard title="显示本地歌曲封面" description="显示内嵌封面，关闭可减少图片加载。"><label className="flex items-center gap-2 text-sm"><Switch checked={showCovers} disabled={busy || !desktop} onCheckedChange={(checked) => void perform(() => setShowCovers(checked))} />显示内嵌封面</label></SettingsCard>
      <SettingsCard title="本地歌曲歌词来源" description="优先来源没有歌词、读取失败或格式不可用时，自动尝试另一来源。在线按已有歌词来源设置获取。">
        <Select value={localPreferences.lyricPriority} disabled={busy || !desktop} onValueChange={value => { if (value) void perform(() => setLocalPreferences({ ...localPreferences, lyricPriority: value as "local" | "online" })); }}><SelectTrigger aria-label="本地歌曲歌词优先来源"><SelectValue>{localPreferences.lyricPriority === "local" ? "优先本地歌词" : "优先在线歌词"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="local">优先本地歌词</SelectItem><SelectItem value="online">优先在线歌词</SelectItem></SelectContent></Select>
      </SettingsCard>
      <SettingsCard title="艺术家分隔符" description="每行输入一个分隔符；留空视为一位艺术家。保存后重新整理艺术家，不修改原始标签。">
        <form className="flex flex-col gap-2" onSubmit={event => { event.preventDefault(); const artistSeparators = [...new Set(separators.split("\n").map(value => value.trim()).filter(Boolean))]; void perform(() => setLocalPreferences({ ...localPreferences, artistSeparators }), "艺术家分隔符已保存。"); }}>
          <textarea className="music-input min-h-24" aria-label="艺术家分隔符（每行一个）" value={separators} disabled={busy || !desktop} onChange={event => setSeparators(event.target.value)} />
          <Button variant="outline" size="sm" disabled={busy || !desktop || separators === localPreferences.artistSeparators.join("\n")}>保存</Button>
        </form>
      </SettingsCard>
      <SettingsCard title="音乐文件夹" description="管理音乐文件夹，自动扫描变更。"><FolderManager /></SettingsCard>
    </section>
    <section aria-labelledby="cache-heading" className="flex flex-col gap-8">
      <h3 id="cache-heading" className="text-base font-semibold">缓存配置</h3>
      <SettingsCard title="启用本地缓存" description="保存 TTML 歌词，加快加载并支持离线读取。"><label className="flex items-center gap-2 text-sm"><Switch checked={options?.enabled ?? true} disabled={disabled} onCheckedChange={(checked) => { const enabled = checked; void perform(() => nativeCall("set_local_cache_options", { options: { ...options, enabled } })); }} />保存歌词缓存</label></SettingsCard>
      <SettingsCard title="缓存大小上限" description="范围 1–4096 MB，超出时清理最久未使用的歌词。">
        <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); const maxMb = Number(limit); if (!Number.isInteger(maxMb) || maxMb < 1 || maxMb > 4096) { setError("请输入 1–4096 之间的整数容量。"); return; } void perform(() => nativeCall("set_local_cache_options", { options: { ...options, maxMb } }), "缓存上限已保存。"); }}>
          <input type="number" min={1} max={4096} step={1} aria-label="缓存大小上限（MB）" className="music-input w-24" disabled={disabled} value={limit} onChange={(event) => setLimit(event.target.value)} /><span className="text-sm text-muted-foreground">MB</span><Button variant="outline" size="sm" disabled={disabled || Number(limit) === options?.maxMb}>保存</Button>
        </form>
      </SettingsCard>
      <SettingsCard title="缓存目录" description={options ? `${options.directory}${options.directory.endsWith("/") || options.directory.endsWith("\\") ? "" : "/"}nons-cache-v1` : desktop ? "正在读取缓存目录…" : "默认应用缓存目录"}>
        <Button variant="outline" disabled={disabled} onClick={() => void perform(async () => { const directory = await open({ directory: true, multiple: false, title: "选择缓存目录" }); if (typeof directory === "string") await nativeCall("set_local_cache_options", { options: { ...options, directory } }); }, "缓存目录已更新，已有 TTML 歌词已迁移。")}>更改</Button>
      </SettingsCard>
      <SettingsCard title="缓存占用与清理" description={status ? `TTML 歌词占用 ${(status.usedBytes / 1024 / 1024).toFixed(2)} MB · ${status.entries} 份歌词` : desktop ? "正在统计缓存占用…" : "TTML 歌词占用 0 MB"}>
        <div className="flex gap-2"><Button variant="ghost" size="icon-sm" aria-label="刷新缓存占用" title="刷新缓存占用" disabled={busy || !desktop} onClick={() => void perform(async () => {})}><RefreshCw aria-hidden="true" /></Button><Button variant="outline" className="text-destructive" disabled={disabled || status?.entries === 0} onClick={() => void perform(() => nativeCall("clear_local_cache"), "TTML 缓存已清空。")}>清空缓存</Button></div>
      </SettingsCard>
    </section>
    {busy && <p role="status" className="text-sm text-muted-foreground">正在更新…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
  </div>;
}
