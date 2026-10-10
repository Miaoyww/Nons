import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/animate-ui/components/base/tabs'
import { Switch } from '@/components/ui/switch'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ExternalLink,
  FolderOpen,
  Package,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Store,
  Trash2,
  Upload
} from 'lucide-react'
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
  const [tab, setTab] = useState('loaded')
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
              setQuery('')
              setTab('unloaded')
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
  const loadedCount = plugins.filter((plugin) => plugin.loaded).length
  const filteredPlugins = plugins.filter(
    (plugin) =>
      plugin.loaded === (tab === 'loaded') &&
      `${plugin.manifest.name} ${plugin.manifest.id} ${plugin.manifest.description ?? ''}`
        .toLocaleLowerCase()
        .includes(search)
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
      if (typeof path === 'string') {
        await nativeCall('plugin_install', { path })
        setQuery('')
        setTab('unloaded')
      }
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
    <div ref={pageRef} className="flex flex-col gap-4" aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">插件设置</h2>
          <p className="mt-1 text-sm text-muted-foreground">管理播放器扩展与运行状态。</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !isTauri()}
            onClick={() => void run(() => nativeCall('plugin_open_folder'))}
          >
            <FolderOpen aria-hidden="true" />
            打开文件夹
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新插件"
            title="刷新插件"
            disabled={busy || !isTauri()}
            onClick={() => void run(() => nativeCall('plugin_discover'))}
          >
            <RefreshCw
              aria-hidden="true"
              className={busy ? 'animate-spin motion-reduce:animate-none' : undefined}
            />
          </Button>
        </div>
      </div>
      {dragging && (
        <div
          role="status"
          className="rounded-lg border border-dashed border-primary bg-primary/5 p-3 text-sm font-medium"
        >
          松开即可安装插件
        </div>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-line break-words text-sm text-destructive">
          {error}
        </p>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value)
          setReview(undefined)
          setRemoving(undefined)
          setTrusted(false)
        }}
        className="gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="插件分类">
            <TabsTab value="loaded">
              已加载
              <span className="text-xs tabular-nums text-muted-foreground">{loadedCount}</span>
            </TabsTab>
            <TabsTab value="unloaded">
              未加载
              <span className="text-xs tabular-nums text-muted-foreground">
                {plugins.length - loadedCount}
              </span>
            </TabsTab>
            <TabsTab value="install">
              <Upload aria-hidden="true" />
              安装插件
            </TabsTab>
          </TabsList>
          {tab !== 'install' && (
            <div className="relative w-full sm:ml-auto sm:w-48">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                aria-label="搜索插件"
                placeholder="搜索名称或 ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 pl-9"
              />
            </div>
          )}
        </div>
        <TabsPanel key={tab} value={tab} transition={{ duration: 0.15 }}>
          {tab === 'install' ? (
            <div className="space-y-4">
              <section className="rounded-xl border border-dashed border-border bg-muted/20 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Upload aria-hidden="true" className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">从本地安装</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      拖拽 ZIP 文件到此页面，或选择安装包与插件目录。
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy || !isTauri()} onClick={() => install(false)}>
                    <Upload aria-hidden="true" />
                    选择 ZIP
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !isTauri()}
                    onClick={() => install(true)}
                  >
                    <FolderOpen aria-hidden="true" />
                    选择目录
                  </Button>
                </div>
                <p role="status" className="mt-3 text-xs text-muted-foreground">
                  {busy ? '正在处理插件…' : '安装后进入未加载列表，查看权限并确认后启用。'}
                </p>
              </section>
              <section className="flex items-center gap-3 rounded-xl border border-border p-4">
                <Store aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-semibold">
                    插件商店
                    <span className="ml-2 rounded-md bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      即将接入
                    </span>
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    未来可在这里发现和安装插件，目前支持本地安装。
                  </p>
                </div>
              </section>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                <span>{tab === 'loaded' ? '运行中的插件' : '已安装、尚未加载的插件'}</span>
                <span className="shrink-0 tabular-nums">{filteredPlugins.length} 个插件</span>
              </div>
              {filteredPlugins.length === 0 && (
                <div
                  role="status"
                  className="flex flex-col items-center gap-2 px-4 py-8 text-center"
                >
                  <Package aria-hidden="true" className="size-6 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {search
                      ? '未找到匹配的插件'
                      : tab === 'loaded'
                        ? '暂无已加载插件'
                        : '暂无未加载插件'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {search
                      ? '尝试其他名称或插件 ID。'
                      : tab === 'loaded'
                        ? '在未加载列表中启用插件，或安装新的扩展。'
                        : '已关闭、待加载或加载失败的插件会显示在这里。'}
                  </p>
                  {!search && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setTab(tab === 'loaded' && plugins.length > 0 ? 'unloaded' : 'install')
                      }
                    >
                      {tab === 'loaded' && plugins.length > 0 ? '查看未加载插件' : '安装插件'}
                    </Button>
                  )}
                </div>
              )}
              {filteredPlugins.map((plugin) => (
                <section
                  key={plugin.manifest.id}
                  className="border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Package aria-hidden="true" className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 basis-32">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-sm font-semibold">
                          {plugin.manifest.name}
                        </h3>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          v{plugin.manifest.version}
                        </span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-xs ${plugin.error ? 'bg-destructive/10 text-destructive' : plugin.loaded ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                        >
                          {plugin.error
                            ? '发生错误'
                            : plugin.loaded
                              ? '已加载'
                              : plugin.enabled
                                ? '待加载'
                                : '已停用'}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="break-all">{plugin.manifest.id}</span>
                        {plugin.manifest.repository && (
                          <Button
                            variant="link"
                            size="xs"
                            className="h-auto gap-1 p-0 text-xs"
                            disabled={busy}
                            aria-label={`打开 ${plugin.manifest.name} 的代码仓库`}
                            title={plugin.manifest.repository}
                            onClick={() =>
                              void run(() =>
                                isTauri()
                                  ? openUrl(plugin.manifest.repository!)
                                  : Promise.resolve(
                                      window.open(
                                        plugin.manifest.repository!,
                                        '_blank',
                                        'noopener,noreferrer'
                                      )
                                    )
                              )
                            }
                          >
                            <ExternalLink aria-hidden="true" />
                            代码仓库
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-1">
                      <Button
                        disabled={busy}
                        size="sm"
                        variant={plugin.enabled ? 'outline' : 'default'}
                        onClick={() => {
                          if (plugin.enabled) void action(plugin.manifest.id, 'disable')
                          else {
                            setReview(plugin)
                            setTrusted(false)
                            setRemoving(undefined)
                          }
                        }}
                      >
                        {plugin.enabled ? '停用' : '启用'}
                      </Button>
                      {plugin.enabled && (
                        <Button
                          disabled={busy}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void action(plugin.manifest.id, plugin.loaded ? 'unload' : 'load')
                          }
                        >
                          {plugin.loaded ? '卸载运行实例' : '加载'}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
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
                      <Button
                        disabled={busy || !plugin.enabled}
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`重新加载 ${plugin.manifest.name}`}
                        title="重新加载"
                        onClick={() => void action(plugin.manifest.id, 'reload')}
                      >
                        <RotateCw aria-hidden="true" />
                      </Button>
                      <Button
                        disabled={busy}
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`卸载 ${plugin.manifest.name}`}
                        title="卸载插件"
                        onClick={() => {
                          setRemoving(plugin.manifest.id)
                          setKeepData(true)
                          setReview(undefined)
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  {plugin.manifest.description && (
                    <p className="mt-2 whitespace-pre-line break-words text-xs leading-relaxed text-muted-foreground">
                      {plugin.manifest.description}
                    </p>
                  )}
                  {plugin.error && (
                    <p role="alert" className="mt-2 break-words text-xs text-destructive">
                      {plugin.error}
                    </p>
                  )}
                  {review?.manifest.id === plugin.manifest.id && (
                    <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm">
                      <h4 className="font-semibold">启用前确认</h4>
                      <ul className="my-3 list-disc space-y-1 pl-5">
                        {plugin.manifest.permissions.map((p) => (
                          <li
                            key={p}
                            className={
                              p === 'account:credentials' ||
                              (p === 'files:selected' &&
                                plugin.manifest.fileRoots?.includes('*')) ||
                              (['http:request', 'http:transfer'].includes(p) &&
                                plugin.manifest.httpHosts?.includes('*'))
                                ? 'font-semibold text-destructive'
                                : undefined
                            }
                          >
                            {p === 'files:selected' && plugin.manifest.fileRoots?.includes('*')
                              ? '敏感权限：读写任意文件'
                              : ['http:request', 'http:transfer'].includes(p) &&
                                  plugin.manifest.httpHosts?.includes('*')
                                ? p === 'http:request'
                                  ? '敏感权限：会请求任意 URL'
                                  : '敏感权限：会请求任意 URL 并传输资源到授权目录'
                                : (permissionLabels[p] ?? p)}
                            {['http:request', 'http:transfer'].includes(p) &&
                              !plugin.manifest.httpHosts?.includes('*') &&
                              `：${plugin.manifest.httpHosts?.join('、') ?? ''}`}
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
                      {plugin.manifest.httpHosts?.includes('*') && (
                        <p
                          role="alert"
                          className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive"
                        >
                          此插件会请求任意
                          URL，向任意域名发送其可读取的数据。若同时授权账户凭证，登录 Cookie
                          也可能被发送到其他网站。请仅授权你信任的插件。
                        </p>
                      )}
                      {plugin.manifest.fileRoots?.includes('*') && (
                        <p
                          role="alert"
                          className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive"
                        >
                          此插件可读取、创建、修改和删除当前用户能够访问的任意文件，不受已授权目录限制。
                          若同时授予网络权限，它也可能发送文件内容。请仅授权你信任的插件。
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
                            void action(
                              plugin.manifest.id,
                              keepData ? 'uninstall-keep-data' : 'uninstall'
                            )
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
          )}
        </TabsPanel>
      </Tabs>
    </div>
  )
}
