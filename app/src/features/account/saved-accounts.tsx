import { useEffect, useRef, useState } from 'react'
import { Check, RefreshCw, Trash2, UserRound } from 'lucide-react'
import { ActionButton } from '@/components/music/action-button'
import { musicClient } from '@/features/music/client'
import type { AccountRecord, AccountRef } from '@/features/music/types'
import { errorText } from '@/lib/player'

export function SavedAccounts({
  open,
  source,
  sourceName,
  current,
  enabled = true,
  onChanged
}: {
  open: boolean
  source: string
  sourceName: string
  current?: AccountRef
  enabled?: boolean
  onChanged?: () => void
}) {
  const [records, setRecords] = useState<AccountRecord[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string>()
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    const serial = ++generation.current
    if (!open) return
    setBusy(true)
    setError('')
    setRemoving(undefined)
    setRecords([])
    void musicClient
      .accounts(source)
      .then((result) => {
        if (serial === generation.current) setRecords(result)
      })
      .catch((cause) => {
        if (serial === generation.current) setError(errorText(cause))
      })
      .finally(() => {
        if (serial === generation.current) setBusy(false)
      })
    return () => {
      generation.current++
    }
  }, [open, source, current?.source, current?.id, revision])
  async function change(record: AccountRecord, remove = false) {
    const serial = generation.current
    setBusy(true)
    setError('')
    try {
      if (remove) await musicClient.removeAccount(record.reference)
      else await musicClient.selectAccount(record.reference)
      if (serial === generation.current) {
        setRemoving(undefined)
        setRevision((value) => value + 1)
        onChanged?.()
      }
    } catch (cause) {
      if (serial === generation.current) setError(errorText(cause))
    } finally {
      if (serial === generation.current) setBusy(false)
    }
  }
  if (!open) return null
  return (
    <section aria-label={`保存的${sourceName}账号`} className="mt-4 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">保存的账号</p>
        <ActionButton
          variant="ghost"
          size="icon-sm"
          aria-label="刷新保存的账号"
          disabled={busy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" />
        </ActionButton>
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          正在处理账号…
        </p>
      )}
      {error && (
        <p role="alert" className="my-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="max-h-56 overflow-y-auto">
        {records.map((record) => (
          <div key={record.reference.id} className="mt-2">
            <div className="flex items-center gap-2">
              <ActionButton
                variant="ghost"
                className="min-w-0 flex-1 justify-start"
                disabled={
                  busy ||
                  !enabled ||
                  (record.reference.source === current?.source &&
                    record.reference.id === current?.id)
                }
                aria-pressed={
                  record.reference.source === current?.source && record.reference.id === current?.id
                }
                onClick={() => void change(record)}
              >
                {record.reference.source === current?.source &&
                record.reference.id === current?.id ? (
                  <Check aria-hidden="true" />
                ) : (
                  <UserRound aria-hidden="true" />
                )}
                <span className="truncate">{record.displayName}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{sourceName}</span>
              </ActionButton>
              <ActionButton
                variant="ghost"
                size="icon-sm"
                aria-label={`删除保存的账号 ${record.displayName}`}
                disabled={busy}
                onClick={() => setRemoving(record.reference.id)}
              >
                <Trash2 aria-hidden="true" />
              </ActionButton>
            </div>
            {removing === record.reference.id && (
              <div className="rounded-md bg-muted p-2 text-sm">
                <p>删除保存的账号及登录凭据？</p>
                <div className="mt-2 flex justify-end gap-2">
                  <ActionButton
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRemoving(undefined)}
                  >
                    取消
                  </ActionButton>
                  <ActionButton
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void change(record, true)}
                  >
                    确定删除
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {!busy && !records.length && !error && (
        <p className="mt-2 text-sm text-muted-foreground">暂无保存的账号。</p>
      )}
    </section>
  )
}
