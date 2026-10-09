import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

function load(path, modules) {
  const exports = {}
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in modules, name)
        return modules[name]
      }
    }
  )
  return exports
}
function harness(
  permissions,
  { listen = async () => () => {}, nativeCall = async () => 'null' } = {}
) {
  const scope = {
    active: true,
    descriptor: { generation: 7, manifest: { id: 'sample', permissions } }
  }
  const react = {
    createContext: () => ({}),
    useContext: () => scope,
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn()
  }
  const scopes = load('../src/plugins/scope.tsx', { react })
  const sdk = load('../src/plugins/sdk.ts', {
    react,
    './scope': scopes,
    './types': {},
    './song-components': {},
    '@tauri-apps/api/event': { listen },
    '@/lib/player': { nativeCall },
    '@/features/settings/use-theme': {},
    '@/components/music/use-cover-source': {},
    '@/features/workspace/music-navigation': {},
    '@/components/ui/button': {}
  })
  return { scope, sdk }
}

test('clipboard subscription filters identity and generation and cleans up without replay', async () => {
  let listener,
    disposed = 0
  const { scope, sdk } = harness(['clipboard:read'], {
    listen: async (event, callback) => {
      assert.equal(event, 'plugin-clipboard-changed')
      listener = callback
      return () => disposed++
    }
  })
  const received = []
  const unsubscribe = await sdk.usePluginClipboard().subscribe((text) => received.push(text))
  assert.deepEqual(received, [])
  const emit = (pluginId, generation, text) => listener({ payload: { pluginId, generation, text } })
  emit('other', 7, 'private')
  emit('sample', 6, 'stale')
  emit('sample', 7, 'plain text without a link')
  emit('sample', 7, '')
  assert.deepEqual(received, ['plain text without a link', ''])
  unsubscribe()
  unsubscribe()
  emit('sample', 7, 'late')
  assert.equal(disposed, 1)
  assert.equal(scope.cleanups.size, 0)
  const cleanup = await sdk.usePluginClipboard().subscribe((text) => received.push(text))
  scope.active = false
  scope.cleanups.forEach((fn) => fn())
  emit('sample', 7, 'disabled')
  assert.equal(disposed, 2)
  cleanup()
  assert.deepEqual(received, ['plain text without a link', ''])
})

test('new capabilities reject missing permission and late subscription or read results', async () => {
  const denied = harness([]).sdk
  assert.throws(() => denied.usePluginClipboard(), /clipboard:read/)
  assert.throws(() => denied.usePluginHttp(), /http:request/)
  let finishListen,
    finishRead,
    disposed = 0
  const { scope, sdk } = harness(['clipboard:read'], {
    listen: () =>
      new Promise((resolve) => {
        finishListen = resolve
      }),
    nativeCall: () =>
      new Promise((resolve) => {
        finishRead = resolve
      })
  })
  const clipboard = sdk.usePluginClipboard()
  const subscribed = clipboard.subscribe(() => {})
  const read = clipboard.readText()
  scope.active = false
  finishListen(() => disposed++)
  finishRead('"late text"')
  await assert.rejects(subscribed, /禁用/)
  await assert.rejects(read, /禁用/)
  assert.equal(disposed, 1)
})

test('HTTP and Netease facades bind host requests to the plugin instance', async () => {
  const calls = []
  const { sdk } = harness(['http:request', 'music:metadata'], {
    nativeCall: async (command, args) => {
      calls.push({ command, ...args })
      return args.operation === 'http.request'
        ? '{"status":302,"headers":{"location":"/next"},"body":""}'
        : 'null'
    }
  })
  const request = { url: 'https://example.org/', responseType: 'none' }
  const response = await sdk.usePluginHttp().request(request)
  assert.equal(response.status, 302)
  assert.equal(response.headers.location, '/next')
  await sdk.useNetease().getSong(123)
  await sdk.useNetease().playSong(123, 'next')
  assert.deepEqual(
    calls.map((call) => call.operation),
    ['http.request', 'netease.get-song', 'netease.play-song']
  )
  for (const call of calls) {
    assert.equal(call.command, 'plugin_host_call')
    assert.equal(call.id, 'sample')
    assert.equal(call.generation, 7)
  }
  assert.deepEqual(JSON.parse(calls[0].args), request)
})
