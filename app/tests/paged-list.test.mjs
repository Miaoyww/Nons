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
  const render = () => {
    cursor = 0
    const value = exports.usePagedList(loader, 50, true)
    while (effects.length) effects.shift()()
    return value
  }
  return {
    render,
    requests,
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
