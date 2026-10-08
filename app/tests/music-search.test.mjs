import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness() {
  const slots = [], effects = [], requests = [], navigations = [], timers = new Map();
  let cursor = 0, timerId = 0, page = { view: "library", query: "" };
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef() { return slots[cursor++] ??= { current: { focus() {}, blur() {} } }; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((dep, j) => dep !== old.deps[j])) {
        old?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); });
      }
    },
  };
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": { Search: "icon" },
    "@tauri-apps/api/core": { isTauri: () => true },
    "@base-ui/react/combobox": { Combobox: { Root: "combo", Input: "input" } },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/combobox": { ComboboxContent: "popup", ComboboxItem: "item", ComboboxList: "list" },
    "./music-navigation": { useMusicNavigation: () => ({ page, navigate: (...args) => navigations.push(args) }) },
    "@/lib/player": { nativeCall: (command, args) => new Promise((resolve, reject) => requests.push({ command, args, resolve, reject })) },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../src/components/player/music-search.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => modules[name], window: {
    setTimeout(fn, delay) { assert.equal(delay, 250); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  } });
  const render = () => { cursor = 0; const tree = exports.MusicSearch(); effects.splice(0).forEach(fn => fn()); return tree.props.children; };
  const input = () => render().props.children[0].props.children[1];
  return { render, input, requests, navigations, changePage(value) { page = value; render(); },
    type(value) { render().props.onInputValueChange(value); render(); },
    tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test("suggestions debounce typing, ignore older responses and display at most five", async () => {
  const h = harness(); h.render(); h.input().props.onFocus(); h.type("first"); h.type("second");
  assert.equal(h.requests.length, 0); h.tick();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].args.keyword, "second");
  h.type("third"); h.tick(); h.requests[0].resolve(["stale"]); await settle();
  assert.equal(h.render().props.items.length, 0);
  h.requests[1].resolve(["a", "b", "c", "d", "e", "f"]); await settle();
  assert.deepEqual([...h.render().props.items], ["a", "b", "c", "d", "e"]);
  assert.equal(h.render().props.open, true);
  h.render().props.onValueChange("b");
  assert.deepEqual(h.navigations, [["search", "b"]]);
});

test("composition and local search skip suggestions; failed suggestions still allow direct submit", async () => {
  const h = harness(); h.render(); h.input().props.onFocus(); h.input().props.onCompositionStart(); h.type("中"); h.tick();
  assert.equal(h.requests.length, 0);
  h.render().props.children[0].props.onSubmit({ preventDefault() {} }); assert.equal(h.navigations.length, 0);
  h.input().props.onCompositionEnd(); h.render(); h.tick(); assert.equal(h.requests.length, 1);
  h.requests[0].reject(Error("offline")); await settle();
  h.render().props.children[0].props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.navigations, [["search", "中"]]);
  h.changePage({ view: "local", query: "local" }); h.type("local music"); h.tick();
  assert.equal(h.requests.length, 1);
  h.render().props.children[0].props.onSubmit({ preventDefault() {} }); assert.deepEqual(h.navigations[1], ["local", "local music"]);
});

test("blur drops in-flight suggestions and prevents the popup from reopening", async () => {
  const h = harness(); h.render(); h.input().props.onFocus(); h.type("song"); h.tick();
  h.input().props.onBlur(); h.render(); h.requests[0].resolve(["late"]); await settle();
  assert.equal(h.render().props.open, false); assert.equal(h.render().props.items.length, 0);
});
