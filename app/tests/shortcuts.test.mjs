import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import ts from "typescript";

function session(saved) {
  const dom = new JSDOM('<main><input><button>Play</button><div contenteditable="true"><span></span></div></main>');
  const registered = new Map(), values = new Map(saved ? [["nons-shortcut-settings", saved]] : []);
  const exports = {};
  const source = readFileSync(new URL("../src/lib/shortcuts.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Element: dom.window.Element,
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    require: (name) => name === "@tauri-apps/api/core" ? { isTauri: () => true } : name === "./player" ? { errorText: String } : {
      async register(key, fn) { if (key === "taken") throw Error("occupied"); if (registered.has(key)) throw Error("duplicate"); registered.set(key, fn); },
      async unregister(keys) { for (const key of keys) registered.delete(key); },
    },
  });
  return { ...exports, registered, values, document: dom.window.document };
}
function config(app, bindings, enabled = true) { return { enabled, bindings: { ...app.getShortcutStatus().settings.bindings, ...bindings } }; }

test("global shortcuts default to disabled and blank, restore on startup and unregister when disabled", async () => {
  const app = session();
  assert.equal(app.getShortcutStatus().settings.enabled, false);
  assert.ok(Object.values(app.getShortcutStatus().settings.bindings).every((value) => value === ""));
  await app.initializeShortcuts(); assert.equal(app.registered.size, 0);
  await app.saveShortcuts(config(app, { toggle: "Ctrl+Alt+P", next: "" }));
  const restored = session(app.values.get("nons-shortcut-settings")); await restored.initializeShortcuts();
  assert.deepEqual([...restored.registered.keys()], ["Ctrl+Alt+P"]);
  const actions = []; restored.setShortcutDispatcher((action) => actions.push(action));
  restored.registered.get("Ctrl+Alt+P")({ state: "Released" });
  restored.registered.get("Ctrl+Alt+P")({ state: "Pressed" });
  assert.deepEqual(actions, ["toggle"]);
  await restored.saveShortcuts(config(restored, {}, false)); assert.equal(restored.registered.size, 0);
});

test("registration failure removes partial bindings and restores previous shortcuts without saving", async () => {
  const app = session(); await app.saveShortcuts(config(app, { toggle: "Ctrl+Alt+P" }));
  const saved = app.values.get("nons-shortcut-settings");
  assert.equal(await app.saveShortcuts(config(app, { toggle: "Ctrl+Alt+Q", next: "taken" })), false);
  assert.deepEqual([...app.registered.keys()], ["Ctrl+Alt+P"]);
  assert.equal(app.values.get("nons-shortcut-settings"), saved);
  assert.match(app.getShortcutStatus().error, /occupied/);
  assert.equal(await app.saveShortcuts(config(app, { next: "ctrl+alt+p" })), false);
  assert.deepEqual([...app.registered.keys()], ["Ctrl+Alt+P"]);
});

test("space excludes editing, interactive controls, modifiers, composition and repeat; global Space avoids duplicate dispatch", async () => {
  const app = session();
  const event = { code: "Space", target: app.document.querySelector("main") };
  assert.equal(app.isPlaybackSpace(event), true);
  for (const selector of ["input", "button", "span"]) assert.equal(app.isPlaybackSpace({ ...event, target: app.document.querySelector(selector) }), false);
  for (const key of ["repeat", "isComposing", "defaultPrevented", "ctrlKey", "altKey", "metaKey", "shiftKey"]) assert.equal(app.isPlaybackSpace({ ...event, [key]: true }), false);
  await app.saveShortcuts(config(app, { toggle: "Space" })); assert.equal(app.isPlaybackSpace(event), false);
});

test("invalid saved preferences fall back to blank defaults", () => {
  for (const saved of ["broken", "null", '{"bindings":{"toggle":42}}']) {
    const app = session(saved); assert.equal(app.getShortcutStatus().settings.enabled, false);
    assert.ok(Object.values(app.getShortcutStatus().settings.bindings).every((value) => value === ""));
  }
});

function playbackHarness() {
  const calls = [], likes = [], effects = [], refs = [];
  let cursor = 0, dispatch;
  const state = { index: 0, queue: [{ source: { kind: "netease", id: 7 } }], status: "playing", volume: 0.98 };
  const account = { profile: {}, likesReady: true, likedIds: new Set(), toggleLike: async (id) => { likes.push(id); } };
  const exports = {};
  const modules = {
    react: { useRef: (value) => refs[cursor++] ??= { current: value }, useEffect: (fn) => effects.push(fn) },
    "@tauri-apps/api/core": { isTauri: () => true },
    "@/components/player/account": { useAccount: () => account },
    "@/lib/player": { usePlayer: () => state, nativeCall: async (command, args) => { calls.push({ command, args }); } },
    "@/lib/shortcuts": { initializeShortcuts: async () => {}, isPlaybackSpace: () => false, setShortcutDispatcher: (fn) => { dispatch = fn; } },
  };
  const source = readFileSync(new URL("../src/hooks/use-playback-shortcuts.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (name) => modules[name], window: { addEventListener() {}, removeEventListener() {} },
  });
  const render = () => { cursor = 0; exports.usePlaybackShortcuts(() => {}); effects.splice(0).forEach((fn) => fn()); };
  render();
  return { calls, likes, state, account, render, dispatch: (name) => dispatch(name) };
}

test("all six playback actions reuse playback commands, clamp volume and favorite only eligible unliked tracks", () => {
  const app = playbackHarness();
  app.dispatch("toggle"); app.dispatch("previous"); app.dispatch("next"); app.dispatch("volumeUp"); app.dispatch("like");
  assert.deepEqual(app.calls.map(({ command, args }) => [command, args.action ?? args.volume]), [
    ["player_action", "pause"], ["player_action", "previous"], ["player_action", "next"], ["player_volume", 1],
  ]);
  assert.deepEqual(app.likes, [7]);
  app.account.likedIds.add(7); app.dispatch("like"); assert.deepEqual(app.likes, [7]);
  app.state.status = "paused"; app.state.volume = 0.02; app.render();
  app.dispatch("toggle"); app.dispatch("volumeDown");
  assert.equal(app.calls.at(-2).args.action, "resume"); assert.equal(app.calls.at(-1).args.volume, 0);
  app.state.queue = [{ source: { kind: "local" } }]; app.render(); app.dispatch("like"); assert.deepEqual(app.likes, [7]);
  app.state.index = null; app.render(); const count = app.calls.length;
  app.dispatch("toggle"); app.dispatch("previous"); app.dispatch("next"); assert.equal(app.calls.length, count);
});
