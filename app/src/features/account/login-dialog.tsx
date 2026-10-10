import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Popover } from '@base-ui/react/popover'
import { LogOut, UserRound, UserPlus } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle
} from '@/components/animate-ui/components/base/dialog'
import { errorText, nativeCall } from '@/lib/player'
import { musicClient } from '@/features/music/client'
import type { AccountRecord, SourceDescriptor } from '@/features/music/types'
import { ActionButton } from '@/components/music/action-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SavedAccounts } from './saved-accounts'

interface AdapterStatus {
  descriptor: SourceDescriptor
  enabled: boolean
}
interface Qr {
  key: string
  image: string
}

export function LoginDialog() {
  const [accountOpen, setAccountOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [adapters, setAdapters] = useState<AdapterStatus[]>([])
  const [source, setSource] = useState('netease')
  const [account, setAccount] = useState<AccountRecord | null>(null)
  const [accountError, setAccountError] = useState('')
  const [revision, setRevision] = useState(0)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [qr, setQr] = useState<Qr>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const adapter = adapters.find((item) => item.descriptor.source === source)
  const sourceName = adapter?.descriptor.displayName ?? source
  const enabled = !!adapter?.enabled

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    const stops: (() => void)[] = []
    const refresh = () => setRevision((value) => value + 1)
    for (const event of ['music-account-changed', 'adapters-changed']) {
      void listen(event, refresh)
        .then((stop) => {
          if (disposed) stop()
          else stops.push(stop)
        })
        .catch((cause) => {
          if (!disposed) setAccountError(errorText(cause))
        })
    }
    return () => {
      disposed = true
      stops.forEach((stop) => stop())
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void nativeCall<AdapterStatus[]>('adapter_list')
      .then((items) => {
        if (disposed) return
        const available = items.filter((item) => item.descriptor.capabilities.includes('account'))
        setAdapters(available)
        if (!available.some((item) => item.descriptor.source === source))
          setSource(available[0]?.descriptor.source ?? '')
      })
      .catch((cause) => {
        if (!disposed) setAccountError(errorText(cause))
      })
    return () => {
      disposed = true
    }
  }, [source, revision, accountOpen])

  useEffect(() => {
    let disposed = false
    setAccount(null)
    setAvatarFailed(false)
    setAccountError('')
    if (isTauri() && source)
      void musicClient
        .currentAccount(source)
        .then((value) => {
          if (!disposed) setAccount(value)
        })
        .catch((cause) => {
          if (!disposed) setAccountError(errorText(cause))
        })
    return () => {
      disposed = true
    }
  }, [source, revision])

  async function generate() {
    const serial = ++generation.current
    setBusy(true)
    setQr(undefined)
    setMessage('正在生成二维码…')
    try {
      const result = await musicClient.account(source, { operation: 'beginLogin' })
      if (result.type !== 'challenge') throw new Error('此适配器未返回可展示的登录二维码。')
      if (serial === generation.current) {
        setQr(result.data)
        setMessage(`请使用${sourceName}扫码登录。`)
      }
    } catch (cause) {
      if (serial === generation.current) setMessage(errorText(cause))
    } finally {
      if (serial === generation.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!open || !qr) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await musicClient.account(source, { operation: 'pollLogin', key: qr.key })
        if (disposed) return
        if (result.type !== 'progress') throw new Error('登录状态响应无效。')
        setMessage(result.data.message)
        if (result.data.code === 803) {
          setRevision((value) => value + 1)
          setQr(undefined)
          setOpen(false)
          return
        }
        if (result.data.code === 800) {
          setQr(undefined)
          return
        }
      } catch (cause) {
        if (!disposed) setMessage(errorText(cause))
      }
      if (!disposed) timer = setTimeout(() => void poll(), 4000)
    }
    timer = setTimeout(() => void poll(), 4000)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [open, qr, source])

  async function logout() {
    setBusy(true)
    setAccountError('')
    try {
      const result = await musicClient.account(source, { operation: 'logout' })
      if (result.type !== 'logout' || !result.data.localCleared)
        throw new Error('退出当前账号失败，请重试。')
      setAccount(null)
      setRevision((value) => value + 1)
    } catch (cause) {
      setAccountError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const savedAccounts = (visible: boolean) =>
    source ? (
      <SavedAccounts
        open={visible}
        source={source}
        sourceName={sourceName}
        current={account?.reference}
        enabled={enabled}
        onChanged={() => setRevision((value) => value + 1)}
      />
    ) : null

  return (
    <div className="flex items-center gap-1">
      <Popover.Root open={accountOpen} onOpenChange={setAccountOpen}>
        <Popover.Trigger
          openOnHover
          delay={180}
          closeDelay={250}
          render={
            <ActionButton variant="ghost" size="sm" className="gap-2" aria-label="音乐账号" />
          }
        >
          {account?.avatar && !avatarFailed ? (
            <img
              src={account.avatar}
              alt=""
              className="size-6 rounded-full object-cover"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <UserRound aria-hidden="true" />
          )}
          <span className="max-w-24 truncate">{account?.displayName ?? '未登录'}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
            <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
              <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                账号来源
                <Select
                  value={source}
                  disabled={busy}
                  items={adapters.map((item) => ({
                    value: item.descriptor.source,
                    label: `${item.descriptor.displayName}${item.enabled ? '' : '（已停用）'}`
                  }))}
                  onValueChange={(value) => {
                    if (value) setSource(value)
                  }}
                >
                  <SelectTrigger size="sm" aria-label="账号适配器来源" className="min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {adapters.map((item) => (
                      <SelectItem key={item.descriptor.source} value={item.descriptor.source}>
                        {item.descriptor.displayName}
                        {item.enabled ? '' : '（已停用）'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                {account?.avatar && !avatarFailed ? (
                  <img
                    src={account.avatar}
                    alt=""
                    className="size-12 rounded-full object-cover"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <UserRound className="size-12 rounded-full bg-muted p-3" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <Popover.Title className="truncate text-sm font-semibold">
                    {account?.displayName ?? '未登录'}
                  </Popover.Title>
                  <Popover.Description className="mt-1 text-xs text-muted-foreground">
                    {!enabled
                      ? '适配器已停用，保存的账号仍会保留'
                      : account
                        ? '当前账号已登录'
                        : '选择保存的账号或添加账号'}
                  </Popover.Description>
                </div>
              </div>
              {accountError && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {accountError}
                </p>
              )}
              {savedAccounts(accountOpen)}
              <div className="mt-4 border-t border-border pt-3">
                <ActionButton
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={busy || !enabled}
                  onClick={() => {
                    setAccountOpen(false)
                    setOpen(true)
                    if (isTauri()) void generate()
                  }}
                >
                  <UserPlus aria-hidden="true" />
                  添加账号
                </ActionButton>
                {account && (
                  <ActionButton
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={busy || !enabled}
                    onClick={() => void logout()}
                  >
                    <LogOut aria-hidden="true" />
                    {busy ? '正在退出…' : '退出当前账号'}
                  </ActionButton>
                )}
                <p className="mt-2 text-xs text-muted-foreground">退出保留保存的账号和登录凭据。</p>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) {
            generation.current++
            setQr(undefined)
            setBusy(false)
          }
        }}
      >
        <DialogPopup className="max-w-sm">
          <DialogTitle>{sourceName}</DialogTitle>
          <DialogDescription>使用{sourceName}扫描二维码，并确认登录。</DialogDescription>
          <div className="flex min-h-64 items-center justify-center">
            {qr ? (
              <img
                src={qr.image}
                width={224}
                height={224}
                alt={`${sourceName}登录二维码`}
                className="rounded-lg bg-white"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {!isTauri()
                  ? '请在桌面应用中扫码登录。'
                  : busy
                    ? '正在生成二维码…'
                    : '点击下方按钮生成登录二维码。'}
              </p>
            )}
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
          {savedAccounts(open)}
          <div className="mt-4 flex justify-end gap-2">
            <ActionButton
              variant="secondary"
              disabled={busy || !enabled || !isTauri()}
              onClick={() => void generate()}
            >
              重新生成
            </ActionButton>
            <DialogClose render={<ActionButton variant="outline" />}>关闭</DialogClose>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
