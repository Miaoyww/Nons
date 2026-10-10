import { useEffect, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { LogOut, UserPlus } from 'lucide-react'
import { ActionButton } from '@/components/music/action-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { musicClient } from '@/features/music/client'
import { useMusicNavigation } from '@/features/workspace/music-navigation'
import { errorText } from '@/lib/player'
import { AccountAvatar } from './account-avatar'
import { SavedAccounts } from './saved-accounts'
import { useAccountAdapters } from './use-account-adapters'

export function AccountMenu() {
  const { navigate } = useMusicNavigation()
  const { adapters, error, refresh } = useAccountAdapters()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const adapter =
    adapters.find((item) => item.descriptor.source === source) ??
    adapters.find((item) => item.enabled && item.current) ??
    adapters[0]
  const account = adapter?.current
  const selectedSource = adapter?.descriptor.source ?? source
  const sourceName = adapter?.descriptor.displayName ?? '音乐来源'
  const enabled = !!adapter?.enabled
  useEffect(() => {
    setActionError('')
  }, [selectedSource])

  const addAccount = () => {
    setOpen(false)
    navigate('accounts', selectedSource)
  }
  async function logout() {
    setBusy(true)
    setActionError('')
    try {
      const result = await musicClient.account(selectedSource, { operation: 'logout' })
      if (result.type !== 'logout' || !result.data.localCleared)
        throw new Error('退出当前账号失败，请重试。')
      await refresh()
    } catch (cause) {
      setActionError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  if (!account)
    return (
      <ActionButton
        variant="ghost"
        size="sm"
        className="gap-2"
        aria-label="登录音乐账号"
        onClick={addAccount}
      >
        <AccountAvatar />
        未登录
      </ActionButton>
    )
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) void refresh()
      }}
    >
      <Popover.Trigger
        openOnHover
        delay={180}
        closeDelay={250}
        render={<ActionButton variant="ghost" size="sm" className="gap-2" aria-label="音乐账号" />}
      >
        <AccountAvatar avatar={account?.avatar} />
        <span className="max-w-24 truncate">{account?.displayName ?? '未登录'}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              账号来源
              <Select
                value={selectedSource}
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
              <AccountAvatar avatar={account?.avatar} className="size-12" />
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
            {(actionError || error) && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {actionError || error}
              </p>
            )}
            {adapter && (
              <SavedAccounts
                open={open}
                source={selectedSource}
                sourceName={sourceName}
                current={account?.reference}
                enabled={enabled && !busy}
                onChanged={() => void refresh()}
              />
            )}
            <div className="mt-4 border-t border-border pt-3">
              <ActionButton
                variant="ghost"
                className="w-full justify-start"
                disabled={busy}
                onClick={addAccount}
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
  )
}
