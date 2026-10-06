import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the actual component handlers without a WebView or native audio device.
// Hooks and IPC are stubbed; no separate copy of the volume handler is tested.
function volumeControl({ failure, desktop = true } = {}) {
  const calls = [];
  const errors = [];
  let localVolume;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState: (initial) => [initial, (value) => { localVolume = value; }],
      useEffect: () => {},
    },
    "@tauri-apps/api/core": { isTauri: () => desktop },
    "@/lib/player": {
      usePlayer: () => ({ queue: [], index: null, status: "stopped", volume: 0.8 }),
      nativeCall: (command, args) => {
        calls.push({ command, ...args });
        return failure ? Promise.reject(failure) : Promise.resolve();
      },
      statusLabels: { stopped: "已停止" },
    },
    "lucide-react": {},
    "./action-button": {},
    "./cover": {},
  };
  const source = readFileSync(new URL("../src/components/player/playback-bar.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  const tree = exports.PlaybackBar({ onLyrics() {}, onQueue() {}, onError: (error) => errors.push(error) });
  function findVolume(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "input" && node.props["aria-label"] === "音量") return node.props;
    for (const child of [node.props?.children].flat()) {
      const match = findVolume(child);
      if (match) return match;
    }
  }
  const input = findVolume(tree);
  assert.ok(input, "playback bar must expose a volume range");
  return { input, calls, errors, get localVolume() { return localVolume; } };
}

test("volume changes reach native playback before pointer/key release, including mute", () => {
  const control = volumeControl();
  for (const value of [0.5, 0.25, 0, 1]) {
    control.input.onChange({ target: { value: String(value) } });
    assert.equal(control.localVolume, value);
    const call = control.calls.at(-1);
    assert.equal(call?.command, "player_volume");
    assert.equal(call?.volume, value, "changing the slider must change audio immediately");
  }
  assert.equal(control.calls.length, 4);
});

test("native volume failures reach the playback error handler", async () => {
  const failure = new Error("playback unavailable");
  const control = volumeControl({ failure });
  control.input.onChange({ target: { value: "0.3" } });
  await Promise.resolve();
  assert.deepEqual(control.errors, [failure]);
});

test("volume is disabled in browser preview", () => {
  assert.equal(volumeControl({ desktop: false }).input.disabled, true);
});
