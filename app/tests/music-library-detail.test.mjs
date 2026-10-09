import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import React, { act } from 'react'
import * as jsx from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

test('playlist detail siblings have distinct keys and tabs reset when switching playlists', async () => {
  const source = readFileSync(
    new URL('../src/features/library/music-library.tsx', import.meta.url),
    'utf8'
  )
  const modules = {}
  const placeholder = ({ children }) => React.createElement('div', {}, children)
  const parsed = ts.createSourceFile(
    'music-library.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings))
      modules[statement.moduleSpecifier.text] = Object.fromEntries(
        bindings.elements.map((item) => [item.name.text, placeholder])
      )
  }
  let collection = { kind: 'playlist', id: 18282029444, name: 'First' }
  Object.assign(modules, {
    react: React,
    'react/jsx-runtime': jsx,
    '@tauri-apps/api/core': { isTauri: () => false },
    '@/lib/player': { usePlayer: () => ({ index: null, queue: [] }) },
    '@/features/account/account': { useAccount: () => ({ profile: null }) },
    '@/features/library/collection-actions': { useCollectionActions: () => ({ revision: 0 }) },
    '@/features/workspace/music-navigation': {
      useMusicNavigation: () => ({ page: { view: 'collection', collection } })
    },
    '@/lib/use-paged-list': { usePagedList: () => ({ items: [], more: false, busy: false }) },
    '@/features/library/collection-header': {
      CollectionHeader: ({ collection }) => React.createElement('h1', {}, collection.name)
    },
    '@/features/library/collection-tabs': {
      CollectionTabs: ({ children }) => {
        const [value, setValue] = React.useState(0)
        return React.createElement(
          'section',
          {},
          React.createElement('button', { onClick: () => setValue(value + 1) }, String(value)),
          children
        )
      }
    }
  })
  const exports = {}
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
    }).outputText,
    { exports, require: (name) => modules[name] }
  )
  const dom = new JSDOM('<div id="root"></div>')
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT
  }
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true
  })
  const errors = [],
    originalError = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
  const root = createRoot(document.getElementById('root'))
  const render = () =>
    act(async () =>
      root.render(React.createElement(exports.default, { onError() {}, onNotice() {} }))
    )
  try {
    await render()
    assert.deepEqual(
      errors.filter((error) => error.includes('same key')),
      []
    )
    await act(async () => document.querySelector('section button').click())
    assert.equal(document.querySelector('section button').textContent, '1')
    collection = { ...collection, id: 42, name: 'Second' }
    await render()
    assert.equal(document.querySelectorAll('h1').length, 1)
    assert.equal(document.querySelector('h1').textContent, 'Second')
    assert.equal(document.querySelector('section button').textContent, '0')
    assert.deepEqual(
      errors.filter((error) => error.includes('same key')),
      []
    )
  } finally {
    await act(async () => root.unmount())
    console.error = originalError
    dom.window.close()
    Object.assign(globalThis, {
      window: previous.window,
      document: previous.document,
      IS_REACT_ACT_ENVIRONMENT: previous.act
    })
  }
})
