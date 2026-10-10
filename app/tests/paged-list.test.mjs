import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function harness() {
  const slots = [],
    effects = [],
    requests = []
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value
        }
      ]
    },
    useRef(initial) {
      return (slots[cursor++] ??= { current: initial })
    },
    useCallback(fn, deps) {
      const index = cursor++,
        old = slots[index]
      if (!old || deps.some((value, i) => value !== old.deps[i])) slots[index] = { deps, fn }
      return slots[index].fn
    },
    useMemo(factory, deps) {
      const index = cursor++,
        old = slots[index]
      if (!old || deps.some((value, i) => value !== old.deps[i]))
        slots[index] = { deps, value: factory() }
      return slots[index].value
    },
    useEffect(fn, deps) {
      const index = cursor++,
        old = slots[index]
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        old?.cleanup?.()
        slots[index] = { deps }
        effects.push(() => {
          slots[index].cleanup = fn()
        })
      }
    }
  }
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/lib/use-paged-list.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  )
  const exports = {}
  runInNewContext(outputText, {
    exports,
    require: (name) => (name === 'react' ? react : { errorText: String })
  })
  const newLoader = () => (offset) =>
    new Promise((resolve, reject) => requests.push({ offset, resolve, reject }))
  let loader = newLoader()
  let size = 50,
    enabled = true
  const render = (flushEffects = true) => {
    cursor = 0
    const value = exports.usePagedList(loader, size, enabled)
    if (flushEffects) while (effects.length) effects.shift()()
    return value
  }
  return {
    render,
    requests,
    switchLoader() {
      loader = newLoader()
    },
    configure(options) {
      size = options.size ?? size
      enabled = options.enabled ?? enabled
    },
    changeQuery() {
      loader = newLoader()
      render()
    }
  }
}
const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test('switching collections to history never exposes collection rows as tracks before effects', async () => {
  const app = harness()
  app.render()
  app.requests[0].resolve({ items: [{ kind: 'playlist', id: 1 }], more: true })
  await settle()
  assert.equal(app.render().items.length, 1)
  app.switchLoader()
  const history = app.render(false)
  // TrackList reads source.kind during render, before the pagination reset effect.
  assert.doesNotThrow(() => history.items.some((track) => track.source.kind === 'netease'))
  assert.equal(history.items.length, 0)
})

test('repeated end-of-list notifications append each page once and stop at the end', async () => {
  const app = harness()
  app.render()
  app.requests[0].resolve({ items: ['first'], more: true })
  await settle()
  const list = app.render()
  const pending = list.loadMore()
  void list.loadMore()
  assert.equal(app.requests.length, 2)
  assert.equal(app.requests[1].offset, 50)
  assert.deepEqual([...app.render().items], ['first'])
  app.requests[1].resolve({ items: ['second'], more: false })
  await pending
  assert.deepEqual([...app.render().items], ['first', 'second'])
  await app.render().loadMore()
  assert.equal(app.requests.length, 2)
})

test('failed continuation preserves results and retries the same offset', async () => {
  const app = harness()
  app.render()
  app.requests[0].resolve({ items: ['first'], more: true })
  await settle()
  const pending = app.render().loadMore()
  app.requests[1].reject(new Error('offline'))
  await pending
  assert.deepEqual([...app.render().items], ['first'])
  assert.match(app.render().error, /offline/)
  const retry = app.render().loadMore()
  assert.equal(app.requests[2].offset, 50)
  app.requests[2].resolve({ items: ['second'], more: false })
  await retry
  assert.deepEqual([...app.render().items], ['first', 'second'])
})

test('query changes discard stale continuation responses', async () => {
  const app = harness()
  app.render()
  app.requests[0].resolve({ items: ['old'], more: true })
  await settle()
  const old = app.render().loadMore()
  app.changeQuery()
  app.requests[2].resolve({ items: ['new'], more: false })
  await settle()
  app.requests[1].resolve({ items: ['stale'], more: true })
  await old
  assert.deepEqual([...app.render().items], ['new'])
  assert.equal(app.render().more, false)
})

test('query changes hide metadata and errors immediately and block continuation before effects', async () => {
  const app = harness()
  app.render()
  app.requests[0].resolve({ items: ['old'], metadata: { title: 'old' }, more: true })
  await settle()
  const pending = app.render().loadMore()
  app.requests[1].reject(new Error('old error'))
  await pending
  assert.match(app.render().error, /old error/)
  app.switchLoader()
  const changed = app.render(false)
  assert.equal(changed.items.length, 0)
  assert.equal(changed.metadata, undefined)
  assert.equal(changed.error, undefined)
  assert.equal(changed.more, false)
  assert.equal(changed.busy, true)
  await changed.loadMore()
  assert.equal(app.requests.length, 2)
  app.render()
  assert.equal(app.requests[2].offset, 0)
})

test('disabling or changing page size hides old rows before effects and restarts at zero', async () => {
  for (const options of [{ enabled: false }, { size: 100 }]) {
    const app = harness()
    app.render()
    app.requests[0].resolve({ items: ['old'], more: true })
    await settle()
    app.configure(options)
    const changed = app.render(false)
    assert.equal(changed.items.length, 0)
    assert.equal(changed.busy, options.enabled !== false)
    await changed.loadMore()
    assert.equal(app.requests.length, 1)
    app.render()
    if (options.enabled === false) {
      assert.equal(app.requests.length, 1)
      app.configure({ enabled: true })
      app.render()
    }
    assert.equal(app.requests[1].offset, 0)
  }
})

test('late first-page success and failure cannot overwrite a replacement query', async () => {
  for (const fail of [false, true]) {
    const app = harness()
    app.render()
    app.changeQuery()
    app.requests[1].resolve({ items: ['new'], metadata: 'new detail', more: false })
    await settle()
    if (fail) app.requests[0].reject(new Error('stale failure'))
    else app.requests[0].resolve({ items: ['old'], metadata: 'old detail', more: true })
    await settle()
    const current = app.render()
    assert.deepEqual([...current.items], ['new'])
    assert.equal(current.metadata, 'new detail')
    assert.equal(current.error, undefined)
    assert.equal(current.more, false)
    assert.equal(current.busy, false)
  }
})
