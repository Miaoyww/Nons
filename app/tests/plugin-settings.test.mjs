import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

test('plugin settings scopes native drops, serializes ZIP installs and removes its listener', async () => {
  const dom = new JSDOM('<section aria-label="插件设置"><div id="root"></div></section>')
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(window, 'devicePixelRatio', { value: 2 })
  document.querySelector('section').getBoundingClientRect = () => ({
    left: 100,
    top: 50,
    right: 700,
    bottom: 500
  })
  let listener, finishInstall
  let cleanups = 0
  const calls = []
  let plugins = []
  const modules = {
    '../plugins/configuration-page': { PluginConfigurationPage: 'div' },
    react: React,
    'react/jsx-runtime': jsx,
    '@tauri-apps/api/core': { isTauri: () => true },
    '@tauri-apps/api/webview': {
      getCurrentWebview: () => ({
        onDragDropEvent: async (fn) => {
          listener = fn
          return () => cleanups++
        }
      })
    },
    '@tauri-apps/plugin-dialog': { open: async () => 'chosen.zip' },
    'lucide-react': Object.fromEntries(
      ['FolderOpen', 'RefreshCw', 'RotateCw', 'Search', 'Settings', 'Trash2', 'Upload'].map(
        (name) => [name, 'svg']
      )
    ),
    '@/components/ui/button': {
      Button: ({ variant: _variant, size: _size, ...props }) => React.createElement('button', props)
    },
    '@/components/ui/input': { Input: 'input' },
    '@/components/ui/switch': {
      Switch: ({ onCheckedChange, ...props }) =>
        React.createElement('input', {
          ...props,
          type: 'checkbox',
          role: 'switch',
          onChange: (event) => onCheckedChange(event.target.checked)
        })
    },
    '@/plugins/host': { usePlugins: () => ({ plugins }) },
    '@/lib/player': {
      errorText: (error) => error.message,
      nativeCall: async (command, args) => {
        calls.push([command, args])
        if (args?.path === 'bad.zip') throw new Error('损坏的插件包')
        if (args?.path === 'slow.zip')
          await new Promise((resolve) => {
            finishInstall = resolve
          })
      }
    }
  }
  const exports = {}
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/features/settings/pages/plugins.tsx', import.meta.url), 'utf8'),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
      }
    ).outputText,
    {
      exports,
      window,
      require: (name) => {
        assert.ok(name in modules, name)
        return modules[name]
      }
    }
  )
  const root = createRoot(document.getElementById('root'))
  const emit = async (type, paths = [], position = { x: 400, y: 200 }) =>
    React.act(async () => listener({ payload: { type, paths, position } }))
  try {
    await React.act(async () => root.render(React.createElement(exports.PluginsPage)))
    await emit('drop', ['outside.zip'], { x: 20, y: 20 })
    assert.equal(calls.length, 0)
    await emit('enter', ['one.zip'])
    assert.match(document.body.textContent, /松开即可安装/)
    await emit('leave')
    assert.doesNotMatch(document.body.textContent, /松开即可安装/)
    await emit('drop', ['one.zip', 'notes.txt'])
    assert.equal(calls.length, 0)
    assert.match(document.querySelector('[role="alert"]').textContent, /\.zip/)
    await emit('drop', ['bad.zip', 'ONE.ZIP', 'ONE.ZIP'])
    assert.deepEqual(
      calls.map(([, args]) => args.path),
      ['bad.zip', 'ONE.ZIP']
    )
    assert.match(document.querySelector('[role="alert"]').textContent, /bad.zip：损坏的插件包/)
    await emit('drop', ['slow.zip'])
    await emit('drop', ['ignored.zip'])
    assert.deepEqual(
      calls.map(([, args]) => args.path),
      ['bad.zip', 'ONE.ZIP', 'slow.zip']
    )
    await React.act(async () => finishInstall())
    assert.equal(document.querySelector('[aria-busy]').getAttribute('aria-busy'), 'false')
    await React.act(async () =>
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent.includes('打开文件夹'))
        .click()
    )
    assert.equal(calls.at(-1)[0], 'plugin_open_folder')
    plugins = [
      {
        manifest: {
          id: 'download',
          name: '下载管理',
          version: '1.1.0',
          permissions: ['ui', 'account:credentials', 'http:request', 'http:transfer'],
          httpHosts: ['*']
        },
        enabled: false,
        loaded: false
      }
    ]
    await React.act(async () => root.render(React.createElement(exports.PluginsPage)))
    await React.act(async () =>
      [...document.querySelectorAll('button')]
        .find((button) => button.textContent === '启用')
        .click()
    )
    assert.match(document.body.textContent, /敏感权限：读取 NonsPlayer 的网易云账户凭证/)
    const warning = [...document.querySelectorAll('[role="alert"]')].find((element) =>
      element.textContent.includes('登录 Cookie')
    )
    assert.ok(warning.className.includes('text-destructive'))
    assert.match(document.body.textContent, /敏感权限：请求任意网络域名/)
    assert.match(document.body.textContent, /敏感权限：从任意网络域名传输资源到授权目录/)
    const networkWarning = [...document.querySelectorAll('[role="alert"]')].find((element) =>
      element.textContent.includes('此插件可访问任意网络域名')
    )
    assert.ok(networkWarning.className.includes('text-destructive'))
    assert.match(networkWarning.textContent, /Cookie 也可能被发送到其他网站/)
    const clickButton = async (text) =>
      React.act(async () =>
        [...document.querySelectorAll('button')]
          .find((button) => button.textContent === text)
          .click()
      )
    const beginUninstall = async () =>
      React.act(async () => document.querySelector('[aria-label="卸载 下载管理"]').click())
    await clickButton('取消')
    await beginUninstall()
    assert.equal(document.querySelector('[role="switch"]').checked, true)
    await React.act(async () => document.querySelector('[role="switch"]').click())
    await clickButton('取消')
    await beginUninstall()
    assert.equal(document.querySelector('[role="switch"]').checked, true)
    await clickButton('确认卸载')
    assert.equal(calls.at(-1)[1].action, 'uninstall-keep-data')
    await beginUninstall()
    await React.act(async () => document.querySelector('[role="switch"]').click())
    await clickButton('确认卸载')
    assert.equal(calls.at(-1)[1].action, 'uninstall')
    const finalCall = calls.at(-1)
    await React.act(async () => root.unmount())
    assert.equal(cleanups, 1)
    await emit('drop', ['after-unmount.zip'])
    assert.equal(calls.at(-1), finalCall)
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
    delete globalThis.window
    delete globalThis.document
    delete globalThis.IS_REACT_ACT_ENVIRONMENT
  }
})
