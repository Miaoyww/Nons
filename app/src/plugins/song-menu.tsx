import { ContextMenu } from '@base-ui/react/context-menu'
import { isTauri } from '@tauri-apps/api/core'
import { usePlugins } from './host'
import { checkScope } from './scope'
import { createPluginClient, type PluginClient } from './sdk'
import { songMenuContributions, publicMenuSong } from './song-menu-context'
import { useMusicNavigation } from '@/features/workspace/music-navigation'
import type { Track } from '@/lib/player'

export function PluginSongMenuItems({
  track,
  run
}: {
  track: Track
  run: (work: () => Promise<unknown>, notice?: (result: unknown) => string | undefined) => void
}) {
  const { loaded } = usePlugins()
  const { navigate } = useMusicNavigation()
  if (!isTauri()) return null
  return (
    <>
      {[...loaded.values()]
        .filter((plugin) => plugin.scope.active)
        .flatMap((plugin) =>
          songMenuContributions(plugin.scope.descriptor.manifest, track).map((menu) => (
            <ContextMenu.Item
              key={`${plugin.scope.descriptor.manifest.id}:${menu.id}`}
              onClick={() =>
                run(
                  async () => {
                    checkScope(plugin.scope, 'ui')
                    const handler = plugin.module[menu.export] as (
                      song: ReturnType<typeof publicMenuSong>,
                      client: PluginClient
                    ) => Promise<unknown>
                    const result = await handler(
                      publicMenuSong(track),
                      createPluginClient(plugin.scope, (path) => navigate('plugin', path))
                    )
                    checkScope(plugin.scope)
                    return result
                  },
                  (result) => (typeof result === 'string' ? result.slice(0, 512) : undefined)
                )
              }
            >
              {menu.label}
            </ContextMenu.Item>
          ))
        )}
    </>
  )
}
