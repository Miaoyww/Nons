import { useState, useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { getShortcutStatus, saveShortcuts, shortcutActions, subscribeShortcuts } from "@/lib/shortcuts";
import { SettingsCard } from "../settings-card";

export function ShortcutsPage() {
  const { settings, busy, error } = useSyncExternalStore(subscribeShortcuts, getShortcutStatus);
  const [draft, setDraft] = useState(() => ({ ...settings.bindings }));
  const [saved, setSaved] = useState(false);
  const desktop = isTauri();
  return <div className="flex flex-col gap-8">
    <div><h2 className="text-xl font-bold">快捷键设置</h2><p className="mt-2 text-sm text-muted-foreground">应用内与全局播放控制。</p></div>
    <section className="flex flex-col gap-4" aria-labelledby="app-shortcuts"><h3 id="app-shortcuts" className="text-base font-semibold">应用内快捷键</h3>
      <SettingsCard title="播放/暂停音乐" description="应用内生效，固定不可更改。"><kbd className="rounded border border-border px-4 py-2 text-sm">空格</kbd></SettingsCard>
    </section>
    <section className="flex flex-col gap-4" aria-labelledby="global-shortcuts"><h3 id="global-shortcuts" className="text-base font-semibold">全局快捷键</h3>
      <SettingsCard title="启用全局快捷键" description="应用在后台时也可使用。"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled} disabled={!desktop || busy} onChange={(event) => { setSaved(false); void saveShortcuts({ ...settings, enabled: event.target.checked }); }} />启用</label></SettingsCard>
      <p className="text-xs text-muted-foreground">填写组合键（如 Ctrl+Alt+P），留空表示不绑定。</p>
      {shortcutActions.map(([action, title]) => <SettingsCard key={action} title={title} description={action === "like" ? "收藏当前网易云歌曲。" : "留空不绑定。"}><input aria-label={`${title}全局快捷键`} className="music-input w-56 max-w-full" value={draft[action]} maxLength={100} disabled={!desktop || busy} placeholder="未绑定" onChange={(event) => { setSaved(false); setDraft({ ...draft, [action]: event.target.value }); }} /></SettingsCard>)}
      <Button variant="outline" className="self-end" disabled={!desktop || busy} onClick={() => { void saveShortcuts({ enabled: settings.enabled, bindings: draft }).then(setSaved); }}>{busy ? "正在保存…" : "保存快捷键"}</Button>
      {saved && <p role="status" className="text-xs text-muted-foreground">已保存</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!desktop && <p className="text-xs text-muted-foreground">快捷键在桌面应用中生效。</p>}
    </section>
  </div>;
}
