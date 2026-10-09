import type { ConfigSnapshot, PluginClient, PluginMenuSong, PluginTransfer } from '@app/plugin-sdk'
import {
  api,
  audioFormat,
  filename,
  LoginRequired,
  mergeCookies,
  resolveResource,
  type Quality
} from './protocol'

type Options = {
  quality: Quality
  minimumQuality: Quality
  allowFallback: boolean
  directory: string
}
export interface DownloadTask {
  id: number
  song: PluginMenuSong
  state:
    'waiting' | 'setup' | 'resolving' | 'running' | 'saving' | 'completed' | 'failed' | 'cancelled'
  options?: Options
  quality?: Quality
  bytes: number
  total?: number
  path?: string
  error?: string
  transfer?: number
}
let client: PluginClient
let active = false
let pumping = false
let cookie = ''
let loginKey: string | undefined
let tasks: DownloadTask[] = []
let view = { tasks, loggedIn: false, message: '' }
const adding = new Set<number>()
const setupShown = new Set<number>()
const listeners = new Set<() => void>()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const changed = () => {
  view = { tasks: [...tasks], loggedIn: /(?:^|;\s*)MUSIC_U=/.test(cookie), message: view.message }
  listeners.forEach((fn) => fn())
}
export const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const snapshot = () => view
let persistence = Promise.resolve()
function persist() {
  const record = tasks.map(({ transfer: _, ...task }) => task)
  persistence = persistence
    .catch(() => {})
    .then(() => client.call('storage.set', { key: 'tasks', value: record }))
    .then(() => {})
  return persistence
}
export async function activate(next: PluginClient) {
  client = next
  active = true
  try {
    cookie = (await client.call<string | null>('secrets.get', { key: 'account' })) || ''
    const saved = await client.call<DownloadTask[] | null>('storage.get', { key: 'tasks' })
    tasks = (Array.isArray(saved) ? saved : []).slice(-32).map((task) => {
      if (task.state === 'running' || task.state === 'resolving' || task.state === 'saving')
        return { ...task, state: 'failed', error: '上次下载已中断，请重试', transfer: undefined }
      return { ...task, transfer: undefined }
    })
  } catch (error) {
    view.message = String(error)
  }
  changed()
  const timer = setInterval(() => {
    void pump()
  }, 2000)
  return () => {
    active = false
    cookie = ''
    loginKey = undefined
    clearInterval(timer)
    listeners.clear()
    adding.clear()
    setupShown.clear()
    tasks = []
    changed()
  }
}
export async function downloadSong(song: PluginMenuSong) {
  if (
    song.source.kind !== 'netease' ||
    !Number.isSafeInteger(song.source.id) ||
    song.source.id <= 0
  )
    throw new Error('只支持有效的网易云歌曲')
  const id = song.source.id
  if (
    adding.has(id) ||
    tasks.some(
      (task) =>
        task.song.source.kind === 'netease' &&
        task.song.source.id === id &&
        ['waiting', 'setup', 'resolving', 'running', 'saving'].includes(task.state)
    )
  ) {
    view.message = '该歌曲已在下载队列中'
    changed()
    client.openPage()
    return view.message
  }
  adding.add(id)
  try {
    if (tasks.length >= 32) {
      const i = tasks.findIndex((task) => ['completed', 'failed', 'cancelled'].includes(task.state))
      if (i < 0) throw new Error('下载队列已满（最多 32 首）')
      tasks.splice(i, 1)
    }
    const config = await client.call<ConfigSnapshot>('config.get')
    const options = config.values as Options
    tasks.push({
      id: Date.now() + Math.random(),
      song: {
        ...song,
        key: song.key.slice(0, 128),
        title: Array.from(song.title).slice(0, 80).join(''),
        artist: Array.from(song.artist).slice(0, 80).join(''),
        album: Array.from(song.album).slice(0, 80).join(''),
        cover: ''
      },
      state: 'waiting',
      options: { ...options },
      bytes: 0
    })
    const notice = `已加入下载队列：${song.title}`
    view.message = notice
    changed()
    await persist()
    if (!options.directory) client.openConfiguration()
    else if (!snapshot().loggedIn) {
      setupShown.add(tasks[tasks.length - 1].id)
      client.openPage()
    }
    void pump()
    return notice
  } finally {
    adding.delete(id)
  }
}
async function pump() {
  if (!active || pumping) return
  const task = tasks.find((task) => task.state === 'waiting' || task.state === 'setup')
  if (!task) return
  pumping = true
  const previous = JSON.stringify(task)
  let temporary: string | undefined
  let root: string | undefined
  try {
    const options = task.options!
    if (!options.directory) {
      const config = await client.call<ConfigSnapshot>('config.get')
      task.options = { ...options, directory: String(config.values.directory || '') }
    }
    root = task.options!.directory
    const roots = await client.call<{ id: string; writable: boolean }[]>('files.roots')
    if (!root || !roots.some((r) => r.id === root && r.writable) || !snapshot().loggedIn) {
      if (
        root &&
        roots.some((r) => r.id === root && r.writable) &&
        !snapshot().loggedIn &&
        !setupShown.has(task.id)
      ) {
        setupShown.add(task.id)
        client.openPage()
      }
      task.state = 'setup'
      task.error =
        !root || !roots.some((r) => r.id === root && r.writable)
          ? '请选择并授权保存目录'
          : '请扫码登录插件下载账号'
      if (JSON.stringify(task) !== previous) changed()
      return
    }
    task.state = 'resolving'
    task.error = undefined
    changed()
    await persist()
    if (task.song.source.kind !== 'netease') throw new Error('歌曲来源无效')
    const resource = await resolveResource(
      client,
      task.song.source.id,
      task.options!.quality,
      task.options!.allowFallback,
      task.options!.minimumQuality,
      cookie
    )
    if (!active || task.state === ('cancelled' as string)) return
    task.quality = resource.quality
    task.total = resource.size
    temporary = `${filename(task.song.title, task.song.artist, task.song.source.id)}-${Math.floor(task.id)}-${Date.now()}-${Math.floor(Math.random() * 1e9)}.part`
    const started = await client.call<{ id: number }>('transfers.start', {
      url: resource.url,
      root,
      path: temporary,
      maxBytes: resource.size
    })
    task.transfer = started.id
    if (task.state === ('cancelled' as string))
      await client.call('transfers.cancel', { id: started.id })
    else task.state = 'running'
    changed()
    await persist()
    for (;;) {
      await wait(500)
      if (!active) return
      const state = await client.call<PluginTransfer>('transfers.get', { id: task.transfer })
      task.bytes = state.bytes
      changed()
      if (state.state === 'running') continue
      if (state.state !== 'completed') throw new Error(state.error || '下载已取消')
      if (task.state === ('cancelled' as string)) throw new Error('下载已取消')
      if (state.bytes !== resource.size) throw new Error('实际文件大小与资源信息不符，请重试')
      break
    }
    task.state = 'saving'
    changed()
    const { handle } = await client.call<{ handle: number }>('files.open', {
      root,
      path: temporary,
      mode: 'read'
    })
    let format: ReturnType<typeof audioFormat>
    try {
      const { data } = await client.call<{ data: string }>('files.read', {
        handle,
        offset: 0,
        length: 32
      })
      format = audioFormat(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
    } finally {
      await client.call('files.close', { handle })
    }
    if (!format) throw new Error('资源不是受支持的音频文件，已拒绝保存')
    if (task.state === ('cancelled' as string)) throw new Error('下载已取消')
    const target = `${filename(task.song.title, task.song.artist, task.song.source.id)}.${format}`
    await client.call('files.publish', { root, path: temporary, to: target })
    temporary = undefined
    task.path = target
    task.state = 'completed'
    changed()
  } catch (error) {
    if (error instanceof LoginRequired) {
      cookie = ''
      await client.call('secrets.delete', { key: 'account' }).catch(() => {})
    }
    if (active && task.state !== 'cancelled') {
      task.state = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
    }
    changed()
  } finally {
    if (temporary && root && active)
      await client.call('files.remove', { root, path: temporary }).catch(() => {})
    if (active && JSON.stringify(task) !== previous)
      await persist().catch((error) => {
        view.message = `保存下载记录失败：${String(error)}`
        changed()
      })
    pumping = false
    if (active && task.state !== 'setup') void pump()
  }
}
export async function cancelTask(id: number) {
  const task = tasks.find((task) => task.id === id)
  if (!task || ['completed', 'failed', 'cancelled', 'saving'].includes(task.state)) return
  task.state = 'cancelled'
  changed()
  if (task.transfer) await client.call('transfers.cancel', { id: task.transfer })
  await persist()
}
export async function retryTask(id: number) {
  const task = tasks.find((task) => task.id === id)
  if (!task || !['failed', 'cancelled', 'setup'].includes(task.state)) return
  const config = await client.call<ConfigSnapshot>('config.get')
  task.options = { ...config.values } as Options
  task.state = 'waiting'
  task.bytes = 0
  task.transfer = undefined
  task.error = undefined
  changed()
  await persist()
  if (!task.options.directory) client.openConfiguration()
  else if (!snapshot().loggedIn) client.openPage()
  void pump()
}
export function configure() {
  client.openConfiguration()
}
export async function createLogin() {
  const { body } = await api(client, '/api/login/qrcode/unikey', { type: 3 }, '')
  if (body.code !== 200 || typeof body.unikey !== 'string')
    throw new Error('无法生成登录二维码，请重试')
  loginKey = body.unikey
  return body.unikey as string
}
export async function checkLogin(key: string) {
  const { body, cookies } = await api(
    client,
    '/api/login/qrcode/client/login',
    { key, type: 3 },
    ''
  )
  if (!active || loginKey !== key) return 800
  if (body.code === 803) {
    const next = mergeCookies('', cookies)
    if (!/(?:^|;\s*)MUSIC_U=/.test(next)) throw new Error('登录响应缺少账号凭据，请重新生成二维码')
    await client.call('secrets.set', { key: 'account', value: next })
    cookie = next
    view.message = '插件下载账号已登录'
    changed()
    void pump()
  }
  return body.code as number
}
export async function logout() {
  loginKey = undefined
  await client.call('secrets.delete', { key: 'account' })
  cookie = ''
  changed()
}
