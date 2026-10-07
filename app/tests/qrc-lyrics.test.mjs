import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as amll from "@applemusic-like-lyrics/lyric";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/qrc.json", import.meta.url), "utf8"));
const exports = {};
const { outputText } = ts.transpileModule(readFileSync(new URL("../src/lib/parse-lyrics.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
runInNewContext(outputText, { exports, require: () => amll });
const lyrics = { source: "qq", format: "qrc", content: fixture.main, translation: "[00:01.00]你好世界\n[00:03.00]再次", romanization: "[1000,1000]hello (1000,400)world(1400,600)" };

test("QRC preserves each word's start and end through the actual AMLL parser", () => {
  const lines = exports.parseLyrics(lyrics, 4000);
  assert.equal(lines.length, 2);
  assert.deepEqual(Array.from(lines[0].words, (word) => [word.word, word.startTime, word.endTime]), [["Hello ", 1000, 1400], ["world", 1400, 2000]]);
  assert.equal(lines[0].startTime, 1000);
  assert.equal(lines[0].endTime, 2000);
  assert.equal(lines[0].translatedLyric, "你好世界");
  assert.equal(lines[0].romanLyric, "hello world");
  assert.equal(lines[1].translatedLyric, "再次");
  assert.equal(exports.parseLyricsContent(lyrics)[0].words.map((word) => word.word).join(""), "Hello world");
});

test("empty or malformed QRC triggers fallback; LRC and YRC still parse", () => {
  assert.throws(() => exports.parseLyrics({ ...lyrics, content: "<html>error</html>" }, 4000), exports.EmptyLyricsError);
  assert.throws(() => exports.parseLyrics({ ...lyrics, content: "[1000,1000]no word timestamps" }, 4000), exports.EmptyLyricsError);
  for (const [format, content] of [["lrc", "[00:01.00]Hello"], ["yrc", "[1000,1000](1000,1000,0)Hello"]]) {
    assert.equal(exports.parseLyrics({ ...lyrics, format, content }, 4000)[0].words[0].word, "Hello");
  }
});
