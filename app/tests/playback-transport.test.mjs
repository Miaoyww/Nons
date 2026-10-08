import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function harness(state) {
  const calls = []
  const jsx = (type, props) => ({ type, props })
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': {},
    '@tauri-apps/api/core': { isTauri: () => true },
    '@/components/music/action-button': { ActionButton: 'button' },
    '@/features/playback/music-options': {},
    '@/features/playback/playback-timeline': {},
    '@/features/playback/player-slider': {},
    '@/features/playback/playback-transport': { PlaybackTransport: 'transport' },
    react: { useEffect() {}, useState: (value) => [value, () => {}] },
    '@/lib/player': {
      usePlayer: () => state,
      adjacentIndex: () => null,
      nativeCall: async (command, args) => calls.push({ command, ...args })
    }
  }
  function load(file) {
    const exports = {}
    runInNewContext(
      ts.transpileModule(
        readFileSync(new URL(`../src/features/playback/${file}.tsx`, import.meta.url), 'utf8'),
        {
          compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
        }
      ).outputText,
      { exports, require: (name) => modules[name] }
    )
    return exports
  }
  return {
    calls,
    transport: load('playback-transport').PlaybackTransport,
    controls: load('now-playing-controls').NowPlayingControls
  }
}

test('fullscreen controls expose shuffle and repeat through the shared transport', () => {
  const app = harness({ volume: 0.8 })
  const children = app.controls({ onError() {}, onQueue() {} }).props.children
  assert.equal(children.find((child) => child.type === 'transport').props.withModes, true)
})

test('transport exposes mode states and sends one playback command per click', () => {
  for (const repeatMode of ['off', 'all', 'one']) {
    const app = harness({ status: 'paused', index: 0, shuffle: repeatMode === 'off', repeatMode })
    const children = app.transport({ withModes: true, onError() {} }).props.children.filter(Boolean)
    const shuffle = children[0].props
    const repeat = children.at(-1).props
    assert.equal(shuffle['aria-pressed'], repeatMode === 'off')
    assert.equal(repeat['aria-pressed'], repeatMode !== 'off')
    assert.match(
      repeat['aria-label'],
      new RegExp({ off: '顺序播放', all: '列表循环', one: '单曲循环' }[repeatMode])
    )
    shuffle.onClick()
    repeat.onClick()
    assert.deepEqual(
      app.calls.map((call) => call.action),
      ['shuffle', 'repeat']
    )
    assert.ok(app.calls.every((call) => call.command === 'player_action'))
  }
})
