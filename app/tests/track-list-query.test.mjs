import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as jsx from 'react/jsx-runtime'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

async function harness(run) {
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
  const tracks = [
    { key: 'a', title: 'Zulu', artist: 'Alpha', album: 'Second', durationMs: 3000 },
    {
      key: 'b',
      title: '白夜',
      aliases: ['Midnight'],
      artist: 'Beta',
      album: 'First',
      durationMs: 1000
    },
    { key: 'a', title: 'Zulu', artist: 'Alpha', album: 'Second', durationMs: 3000 }
  ].map((track) => ({ ...track, source: { kind: 'local' }, cover: '' }))
  const plays = [],
    removes = [],
    menus = []
  const virtualizer = {
    measure() {},
    measureElement() {},
    getTotalSize: () => 0,
    scrollToIndex() {},
    getVirtualItems: () => []
  }
  const modules = {
    react: React,
    'react/jsx-runtime': jsx,
    '@tanstack/react-virtual': {
      useVirtualizer: ({ count }) => {
        virtualizer.getVirtualItems = () =>
          Array.from({ length: count }, (_, index) => ({ index, start: 0, end: 0 }))
        return virtualizer
      }
    },
    '@/components/music/infinite-load': { scrollParent: () => null },
    '@/components/ui/select': {
      Select: ({ value, onValueChange, children }) =>
        React.createElement(
          'div',
          {},
          React.createElement(
            'select',
            {
              'aria-label': 'test sort',
              value,
              onChange: (event) => onValueChange(event.target.value)
            },
            ['default', 'title', 'artist', 'album', 'duration'].map((value) =>
              React.createElement('option', { key: value, value }, value)
            )
          ),
          children
        ),
      SelectContent: () => null,
      SelectItem: () => null,
      SelectTrigger: () => null,
      SelectValue: () => null
    },
    '@/components/ui/input': { Input: (props) => React.createElement('input', props) },
    '@/components/music/music-links': { TrackAlbum: ({ track }) => track.album },
    '@/components/music/action-button': {
      ActionButton: ({ size, variant, ...props }) => React.createElement('button', props)
    },
    '@/components/music/cover': { Cover: () => null },
    '@/components/music/track-identity': {
      TrackIdentity: ({ track, cover }) => React.createElement('div', {}, cover, track.title)
    },
    '@/components/music/song-actions': {
      SongContextMenu: ({ render, children, ...props }) => {
        menus.push(props)
        return React.cloneElement(render, {}, children)
      }
    },
    '@/features/account/account': {
      useAccount: () => ({ likedIds: new Set(), pendingLikes: new Set() })
    },
    '@/features/settings/use-interface-density': { useInterfaceDensity: () => ['compact'] },
    '@/lib/player': { errorText: String, formatTime: String },
    'lucide-react': Object.fromEntries(
      ['Heart', 'ListPlus', 'Play', 'Search', 'ArrowUpDown', 'ArrowUp', 'ArrowDown'].map((name) => [
        name,
        () => null
      ])
    )
  }
  const exports = {}
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/music/track-list.tsx', import.meta.url), 'utf8'),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
      }
    ).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in modules, name)
        return modules[name]
      },
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      }
    }
  )
  const root = createRoot(document.getElementById('root'))
  const render = async (props = {}) => {
    menus.length = 0
    await act(async () =>
      root.render(
        React.createElement(exports.TrackList, {
          tracks,
          busy: false,
          searchable: true,
          onPlay: (...args) => plays.push(args),
          onRemove: (...args) => removes.push(args),
          ...props
        })
      )
    )
  }
  const search = async (value) => {
    const input = document.querySelector('input')
    const propsKey = Object.keys(input).find((key) => key.startsWith('__reactProps'))
    await act(async () => input[propsKey].onChange({ target: { value } }))
  }
  try {
    await render()
    await run({ tracks, plays, removes, menus, render, search, dom })
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    Object.assign(globalThis, {
      window: previous.window,
      document: previous.document,
      IS_REACT_ACT_ENVIRONMENT: previous.act
    })
  }
}

test('list search matches aliases, artists and albums and plays the filtered queue', async () => {
  await harness(async ({ plays, search }) => {
    for (const query of [' MIDNIGHT ', 'beta', 'first']) {
      await search(query)
      const buttons = document.querySelectorAll('.track-cover')
      assert.equal(buttons.length, 1)
      await act(async () => buttons[0].click())
      assert.equal(plays.at(-1)[0], 0)
      assert.deepEqual(
        plays.at(-1)[1].map((track) => track.key),
        ['b']
      )
    }
    await search('missing')
    assert.match(document.body.textContent, /没有匹配的歌曲/)
    await search('')
    assert.equal(document.querySelectorAll('.track-cover').length, 3)
  })
})

test('filtered duplicate rows retain original removal indices', async () => {
  await harness(async ({ menus, removes, search }) => {
    await search('Alpha')
    menus.at(-1).onRemove()
    assert.equal(removes.at(-1)[1], 2)
  })
})

test('sorting preserves stable ties, filtered playback order and source indices', async () => {
  await harness(async ({ render, plays, removes, menus, tracks, search }) => {
    await render({ sortable: true })
    const sort = async (value) => {
      const element = document.querySelector('select')
      const key = Object.keys(element).find((key) => key.startsWith('__reactProps'))
      await act(async () => element[key].onChange({ target: { value } }))
    }
    await sort('duration')
    await act(async () => document.querySelector('.track-cover').click())
    assert.deepEqual(
      plays.at(-1)[1].map((track) => track.key),
      ['b', 'a', 'a']
    )
    assert.deepEqual(
      tracks.map((track) => track.key),
      ['a', 'b', 'a'],
      'cached input order is unchanged'
    )
    menus.at(-1).onRemove()
    assert.equal(removes.at(-1)[1], 2)
    await act(async () => document.querySelector('[aria-label="切换为降序"]').click())
    await act(async () => document.querySelectorAll('.track-cover')[2].click())
    assert.equal(plays.at(-1)[0], 2)
    assert.deepEqual(
      plays.at(-1)[1].map((track) => track.key),
      ['a', 'a', 'b']
    )
    await sort('album')
    await search('Beta')
    await act(async () => document.querySelector('.track-cover').click())
    assert.deepEqual(
      plays.at(-1)[1].map((track) => track.key),
      ['b']
    )
    await search('')
    await sort('default')
    await act(async () => document.querySelector('.track-cover').click())
    assert.deepEqual(
      plays.at(-1)[1].map((track) => track.key),
      ['a', 'b', 'a']
    )
  })
})
