import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function lyricControl({ failure, desktop = true } = {}) {
  const calls = [];
  const errors = [];
  const jsx = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState: (initial) => [initial, () => {}], useEffect() {}, useCallback: (fn) => fn, useMemo: (fn) => fn() },
    "@applemusic-like-lyrics/react": { LyricPlayer: "lyric-player" },
    "@applemusic-like-lyrics/lyric": {},
    "@applemusic-like-lyrics/core/style.css": {},
    "@tauri-apps/api/event": {},
    "@tauri-apps/api/core": { isTauri: () => desktop },
    "@/hooks/use-lyric-sources": {},
    "@/lib/load-lyrics": {},
    "@/lib/parse-lyrics": {},
    "motion/react": { useReducedMotion: () => false },
    "lucide-react": {},
    "@/lib/player": {
      useProgress: () => ({ status: "paused", positionMs: 0 }),
      nativeCall: (command, args) => {
        calls.push({ command, ...args });
        return failure ? Promise.reject(failure) : Promise.resolve();
      },
    },
    "./action-button": {}, "./cover": {}, "./album-background": {}, "./now-playing-controls": {}, "./now-playing-menu": {},
  };
  const source = readFileSync(new URL("../src/components/player/lyrics-view.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  runInNewContext(`${outputText}\nexports.testRenderer = LyricRenderer;`, {
    exports, document: { visibilityState: "visible" },
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  const tree = exports.testRenderer({ lines: [], onError: (error) => errors.push(error) });
  const click = (startTime) => tree.props.onLyricLineClick({ line: { getLine: () => ({ startTime }) } });
  return { click, calls, errors };
}

test("clicking a lyric line seeks native playback to its start time in milliseconds", () => {
  const control = lyricControl();
  control.click(75250);
  assert.equal(control.calls[0].command, "player_seek");
  assert.equal(control.calls[0].positionMs, 75250);
});

test("lyric seek errors reach the visible playback error handler", async () => {
  const failure = new Error("seek unavailable");
  const control = lyricControl({ failure });
  control.click(25000);
  await Promise.resolve();
  assert.deepEqual(control.errors, [failure]);
});

test("browser preview does not invoke native seek", () => {
  const control = lyricControl({ desktop: false });
  control.click(25000);
  assert.equal(control.calls.length, 0);
});
