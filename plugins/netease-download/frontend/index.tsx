import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@app/plugin-sdk'
import QRCode from 'qrcode'
import { qualityLabels } from './protocol'
import {
  cancelTask,
  checkLogin,
  configure,
  createLogin,
  logout,
  retryTask,
  snapshot,
  subscribe
} from './runtime'
export { activate, downloadSong } from './runtime'

const labels = {
  waiting: '等待下载',
  setup: '需要设置',
  resolving: '解析资源',
  running: '下载中',
  saving: '保存中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
}
export function DownloadsPage() {
  const view = useSyncExternalStore(subscribe, snapshot)
  const [qr, setQr] = useState<{ key: string; image: string }>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!qr || view.loggedIn) return
    let stopped = false
    let pending = false
    const timer = setInterval(() => {
      if (pending || stopped) return
      pending = true
      void checkLogin(qr.key)
        .then((code) => {
          if (stopped) return
          if (code === 800) {
            setQr(undefined)
            setMessage('二维码已过期，请重新生成')
          } else if (code === 801) setMessage('请使用网易云音乐扫描二维码')
          else if (code === 802) setMessage('已扫码，请在手机上确认登录')
          else if (code === 803) {
            setQr(undefined)
            setMessage('已登录')
          } else {
            setQr(undefined)
            setMessage(`登录失败（${code}），请重试`)
          }
        })
        .catch((error) => {
          if (!stopped) {
            setQr(undefined)
            setMessage(String(error))
          }
        })
        .finally(() => {
          pending = false
        })
    }, 2500)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [qr, view.loggedIn])
  async function run(work: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="library-heading">网易云下载</h1>
          <p className="mt-2 text-sm text-muted-foreground">在网易云歌曲的右键菜单中选择“下载”。</p>
        </div>
        <Button variant="outline" onClick={configure}>
          下载设置
        </Button>
      </div>
      <section className="space-y-3 rounded-xl border border-border p-5" aria-label="下载账号">
        <h2 className="font-semibold">下载账号</h2>
        <p className="text-sm text-muted-foreground">
          {view.loggedIn ? '插件账号已登录。' : '扫码登录插件账号后，等待中的下载将继续。'}
        </p>
        {view.loggedIn ? (
          <Button variant="outline" disabled={busy} onClick={() => void run(logout)}>
            退出下载账号
          </Button>
        ) : (
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setQr(undefined)
                const key = await createLogin()
                const image = await QRCode.toDataURL(
                  `https://music.163.com/login?codekey=${encodeURIComponent(key)}`,
                  { width: 220, margin: 2 }
                )
                setQr({ key, image })
                setMessage('请使用网易云音乐扫码登录')
              })
            }
          >
            {busy ? '正在生成…' : qr ? '刷新二维码' : '扫码登录'}
          </Button>
        )}
        {qr && <img src={qr.image} alt="网易云下载插件登录二维码" width={220} height={220} />}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </section>
      {view.message && (
        <p role="status" className="text-sm">
          {view.message}
        </p>
      )}
      <section aria-label="下载任务" className="space-y-3">
        <h2 className="font-semibold">下载任务</h2>
        {!view.tasks.length && (
          <p className="text-sm text-muted-foreground">暂无下载任务。右键网易云歌曲即可添加。</p>
        )}
        {view.tasks.map((task) => (
          <article key={task.id} className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{task.song.title}</p>
                <p className="text-sm text-muted-foreground">
                  {task.song.artist} · {labels[task.state]}
                  {task.quality ? ` · ${qualityLabels[task.quality]}` : ''}
                </p>
              </div>
              {['failed', 'cancelled', 'setup'].includes(task.state) ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => retryTask(task.id))}
                >
                  重试
                </Button>
              ) : (
                task.state !== 'completed' &&
                task.state !== 'saving' && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => cancelTask(task.id))}
                  >
                    取消
                  </Button>
                )
              )}
            </div>
            {task.state === 'running' && (
              <div>
                <progress
                  className="w-full"
                  aria-label={`${task.song.title} 下载进度`}
                  value={task.bytes}
                  max={task.total || 1}
                />
                <p className="text-xs tabular-nums">
                  {(task.bytes / 1048576).toFixed(1)} / {((task.total || 0) / 1048576).toFixed(1)}{' '}
                  MiB
                </p>
              </div>
            )}
            {task.error && <p className="text-sm text-destructive">{task.error}</p>}
            {task.path && task.state === 'completed' && (
              <p className="break-words text-sm text-muted-foreground">{task.path}</p>
            )}
          </article>
        ))}
      </section>
    </div>
  )
}
