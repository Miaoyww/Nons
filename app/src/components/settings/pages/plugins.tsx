import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { errorText, nativeCall } from "@/lib/player";
import { usePlugins } from "@/plugins/host";
import type { PluginDescriptor } from "@/plugins/types";

const permissionLabels: Record<string, string> = { "clipboard:music-links": "观察剪贴板中的网易云分享链接", "music:metadata": "读取歌曲信息", "player:read": "读取播放状态", "player:control": "控制播放", storage: "保存独立插件数据", ui: "运行受信任的界面代码" };
export function PluginsPage() {
  const { plugins } = usePlugins();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [review, setReview] = useState<PluginDescriptor>();
  const [trusted, setTrusted] = useState(false);
  const [removing, setRemoving] = useState<string>();
  async function run(work: () => Promise<unknown>) { setBusy(true); setError(undefined); try { await work(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  const action = (id: string, action: string, confirmed = false) => run(() => nativeCall("plugin_action", { id, action, confirmed }));
  function install(directory: boolean) {
    void run(async () => {
      const path = await open({ directory, multiple: false, title: directory ? "选择插件目录" : "选择插件 ZIP", filters: directory ? undefined : [{ name: "插件包", extensions: ["zip"] }] });
      if (typeof path === "string") await nativeCall("plugin_install", { path });
    });
  }
  return <div className="flex flex-col gap-6">
    <div><h2 className="text-xl font-bold">插件</h2><p className="mt-2 text-sm text-muted-foreground">安装扩展，为播放器添加新的界面和能力。</p></div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !isTauri()} onClick={() => install(false)}>安装 ZIP</Button><Button variant="outline" disabled={busy || !isTauri()} onClick={() => install(true)}>安装目录</Button><Button variant="ghost" disabled={busy || !isTauri()} onClick={() => void run(() => nativeCall("plugin_discover"))}>重新发现</Button></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {plugins.length === 0 && <p className="text-sm text-muted-foreground">暂无插件。安装后，查看权限并明确启用。</p>}
    {plugins.map((plugin) => <section key={plugin.manifest.id} className="rounded-xl border border-border p-5">
      <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{plugin.manifest.name}</h3><p className="mt-1 text-xs text-muted-foreground">{plugin.manifest.id} · {plugin.manifest.version}</p></div><span className="text-sm text-muted-foreground">{plugin.error ? "发生错误" : plugin.loaded ? "已加载" : plugin.enabled ? "已启用，未加载" : "已关闭"}</span></div>
      {plugin.error && <p role="alert" className="mt-3 break-words text-sm text-destructive">{plugin.error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy} variant={plugin.enabled ? "outline" : "default"} onClick={() => { if (plugin.enabled) void action(plugin.manifest.id, "disable"); else { setReview(plugin); setTrusted(false); } }}>{plugin.enabled ? "停用" : "启用"}</Button>
        {plugin.enabled && <><Button disabled={busy} variant="ghost" onClick={() => void action(plugin.manifest.id, plugin.loaded ? "unload" : "load")}>{plugin.loaded ? "卸载运行实例" : "加载"}</Button><Button disabled={busy} variant="ghost" onClick={() => void action(plugin.manifest.id, "reload")}>重新加载</Button></>}
        <Button disabled={busy} variant="ghost" onClick={() => setRemoving(plugin.manifest.id)}>删除插件</Button>
      </div>
      {review?.manifest.id === plugin.manifest.id && <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm">
        <h4 className="font-semibold">启用前确认</h4><ul className="my-3 list-disc space-y-1 pl-5">{plugin.manifest.permissions.map((p) => <li key={p}>{permissionLabels[p] ?? p}</li>)}</ul>
        <p className="leading-6 text-muted-foreground">前端插件与播放器运行在同一界面环境，能够执行代码。只启用你信任的插件；WASM 权限限制不代表前端沙箱。</p>
        <label className="my-3 flex items-center gap-2"><input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />我信任此插件并同意以上权限</label>
        <div className="flex gap-2"><Button disabled={!trusted || busy} onClick={() => { void action(plugin.manifest.id, "enable", true); setReview(undefined); }}>确认启用</Button><Button variant="ghost" onClick={() => setReview(undefined)}>取消</Button></div>
      </div>}
      {removing === plugin.manifest.id && <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm"><p>删除插件会同时删除其独立存储数据。</p><div className="mt-3 flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => { void action(plugin.manifest.id, "uninstall"); setRemoving(undefined); }}>确认删除</Button><Button variant="ghost" onClick={() => setRemoving(undefined)}>取消</Button></div></div>}
    </section>)}
  </div>;
}
