import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { errorText, nativeCall } from '@/lib/player'
import {
  getMusicLibrary,
  invalidateMusicLibrary,
  resetAccountCache
} from '@/features/library/library-api'

export interface AccountProfile {
  userId: number
  nickname: string
  avatarUrl: string
}
const AccountContext = createContext<{
  profile: AccountProfile | null
  loading: boolean
  error?: string
  setProfile: (profile: AccountProfile | null) => void
  likedIds: ReadonlySet<number>
  likesReady: boolean
  likesError?: string
  likesRevision: number
  pendingLikes: ReadonlySet<number>
  reloadLikes: () => void
  toggleLike: (id: number) => Promise<void>
} | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const [profile, updateProfile] = useState<AccountProfile | null>(null)
  const [loading, setLoading] = useState(isTauri())
  const [error, setError] = useState<string>()
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set())
  const [likesReady, setLikesReady] = useState(false)
  const [likesError, setLikesError] = useState<string>()
  const [likesRevision, setLikesRevision] = useState(0)
  const [likesRefresh, setLikesRefresh] = useState(0)
  const [pendingLikes, setPendingLikes] = useState<Set<number>>(new Set())
  const likesGeneration = useRef(0)
  const pending = useRef(new Set<number>())
  const generation = useRef(0)
  const setProfile = useCallback((value: AccountProfile | null) => {
    resetAccountCache()
    likesGeneration.current++
    setLikesReady(false)
    setLikedIds(new Set())
    generation.current++
    updateProfile(value)
    setLoading(false)
    setError(undefined)
  }, [])
  useEffect(() => {
    if (!isTauri()) return
    const serial = ++generation.current
    void nativeCall<AccountProfile | null>('account_profile')
      .then((value) => {
        if (generation.current === serial) updateProfile(value)
      })
      .catch((cause) => {
        if (generation.current === serial) setError(errorText(cause))
      })
      .finally(() => {
        if (generation.current === serial) setLoading(false)
      })
    return () => {
      generation.current++
    }
  }, [])
  useEffect(() => {
    const serial = ++likesGeneration.current
    pending.current = new Set()
    setPendingLikes(new Set())
    setLikedIds(new Set())
    setLikesReady(false)
    setLikesError(undefined)
    if (!profile || !isTauri()) return
    void nativeCall<number[]>('liked_song_ids')
      .then((ids) => {
        if (serial === likesGeneration.current) {
          setLikedIds(new Set(ids))
          setLikesReady(true)
        }
      })
      .catch((cause) => {
        if (serial === likesGeneration.current) setLikesError(errorText(cause))
      })
    return () => {
      likesGeneration.current++
    }
  }, [profile, likesRefresh])
  const reloadLikes = useCallback(() => setLikesRefresh((value) => value + 1), [])
  async function toggleLike(id: number) {
    if (!profile || !likesReady || pending.current.has(id)) return
    const serial = likesGeneration.current
    const liked = !likedIds.has(id)
    pending.current.add(id)
    setPendingLikes(new Set(pending.current))
    try {
      await nativeCall('set_song_liked', { id, liked })
      if (serial !== likesGeneration.current) return
      setLikedIds((values) => {
        const next = new Set(values)
        if (liked) next.add(id)
        else next.delete(id)
        return next
      })
      invalidateMusicLibrary()
      void getMusicLibrary(profile.userId).catch(() => {
        /* The library page exposes refresh failures and allows retry. */
      })
      setLikesRevision((value) => value + 1)
    } finally {
      if (serial === likesGeneration.current) {
        pending.current.delete(id)
        setPendingLikes(new Set(pending.current))
      }
    }
  }
  return (
    <AccountContext.Provider
      value={{
        profile,
        loading,
        error,
        setProfile,
        likedIds,
        likesReady,
        likesError,
        likesRevision,
        pendingLikes,
        reloadLikes,
        toggleLike
      }}
    >
      {children}
    </AccountContext.Provider>
  )
}
export function useAccount() {
  const value = useContext(AccountContext)
  if (!value) throw new Error('AccountProvider is required')
  return value
}
