import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as amll from '@applemusic-like-lyrics/lyric'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/qrc.json', import.meta.url), 'utf8'))
const exports = {}
const { outputText } = ts.transpileModule(
  readFileSync(new URL('../src/features/lyrics/parse-lyrics.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
)
runInNewContext(outputText, { exports, require: () => amll })
const lyrics = {
  source: 'qq',
  format: 'qrc',
  content: fixture.main,
  translation: '[00:01.00]你好世界\n[00:03.00]再次',
  romanization: '[1000,1000]hello (1000,400)world(1400,600)'
}

test("QRC preserves each word's start and end through the actual AMLL parser", () => {
  const lines = exports.parseLyrics(lyrics, 4000)
  assert.equal(lines.length, 2)
  assert.deepEqual(
    Array.from(lines[0].words, (word) => [word.word, word.startTime, word.endTime]),
    [
      ['Hello ', 1000, 1400],
      ['world', 1400, 2000]
    ]
  )
  assert.equal(lines[0].startTime, 1000)
  assert.equal(lines[0].endTime, 2000)
  assert.equal(lines[0].translatedLyric, '你好世界')
  assert.equal(lines[0].romanLyric, 'hello world')
  assert.equal(lines[1].translatedLyric, '再次')
  assert.equal(
    exports
      .parseLyricsContent(lyrics)[0]
      .words.map((word) => word.word)
      .join(''),
    'Hello world'
  )
})

test('empty or malformed QRC triggers fallback; LRC and YRC still parse', () => {
  assert.throws(
    () => exports.parseLyrics({ ...lyrics, content: '<html>error</html>' }, 4000),
    exports.EmptyLyricsError
  )
  assert.throws(
    () => exports.parseLyrics({ ...lyrics, content: '[1000,1000]no word timestamps' }, 4000),
    exports.EmptyLyricsError
  )
  for (const [format, content] of [
    ['lrc', '[00:01.00]Hello'],
    ['yrc', '[1000,1000](1000,1000,0)Hello']
  ]) {
    assert.equal(
      exports.parseLyrics({ ...lyrics, format, content }, 4000)[0].words[0].word,
      'Hello'
    )
  }
})

test('translation and romanization tolerate timestamp drift through AMLL parsing', () => {
  for (const [format, content] of [
    ['qrc', '[1000,500]First(1000,500)\n[3000,500]Second(3000,500)'],
    ['yrc', '[1000,500](1000,500,0)First\n[3000,500](3000,500,0)Second'],
    ['lrc', '[00:01.00]First\n[00:03.00]Second']
  ]) {
    const result = exports.parseLyrics(
      {
        ...lyrics,
        format,
        content,
        translation: '[00:00.98]第一句\n[00:03.50]第二句',
        romanization: '[00:01.03]first\n[00:02.96]second'
      },
      4000
    )
    assert.deepEqual(
      Array.from(result, (line) => line.translatedLyric),
      ['第一句', '第二句']
    )
    assert.deepEqual(
      Array.from(result, (line) => line.romanLyric),
      ['first', 'second']
    )
  }
})

test('auxiliary matching prefers the nearest nonempty line and does not carry distant text', () => {
  const result = exports.parseLyrics(
    {
      ...lyrics,
      format: 'lrc',
      content: '[00:01.00]First\n[00:03.00]Second\n[00:05.00]Third',
      translation:
        '[00:00.60]较远\n[00:00.99]第一句\n[00:01.00]\n[00:03.00]第二句\n[00:03.01]较近\n[00:05.501]不应匹配',
      romanization: null
    },
    6000
  )
  assert.deepEqual(
    Array.from(result, (line) => line.translatedLyric),
    ['第一句', '第二句', '']
  )
})

test('word-level auxiliary text is parsed by the corresponding AMLL parser', () => {
  const result = exports.parseLyrics(
    {
      ...lyrics,
      translation: '[980,500](980,500,0)第一句\n[3010,500](3010,500,0)第二句',
      romanization: '[1020,500]first(1020,500)\n[2990,500]second(2990,500)'
    },
    4000
  )
  assert.deepEqual(
    Array.from(result, (line) => line.translatedLyric),
    ['第一句', '第二句']
  )
  assert.deepEqual(
    Array.from(result, (line) => line.romanLyric),
    ['first', 'second']
  )
})

test('slash placeholders disappear from translation and romanization without changing lyrics', () => {
  const result = exports.parseLyrics(
    {
      ...lyrics,
      format: 'lrc',
      content: '[00:01.00]Produced by: Example\n[00:03.00]A // B',
      translation: '[00:01.00] // \n[00:03.00]译文 // 内容',
      romanization: '[00:01.00]//\n[00:03.00]words / words'
    },
    4000
  )
  assert.equal(result[0].translatedLyric, '')
  assert.equal(result[0].romanLyric, '')
  assert.equal(result[1].translatedLyric, '译文 // 内容')
  assert.equal(result[1].words[0].word, 'A // B')
  assert.equal(result[1].romanLyric, 'words / words')
})
