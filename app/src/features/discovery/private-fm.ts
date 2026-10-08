import type { PlayerSnapshot, Track } from '@/lib/player'

// Lives with the global player connection so navigation cannot stop FM.
export function createPrivateFm(
  getPlayer: () => PlayerSnapshot,
  nativeCall: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
  reportError: (error?: string) => void
) {
  let pending: { session: number } | undefined
  let attempt: string | undefined
  function update() {
    const state = getPlayer()
    const session = state.privateFmSession
    if (session == null) {
      pending = undefined
      attempt = undefined
      return
    }
    if (pending && pending.session !== session) pending = undefined
    if (state.index === null || !['loading', 'playing', 'buffering'].includes(state.status)) return
    const position = state.shuffle ? state.shuffleOrder.indexOf(state.index) : state.index
    if (position < 0 || position < state.queue.length - 2) return
    const tail = state.queue[state.queue.length - 1]?.key
    const nextAttempt = `${session}:${tail}:${state.index}`
    if (pending || attempt === nextAttempt) return
    const request = { session }
    pending = request
    attempt = nextAttempt
    reportError()
    const queueLen = state.queue.length
    void nativeCall<Track[]>('discovery_tracks', { kind: 'fm', refresh: true })
      .then(async (tracks) => {
        if (pending !== request || getPlayer().privateFmSession !== session) return
        const seen = new Set(getPlayer().queue.map((track) => track.key))
        const keys: string[] = []
        for (const track of tracks) {
          if (!seen.has(track.key)) {
            seen.add(track.key)
            keys.push(track.key)
          }
        }
        if (!keys.length) throw new Error('暂时没有新的 FM 歌曲，请重试。')
        await nativeCall('append_private_fm', { session, queueLen, keys })
      })
      .catch((cause) => {
        if (pending !== request || getPlayer().privateFmSession !== session) return
        reportError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (pending !== request) return
        pending = undefined
        update()
      })
  }
  return {
    update,
    retry() {
      attempt = undefined
      update()
    },
    dispose() {
      pending = undefined
      attempt = undefined
    }
  }
}
