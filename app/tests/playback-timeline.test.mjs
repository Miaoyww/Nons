import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness() {
  const calls = [], values = [], exports = {};
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState(initial) { const slot = cursor++; if (!(slot in values)) values[slot] = initial; return [values[slot], (next) => { values[slot] = next; }]; } },
    "@tauri-apps/api/core": { isTauri: () => true },
    "./player-slider": { PlayerSlider: "slider" },
    "@/lib/player": {
      useProgress: () => ({ positionMs: 30_000, durationMs: 180_000, status: "playing" }),
      formatTime: (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`,
      nativeCall: async (command, args) => { calls.push({ command, ...args }); },
    },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/player/playback-bar.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => modules[name] ?? {} });
  function render() {
    cursor = 0;
    const tree = exports.Timeline({ layout: "above", onError: (error) => { throw error; } });
    const children = tree.props.children.filter(Boolean);
    return { slider: children.find((child) => child.type === "slider").props, tooltip: children.find((child) => child.type === "span")?.props };
  }
  return { render, calls };
}
test("above timeline reveals hover and focus time without permanent time labels", () => {
  const app = harness();
  assert.equal(app.render().tooltip, undefined);
  app.render().slider.onPointerMove({ clientX: 250, currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 300 }) } });
  assert.equal(app.render().tooltip.children.join(""), "1:30 / 3:00");
  app.render().slider.onPointerLeave();
  assert.equal(app.render().tooltip, undefined);
  app.render().slider.onFocus();
  assert.equal(app.render().tooltip.children.join(""), "0:30 / 3:00");
  app.render().slider.onBlur();
  assert.equal(app.render().tooltip, undefined);
});
test("timeline commits pointer and keyboard seeks and cancels abandoned drags", () => {
  const app = harness();
  app.render().slider.onChange({ target: { value: "90000" } });
  app.render().slider.onPointerUp({ currentTarget: { value: "90000" } });
  assert.equal(app.calls[0].positionMs, 90_000);
  app.render().slider.onChange({ target: { value: "95000" } });
  app.render().slider.onKeyUp({ key: "ArrowRight", currentTarget: { value: "95000" } });
  assert.equal(app.calls[1].positionMs, 95_000);
  app.render().slider.onChange({ target: { value: "99000" } });
  app.render().slider.onPointerCancel();
  app.render().slider.onPointerUp({ currentTarget: { value: "99000" } });
  assert.equal(app.calls.length, 2);
});
