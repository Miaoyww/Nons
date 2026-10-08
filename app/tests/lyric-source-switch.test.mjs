import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const local = {
  key: 'local:disney',
  title: 'Mad at Disney',
  durationMs: 135000,
  source: { kind: 'local', path: 'disney.mp3', neteaseId: null }
}
const streamed = {
  key: 'ncm:disney',
  title: 'Mad at Disney',
  durationMs: 136000,
  source: { kind: 'netease', id: 1 }
}
const localLyrics = { source: 'qq', format: 'lrc', content: 'local line lyrics' }
const streamLyrics = {
  source: 'netease',
  format: 'yrc',
  content: 'stream word lyrics with translation'
}

function harness(track) {
  let player = { queue: [track], index: 0, status: 'playing', revision: 0 }
  const states = []
  const effects = []
  const events = []
  const pending = []
  const parsed = []
  let cursor = 0
  const jsx = (type, props) => ({ type, props })
  const modules = {
    react: {
      useState(initial) {
        const index = cursor++
        states[index] ??= { value: typeof initial === 'function' ? initial() : initial }
        return [
          states[index].value,
          (value) => {
            states[index].value = typeof value === 'function' ? value(states[index].value) : value
          }
        ]
      },
      useRef(value) {
        const index = cursor++
        states[index] ??= { value: { current: value } }
        return states[index].value
      },
      useEffect: (fn) => effects.push(fn),
      useCallback: (fn) => fn,
      useMemo: (fn) => fn()
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/player': { usePlayer: () => player, getPlayer: () => player, errorText: String },
    '@/features/lyrics/load-lyrics': {
      loadLyrics: (_track, _refresh, _sources, apply, isCurrent) =>
        new Promise((resolve) => {
          pending.push((value) => {
            if (isCurrent()) apply(value)
            resolve(null)
          })
        })
    },
    '@/features/lyrics/parse-lyrics': {
      EmptyLyricsError: class extends Error {},
      parseLyrics: (value) => {
        parsed.push(value)
        return [{ words: [], translatedLyric: '', romanLyric: '' }]
      }
    },
    '@/features/local/use-local-preferences': { useLocalPreferences: () => ({ options: {} }) },
    '@/features/lyrics/use-lyric-sources': {
      useLyricSources: () => ({ sources: { amll: true, qq: true } })
    },
    '@tauri-apps/api/core': { isTauri: () => true },
    '@tauri-apps/api/event': {
      listen: async (_name, fn) => {
        events.push(fn)
        return () => {}
      }
    },
    'motion/react': {
      motion: { section: 'section' },
      useIsPresent: () => true,
      useReducedMotion: () => false
    }
  }
  const exports = {}
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/features/lyrics/lyrics-view.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
  )
  runInNewContext(outputText, { exports, require: (name) => modules[name] ?? {} })
  const render = () => {
    cursor = 0
    return exports.default({ onQueue() {} })
  }
  render()
  effects.forEach((fn) => fn())
  return {
    parsed,
    pending,
    events,
    render,
    switchTo: (next) => {
      player = { ...player, queue: [next], revision: player.revision + 1 }
    }
  }
}

test('a local lyrics response cannot replace stream lyrics after playback switches, before React effects clean up', async () => {
  const app = harness(local)
  app.switchTo(streamed)
  app.pending[0](localLyrics)
  await Promise.resolve()
  assert.equal(app.parsed.length, 0, 'late local lyrics were applied while the stream was active')
})

test('local background lyrics updates are rejected immediately when the active source switches to streaming', async () => {
  const app = harness(local)
  app.pending[0](localLyrics)
  await Promise.resolve()
  assert.equal(app.parsed.length, 1)
  app.switchTo(streamed)
  app.events[0]({ payload: { key: local.key, lyrics: localLyrics } })
  assert.equal(
    app.parsed.length,
    1,
    'old local listener replaced the stream before its cleanup ran'
  )
})

test('stream lyrics responses are likewise rejected after switching to a local source', async () => {
  const app = harness(streamed)
  app.switchTo(local)
  app.pending[0](streamLyrics)
  await Promise.resolve()
  assert.equal(app.parsed.length, 0)
})

test('returning to the same song rejects responses from its previous playback instance', async () => {
  const app = harness(streamed)
  app.switchTo(local)
  app.switchTo(streamed)
  app.pending[0](streamLyrics)
  await Promise.resolve()
  assert.equal(app.parsed.length, 0)
})

test('the first stream render hides local lyrics even before the new loading effect runs', async () => {
  const app = harness(local)
  app.pending[0](localLyrics)
  await Promise.resolve()
  const renderedLines = (tree) => {
    if (!tree || typeof tree !== 'object') return 0
    if (tree.type?.name === 'LyricRenderer') return tree.props.lines.length
    return [tree.props?.children].flat().reduce((count, child) => count + renderedLines(child), 0)
  }
  assert.equal(renderedLines(app.render()), 1)
  app.switchTo(streamed)
  assert.equal(renderedLines(app.render()), 0)
})

test('active stream lyrics and translations still apply normally', async () => {
  const app = harness(streamed)
  app.pending[0](streamLyrics)
  await Promise.resolve()
  assert.deepEqual(app.parsed, [streamLyrics])
})
