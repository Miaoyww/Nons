import { Switch } from '@/components/ui/switch'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, RefreshCw, RotateCw, Search, Settings, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorText, nativeCall } from '@/lib/player'
import { usePlugins } from '@/plugins/host'
import type { PluginDescriptor } from '@/plugins/types'
import { PluginConfigurationPage } from '../plugins/configuration-page'

const permissionLabels: Record<string, string> = {
  'clipboard:music-links': '旧版音乐链接权限（需要升级插件）',
  'clipboard:read': '读取剪贴板文本及监听变化',
  'http:request': '请求已声明的网络域名',
  'http:transfer': '将授权域名的资源传输到授权目录',
  secrets: '管理插件自己的系统凭据',
  'account:credentials': '敏感权限：读取 NonsPlayer 的网易云账户凭证',
  'music:metadata': '读取网易云歌曲信息',
  'player:read': '读取播放状态',
  'player:control': '控制播放',
  storage: '保存独立插件数据',
  ui: '运行受信任的界面代码',
  config: '管理独立插件配置',
  'files:data': '读写插件专属数据目录',
  'files:selected': '申请访问用户选择的外部目录'
}
export function PluginsPage({ initialPluginId }: { initialPluginId?: string } = {}) {
  const { plugins } = usePlugins()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [review, setReview] = useState<PluginDescriptor>()
  const [trusted, setTrusted] = useState(false)
  const [removing, setRemoving] = useState<string>()
  const [keepData, setKeepData] = useState(true)
  const [configuring, setConfiguring] = useState<string | undefined>(initialPluginId)
  useEffect(() => {
    if (initialPluginId) setConfiguring(initialPluginId)
  }, [initialPluginId])
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const running = useRef(false)
  const run = useCallback(async (work: () => Promise<unknown>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(undefined)
    try {
      await work()
    } catch (error) {
      setError(errorText(error))
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (disposed) return
        if (payload.type === 'leave') {
          setDragging(false)
          return
        }
        const surface =
          pageRef.current?.closest('section[aria-label="插件设置"]') ?? pageRef.current
        const bounds = surface?.getBoundingClientRect()
        const x = payload.position.x / window.devicePixelRatio
        const y = payload.position.y / window.devicePixelRatio
        const inside =
          !!bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
        setDragging(inside && payload.type !== 'drop' && !running.current)
        if (payload.type !== 'drop' || !inside || running.current) return
        void run(async () => {
          if (!payload.paths.length || payload.paths.some((path) => !/\.zip$/i.test(path)))
            throw new Error('请拖入 .zip 格式的插件安装包。')
          const failures: string[] = []
          for (const path of new Set(payload.paths)) {
            try {
              await nativeCall('plugin_install', { path })
            } catch (error) {
              failures.push(`${path.split(/[\\/]/).pop()}：${errorText(error)}`)
            }
          }
          if (failures.length) throw new Error(failures.join('\n'))
        })
      })
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        if (!disposed) setError(errorText(error))
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [run])
  const search = query.trim().toLocaleLowerCase()
  const filteredPlugins = plugins.filter((plugin) =>
    `${plugin.manifest.name} ${plugin.manifest.id}`.toLocaleLowerCase().includes(search)
  )
  const selectedPlugin = plugins.find((plugin) => plugin.manifest.id === configuring)
  const action = (id: string, action: string, confirmed = false) =>
    run(() => nativeCall('plugin_action', { id, action, confirmed }))
  function install(directory: boolean) {
    void run(async () => {
      const path = await open({
        directory,
        multiple: false,
        title: directory ? '选择插件目录' : '选择插件 ZIP',
        filters: directory ? undefined : [{ name: '插件包', extensions: ['zip'] }]
      })
      if (typeof path === 'string') await nativeCall('plugin_install', { path })
    })
  }
  if (selectedPlugin)
    return (
      <PluginConfigurationPage
        key={`${selectedPlugin.manifest.id}:${selectedPlugin.generation}`}
        plugin={selectedPlugin}
        back={() => setConfiguring(undefined)}
      />
    )
  return (
    <div ref={pageRef} className="flex flex-col gap-6" aria-busy={busy}>
      <div>
        <h2 className="text-xl font-bold">插件设置</h2>
        <p className="mt-2 text-sm text-muted-foreground">管理播放器扩展。</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || !isTauri()}
            onClick={() => void run(() => nativeCall('plugin_open_folder'))}
          >
            <FolderOpen aria-hidden="true" />
            打开文件夹
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="刷新插件"
            title="刷新插件"
            disabled={busy || !isTauri()}
            onClick={() => void run(() => nativeCall('plugin_discover'))}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
        <div className="relative w-full sm:ml-auto sm:w-56">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="搜索已安装的插件"
            placeholder="搜索已安装的插件"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div
        className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed p-4 transition-colors ${dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20'}`}
      >
        <div className="flex items-center gap-3">
          <Upload aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <div role="status">
            <p className="text-sm font-medium">
              {busy ? '正在处理插件…' : dragging ? '松开即可安装插件' : '拖拽 ZIP 文件到此页面安装'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">安装后查看权限，再启用插件。</p>
          </div>
        </div>
        <Button variant="outline" disabled={busy || !isTauri()} onClick={() => install(false)}>
          选择 ZIP
        </Button>
      </div>
      {error && (
        <p role="alert" className="whitespace-pre-line break-words text-sm text-destructive">
          {error}
        </p>
      )}
      {plugins.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无插件。安装后，查看权限并明确启用。</p>
      )}
      {plugins.length > 0 && filteredPlugins.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          未找到匹配的已安装插件。
        </p>
      )}
      {filteredPlugins.map((plugin) => (
        <section key={plugin.manifest.id} className="rounded-xl border border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="break-words font-semibold">{plugin.manifest.name}</h3>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {plugin.manifest.id} · {plugin.manifest.version}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {plugin.error
                  ? '发生错误'
                  : plugin.loaded
                    ? '已加载'
                    : plugin.enabled
                      ? '已启用，未加载'
                      : '已关闭'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              disabled={
                busy ||
                !(
                  plugin.manifest.configuration ||
                  plugin.manifest.permissions.some(
                    (p) => p === 'files:data' || p === 'files:selected'
                  )
                )
              }
              aria-label={`设置 ${plugin.manifest.name}`}
              title="插件设置"
              onClick={() => setConfiguring(plugin.manifest.id)}
            >
              <Settings aria-hidden="true" />
            </Button>
          </div>
          {plugin.error && (
            <p role="alert" className="mt-3 break-words text-sm text-destructive">
              {plugin.error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              disabled={busy}
              variant={plugin.enabled ? 'outline' : 'default'}
              onClick={() => {
                if (plugin.enabled) void action(plugin.manifest.id, 'disable')
                else {
                  setReview(plugin)
                  setTrusted(false)
                }
              }}
            >
              {plugin.enabled ? '停用' : '启用'}
            </Button>
            {plugin.enabled && (
              <>
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() => void action(plugin.manifest.id, plugin.loaded ? 'unload' : 'load')}
                >
                  {plugin.loaded ? '卸载运行实例' : '加载'}
                </Button>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                disabled={busy || !plugin.enabled}
                variant="ghost"
                size="icon"
                aria-label={`重新加载 ${plugin.manifest.name}`}
                title="重新加载"
                onClick={() => void action(plugin.manifest.id, 'reload')}
              >
                <RotateCw aria-hidden="true" />
              </Button>
              <Button
                disabled={busy}
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`卸载 ${plugin.manifest.name}`}
                title="卸载插件"
                onClick={() => {
                  setRemoving(plugin.manifest.id)
                  setKeepData(true)
                }}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
          {review?.manifest.id === plugin.manifest.id && (
            <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm">
              <h4 className="font-semibold">启用前确认</h4>
              <ul className="my-3 list-disc space-y-1 pl-5">
                {plugin.manifest.permissions.map((p) => (
                  <li
                    key={p}
                    className={
                      p === 'account:credentials' ? 'font-semibold text-destructive' : undefined
                    }
                  >
                    {permissionLabels[p] ?? p}
                    {p === 'http:request' && `：${plugin.manifest.httpHosts?.join('、') ?? ''}`}
                  </li>
                ))}
              </ul>
              {plugin.manifest.permissions.includes('account:credentials') && (
                <p
                  role="alert"
                  className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive"
                >
                  此插件可以读取当前账号的登录
                  Cookie，并以你的账号身份请求网易云服务。请仅授权你信任的插件。
                </p>
              )}
              <p className="leading-6 text-muted-foreground">
                前端插件与播放器运行在同一界面环境，能够执行代码。只启用你信任的插件；WASM
                权限限制不代表前端沙箱。
              </p>
              <label className="my-3 flex items-center gap-2">
                <Switch checked={trusted} onCheckedChange={setTrusted} />
                我信任此插件并同意以上权限
              </label>
              <div className="flex gap-2">
                <Button
                  disabled={!trusted || busy}
                  onClick={() => {
                    void action(plugin.manifest.id, 'enable', true)
                    setReview(undefined)
                  }}
                >
                  确认启用
                </Button>
                <Button variant="ghost" onClick={() => setReview(undefined)}>
                  取消
                </Button>
              </div>
            </div>
          )}
          {removing === plugin.manifest.id && (
            <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm">
              <p>
                默认保留插件配置、独立存储和专属数据目录，重新安装时恢复；关闭下方选项后清理这些数据。外部授权目录不会被清理。
              </p>
              <label className="mt-3 flex items-center gap-2">
                <Switch checked={keepData} onCheckedChange={setKeepData} disabled={busy} />
                保留插件数据，重新安装时恢复
              </label>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    void action(plugin.manifest.id, keepData ? 'uninstall-keep-data' : 'uninstall')
                    setRemoving(undefined)
                  }}
                >
                  确认卸载
                </Button>
                <Button variant="ghost" onClick={() => setRemoving(undefined)}>
                  取消
                </Button>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
