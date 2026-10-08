export interface PlaybackNoticeMessage {
  id: number
  message: string
}

export function PlaybackNotice({ notice }: { notice?: PlaybackNoticeMessage }) {
  return (
    <div className="playback-notice-slot" role="status" aria-live="polite" aria-atomic="true">
      {notice && (
        <p key={notice.id} className="playback-notice glass-surface">
          {notice.message}
        </p>
      )}
    </div>
  )
}
