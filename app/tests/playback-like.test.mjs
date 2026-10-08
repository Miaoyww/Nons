import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness({ source = { kind: "netease", id: 7 }, desktop = true, loggedIn = true, ready = true, liked = false, pending = false, failure } = {}) {
  const calls = [], errors = [];
  const jsx = (type, props) => ({ type, props });
  const account = {
    profile: loggedIn ? { userId: 1 } : null,
    likedIds: new Set(liked ? [7] : []), likesReady: ready,
    pendingLikes: new Set(pending ? [7] : []),
    toggleLike: async (id) => { calls.push(id); if (failure) throw failure; },
  };
  const modules = {
    "react/jsx-runtime": { jsx, jsxs: jsx }, react: { useState: (value) => [value, () => {}] },
    "@tauri-apps/api/core": { isTauri: () => desktop },
    "@/lib/player": { adjacentIndex: () => null, usePlayer: () => ({ queue: [{ key: "track", title: "Song", source }], index: 0, status: "playing", repeatMode: "off" }), statusLabels: {} },
    "@/features/account/account": { useAccount: () => account }, "@/components/music/track-title": { trackDisplayTitle: (track) => track.title },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/features/playback/playback-bar.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  runInNewContext(outputText, { exports, require: (name) => modules[name] ?? {} });
  function find(node) {
    if (!node || typeof node !== "object") return;
    if (node.props?.className === "capsule-like") return node;
    for (const child of [node.props?.children].flat()) { const match = find(child); if (match) return match; }
  }
  const render = () => find(exports.PlaybackBar({ onError: (cause) => errors.push(cause), onLyrics() {}, onQueue() {} }));
  return { render, calls, errors, account };
}

test("playback heart toggles the currently playing song and reflects shared account likes", async () => {
  const app = harness();
  assert.equal(app.render().props["aria-pressed"], false);
  assert.equal(app.render().props.disabled, false);
  app.render().props.onClick(); await Promise.resolve();
  assert.deepEqual(app.calls, [7]);
  app.account.likedIds.add(7);
  assert.equal(app.render().props["aria-pressed"], true);
  assert.equal(app.render().props["aria-label"], "取消收藏当前歌曲");
});

test("playback heart is disabled for unavailable likes and local songs", () => {
  for (const options of [{ desktop: false }, { loggedIn: false }, { ready: false }, { pending: true }, { source: { kind: "local", neteaseId: null } }]) {
    assert.equal(harness(options).render().props.disabled, true);
  }
  assert.equal(harness({ pending: true }).render().props["aria-busy"], true);
});

test("failed playback like reaches the visible error handler and keeps the liked state", async () => {
  const failure = new Error("network unavailable");
  const app = harness({ failure, liked: true });
  app.render().props.onClick(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(app.errors, [failure]);
  assert.equal(app.render().props["aria-pressed"], true);
});
