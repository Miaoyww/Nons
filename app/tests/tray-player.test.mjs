import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function session() {
  const handlers = new Map()
  const calls = []
  let fmStarts = 0
  let fmUpdates = 0
  const exports = {}
  const state = {
    revision: 1,
    queue: [{ key: 'song' }],
    index: 0,
    status: 'playing',
    positionMs: 0,
    durationMs: 1000
  }
  const modules = {
    react: { useSyncExternalStore() {} },
    '@/features/discovery/private-fm': {
      createPrivateFm() {
        fmStarts++
        return {
          update() {
            fmUpdates++
          },
          dispose() {}
        }
      }
    },
    '@tauri-apps/api/core': {
      isTauri: () => true,
      invoke: async (command) => {
        calls.push(command)
        return state
      }
    },
    '@tauri-apps/api/event': {
      listen: async (event, handler) => {
        handlers.set(event, handler)
        return () => handlers.delete(event)
      }
    },
    '@/lib/runtime-cache': { cachedCommands: new Set(), invalidateNativeCache() {} }
  }
  const source = readFileSync(new URL('../src/lib/player.ts', import.meta.url), 'utf8')
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      performance: { now: () => 0 },
      require: (name) => {
        assert.ok(name in modules, name)
        return modules[name]
      }
    }
  )
  return { ...exports, handlers, calls, fmStarts: () => fmStarts, fmUpdates: () => fmUpdates }
}

test('tray observes current song updates without FM continuation or progress listeners and cleans up', async () => {
  const app = session()
  const stop = await app.connectPlayer({ observer: true })
  assert.equal(app.fmStarts(), 0)
  assert.deepEqual([...app.handlers.keys()], ['player-state'])
  assert.deepEqual(app.calls, ['player_snapshot'])
  assert.equal(app.getPlayer().queue[0].key, 'song')
  app.handlers.get('player-state')({
    payload: { ...app.getPlayer(), revision: 2, status: 'paused', queue: [{ key: 'next' }] }
  })
  assert.equal(app.getPlayer().queue[0].key, 'next')
  assert.equal(app.getPlayer().status, 'paused')
  assert.equal(app.fmUpdates(), 0)
  stop()
  assert.equal(app.handlers.size, 0)
})

test('main player retains FM continuation and progress synchronization', async () => {
  const app = session()
  const stop = await app.connectPlayer()
  assert.equal(app.fmStarts(), 1)
  assert.equal(app.fmUpdates(), 1)
  assert.deepEqual([...app.handlers.keys()], ['player-state', 'player-progress', 'lyrics-updated'])
  stop()
  assert.equal(app.handlers.size, 0)
})
