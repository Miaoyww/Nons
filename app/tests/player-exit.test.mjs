import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const jsx = (type, props) => ({ type, props });
function load(path, modules) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  runInNewContext(outputText, { exports, require(name) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    assert.ok(name in modules, `unexpected dependency: ${name}`);
    return modules[name];
  } });
  return exports;
}
function find(node, type) {
  if (!node || typeof node !== "object") return;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat()) { const match = find(child, type); if (match) return match; }
}
function harness(initialMode = "collapsible") {
  let phase;
  let barMode = initialMode;
  const App = load("../src/App.tsx", {
    react: { useState(initial) { phase ??= initial; return [phase, (next) => { phase = typeof next === "function" ? next(phase) : next; }]; } },
    "motion/react": { MotionConfig: "MotionConfig" },
    "@/components/titlebar": { Titlebar: "Titlebar" },
    "@/components/player/music-workspace": { MusicWorkspace: "MusicWorkspace" },
    "@/components/player/music-options": { MusicOptionsProvider: "MusicOptionsProvider" },
    "@/components/player/music-navigation": { MusicNavigationProvider: "MusicNavigationProvider" },
    "@/components/player/account": { AccountProvider: "AccountProvider" },
    "@/plugins/host": { PluginProvider: "PluginProvider", PluginSlot: "PluginSlot" },
  }).default;
  const MusicWorkspace = load("../src/components/player/music-workspace.tsx", {
    react: { useState: (value) => [value, () => {}], useRef: (current) => ({ current }), useCallback: (fn) => fn, useEffect() {}, lazy: () => "LazyView", Suspense: "Suspense" },
    "@tauri-apps/api/core": { isTauri: () => false }, "@tauri-apps/plugin-dialog": {}, "lucide-react": {},
    "@tauri-apps/api/event": {}, "@/components/settings/folder-manager": { FolderManager: "FolderManager" }, "@/lib/runtime-cache": {},
    "motion/react": { AnimatePresence: "AnimatePresence" },
    "@/hooks/use-playback-bar-mode": { usePlaybackBarMode: () => [barMode, () => {}] },
    "./persistent-playback-bar": { PersistentPlaybackBar: "PersistentPlaybackBar" },
    "@/hooks/use-playback-shortcuts": { usePlaybackShortcuts() {} },
    "@/lib/player": { usePlayer: () => ({ index: null, queue: [] }) },
    "./action-button": { ActionButton: "ActionButton" }, "./playback-bar": { PlaybackBar: "PlaybackBar" },
    "@/plugins/host": { PluginPageHost: "PluginPageHost" },
    "./music-navigation": { useMusicNavigation: () => ({ page: { view: "local", query: "" } }) },
    "./infinite-load": {}, "@/lib/use-paged-list": { usePagedList: () => ({ items: [], more: false, busy: false }) },
    "./music-options": { QualitySelect: "QualitySelect" }, "./track-list": {}, "./queue-page": { QueuePage: "QueuePage" }, "./collection-actions": { CollectionActionsProvider: "collection-actions" },
    "./song-actions": { SongActionsProvider: "SongActionsProvider" },
  }).MusicWorkspace;
  function render() {
    const props = find(App(), "MusicWorkspace").props;
    const workspace = MusicWorkspace(props);
    return { ...props, bar: find(workspace, "PlaybackBar") ?? find(workspace, "PersistentPlaybackBar"), exitComplete: find(workspace, "AnimatePresence").props.onExitComplete };
  }
  return { render, setMode: (mode) => { barMode = mode; } };
}

test("playback bar waits for the actual fullscreen exit completion", () => {
  const { render } = harness();
  assert.ok(render().bar);
  render().onNowPlayingChange(true);
  assert.equal(render().bar, undefined);
  render().onNowPlayingChange(false);
  const closing = render();
  assert.equal(closing.nowPlaying, false);
  assert.equal(closing.bar, undefined, "exit animation still owns the screen");
  closing.exitComplete();
  assert.ok(render().bar, "bar returns when Motion reports exit complete");
});

test("a delayed exit callback cannot show the bar after reopening fullscreen", () => {
  const { render } = harness();
  render().onNowPlayingChange(true);
  render().onNowPlayingChange(false);
  const closing = render();
  closing.onNowPlayingChange(true);
  closing.exitComplete();
  assert.equal(render().nowPlaying, true);
  assert.equal(render().bar, undefined);
});


test("persistent and hidden modes respect fullscreen exit ownership and live settings", () => {
  const app = harness("persistent");
  assert.equal(app.render().bar.type, "PersistentPlaybackBar");
  app.render().onNowPlayingChange(true);
  assert.equal(app.render().bar, undefined);
  app.render().onNowPlayingChange(false);
  const closing = app.render();
  assert.equal(closing.bar, undefined);
  app.setMode("off");
  closing.exitComplete();
  assert.equal(app.render().bar, undefined);
  app.setMode("collapsible");
  assert.equal(app.render().bar.type, "PlaybackBar");
  app.setMode("persistent");
  assert.equal(app.render().bar.type, "PersistentPlaybackBar");
});
