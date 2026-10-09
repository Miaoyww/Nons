import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode
} from 'react'
import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { errorText, nativeCall } from '@/lib/player'
import * as sdk from './sdk'
import { installBridge } from './bridge'
import { PluginScope, PluginNavigationScope, type Scope } from './scope'
import { resolvePluginPage, resolvePluginPath, type PluginDescriptor } from './types'

interface Loaded {
  scope: Scope
  module: Record<string, unknown>
  dispose?: () => void
}
interface Registry {
  plugins: PluginDescriptor[]
  loaded: Map<string, Loaded>
}
const RegistryContext = createContext<Registry>({ plugins: [], loaded: new Map() })
export const usePlugins = () => useContext(RegistryContext)
export function installPluginBridge() {
  installBridge(React, jsx, sdk)
}
export function pluginResourceUrl(plugin: PluginDescriptor, relative: string) {
  return `${convertFileSrc('', 'plugin').replace(/\/$/, '')}/${plugin.manifest.id}/${plugin.generation}/${relative.split('/').map(encodeURIComponent).join('/')}`
}
function deactivate(plugin: Loaded) {
  plugin.scope.active = false
  plugin.scope.cleanups?.forEach((cleanup) => cleanup())
  plugin.scope.cleanups?.clear()
  plugin.scope.events.clear()
  plugin.scope.listeners.clear()
  try {
    plugin.dispose?.()
  } catch (error) {
    console.error('插件清理失败', error)
  }
}
function isComponent(value: unknown) {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' &&
      value !== null &&
      '$$typeof' in value &&
      [
        Symbol.for('react.memo'),
        Symbol.for('react.forward_ref'),
        Symbol.for('react.lazy')
      ].includes(value.$$typeof as symbol))
  )
}
export function PluginProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<Registry>({ plugins: [], loaded: new Map() })
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let serial = 0
    const loaded = new Map<string, Loaded>()
    const pending = new Map<string, Promise<void>>()
    const cleanups: (() => void)[] = []
    async function refresh() {
      const request = ++serial
      const plugins = await nativeCall<PluginDescriptor[]>('plugin_list')
      if (disposed || request !== serial) return
      for (const [id, plugin] of loaded) {
        if (
          !plugins.some(
            (p) =>
              p.manifest.id === id &&
              p.loaded &&
              p.generation === plugin.scope.descriptor.generation
          )
        ) {
          deactivate(plugin)
          loaded.delete(id)
        }
      }
      setRegistry({ plugins, loaded: new Map(loaded) })
      await Promise.all(
        plugins
          .filter((p) => p.loaded && p.manifest.frontend && !loaded.has(p.manifest.id))
          .map(async (descriptor) => {
            const key = `${descriptor.manifest.id}:${descriptor.generation}`
            if (pending.has(key)) return pending.get(key)
            const task = (async () => {
              let plugin: Loaded | undefined
              try {
                const module: Record<string, unknown> = await import(
                  /* @vite-ignore */ pluginResourceUrl(descriptor, descriptor.manifest.frontend!)
                )
                if (disposed) return
                // An import cannot be canceled; check the authoritative generation afterwards.
                const current = await nativeCall<PluginDescriptor[]>('plugin_list')
                if (
                  disposed ||
                  !current.some(
                    (p) =>
                      p.manifest.id === descriptor.manifest.id &&
                      p.loaded &&
                      p.generation === descriptor.generation
                  )
                )
                  return
                for (const contribution of [
                  ...descriptor.manifest.contributes.views,
                  ...descriptor.manifest.contributes.pages
                ]) {
                  if (!isComponent(module[contribution.export]))
                    throw new Error(`插件未导出 ${contribution.export}`)
                }
                plugin = {
                  module,
                  scope: { descriptor, active: true, events: new Map(), listeners: new Set() }
                }
                if (typeof module.activate === 'function') {
                  const dispose: unknown = await module.activate()
                  if (typeof dispose === 'function') plugin.dispose = dispose as () => void
                }
                const latest = await nativeCall<PluginDescriptor[]>('plugin_list')
                if (
                  disposed ||
                  !latest.some(
                    (p) =>
                      p.manifest.id === descriptor.manifest.id &&
                      p.loaded &&
                      p.generation === descriptor.generation
                  )
                ) {
                  deactivate(plugin)
                  return
                }
                loaded.set(descriptor.manifest.id, plugin)
                setRegistry((old) => ({ ...old, loaded: new Map(loaded) }))
                await nativeCall('plugin_ready', {
                  id: descriptor.manifest.id,
                  generation: descriptor.generation
                })
              } catch (error) {
                if (plugin) deactivate(plugin)
                if (loaded.get(descriptor.manifest.id) === plugin)
                  loaded.delete(descriptor.manifest.id)
                if (!disposed)
                  await nativeCall('plugin_fault', {
                    id: descriptor.manifest.id,
                    generation: descriptor.generation,
                    error: errorText(error)
                  }).catch(console.error)
              } finally {
                pending.delete(key)
              }
            })()
            pending.set(key, task)
            return task
          })
      )
    }
    const retain = (cleanup: () => void) => {
      if (disposed) cleanup()
      else cleanups.push(cleanup)
    }
    void (async () => {
      retain(
        await listen<{
          pluginId: string
          generation: number
          event: string
          namespace: string
          payload: unknown
        }>('plugin-event', ({ payload }) => {
          const plugin = loaded.get(payload.pluginId)
          if (
            !plugin?.scope.active ||
            plugin.scope.descriptor.generation !== payload.generation ||
            payload.namespace !== `plugin:${payload.pluginId}:${payload.event}`
          )
            return
          if (!plugin.scope.events.has(payload.event) && plugin.scope.events.size >= 64)
            plugin.scope.events.delete(plugin.scope.events.keys().next().value!)
          plugin.scope.events.set(payload.event, payload.payload)
          plugin.scope.listeners.forEach((notify) => notify())
        })
      )
      retain(
        await listen('plugins-changed', () => {
          void refresh().catch(console.error)
        })
      )
      if (!disposed) await refresh()
    })().catch(console.error)
    return () => {
      disposed = true
      cleanups.forEach((fn) => fn())
      loaded.forEach(deactivate)
      loaded.clear()
    }
  }, [])
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
}
class PluginBoundary extends Component<
  { plugin: Loaded; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    deactivate(this.props.plugin)
    const { manifest, generation } = this.props.plugin.scope.descriptor
    void nativeCall('plugin_fault', { id: manifest.id, generation, error: error.message }).catch(
      console.error
    )
  }
  render() {
    return this.state.failed ? (
      <p role="alert" className="p-4 text-sm text-destructive">
        插件显示失败，可在设置中重新加载。
      </p>
    ) : (
      this.props.children
    )
  }
}
function Contribution({ plugin, name }: { plugin: Loaded; name: string }) {
  const View = plugin.module[name] as ComponentType
  return (
    <PluginBoundary plugin={plugin}>
      <PluginScope.Provider value={plugin.scope}>
        <View />
      </PluginScope.Provider>
    </PluginBoundary>
  )
}
export function PluginSlot({ name }: { name: string }) {
  const { loaded } = usePlugins()
  return (
    <>
      {[...loaded.values()].flatMap((plugin) =>
        plugin.scope.descriptor.manifest.contributes.views
          .filter((v) => v.slot === name)
          .map((view) => (
            <Contribution
              key={`${plugin.scope.descriptor.manifest.id}:${plugin.scope.descriptor.generation}:${view.id}`}
              plugin={plugin}
              name={view.export}
            />
          ))
      )}
    </>
  )
}
export function PluginPageHost({
  path,
  navigate
}: {
  path: string
  navigate?: (path: string) => void
}) {
  const { plugins, loaded } = usePlugins()
  const route = resolvePluginPath(path)
  const plugin = route ? loaded.get(route.pluginId) : undefined
  const page =
    plugin && route
      ? resolvePluginPage(plugin.scope.descriptor.manifest, route.pathname)
      : undefined
  if (plugin && page)
    return (
      <PluginNavigationScope.Provider
        value={
          navigate && route ? { pathname: route.pathname, search: route.search, navigate } : null
        }
      >
        <Contribution
          key={`${route!.pluginId}:${plugin.scope.descriptor.generation}:${page.id}`}
          plugin={plugin}
          name={page.export}
        />
      </PluginNavigationScope.Provider>
    )
  const descriptor = plugins.find((p) => p.manifest.id === route?.pluginId)
  return (
    <p role="status" className="m-auto p-8 text-sm text-muted-foreground">
      {descriptor?.loaded && !plugin
        ? '正在加载插件页面…'
        : '插件页面不可用，请检查路径或在设置中启用插件。'}
    </p>
  )
}
