import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness() {
  const requests = [];
  let now = 0;
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/lib/music-library.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  runInNewContext(outputText, { exports, Date: { now: () => now }, require: () => ({
    nativeCall(command, args) { return new Promise((resolve, reject) => requests.push({ command, args, resolve, reject })); },
  }) });
  return { api: exports, requests, advance(ms) { now += ms; } };
}
const summary = { likedPlaylist: { id: 1, kind: "playlist" }, likedTracks: [], likedError: null };

test("summary shares in-flight requests and expires after ten minutes", async () => {
  const { api, requests, advance } = harness();
  const first = api.getMusicLibrary(1);
  assert.equal(api.getMusicLibrary(1), first);
  requests[0].resolve(summary); await first;
  advance(599999);
  assert.equal(await api.getMusicLibrary(1), summary);
  assert.equal(requests.length, 1);
  advance(1);
  const refreshed = api.getMusicLibrary(1);
  assert.equal(api.peekMusicLibrary(1), summary);
  assert.equal(requests.length, 2);
  requests[1].resolve(summary); await refreshed;
});

test("invalidated and previous-account requests cannot repopulate the cache", async () => {
  const { api, requests } = harness();
  const old = api.getMusicLibrary(1);
  api.invalidateMusicLibrary();
  const fresh = api.getMusicLibrary(1);
  requests[0].resolve(summary); await old;
  assert.equal(api.peekMusicLibrary(1), undefined);
  requests[1].resolve(summary); await fresh;
  assert.equal(api.peekMusicLibrary(2), undefined);
  const other = api.getMusicLibrary(2);
  api.invalidateMusicLibrary();
  requests[2].resolve(summary); await other;
  assert.equal(api.peekMusicLibrary(2), undefined);
});

test("failed and partial summary responses remain retryable", async () => {
  const { api, requests } = harness();
  const first = api.getMusicLibrary(1);
  requests[0].reject(new Error("offline")); await assert.rejects(first, /offline/);
  const second = api.getMusicLibrary(1);
  requests[1].resolve({ ...summary, likedError: "offline" }); await second;
  assert.equal(api.peekMusicLibrary(1), undefined);
  const third = api.getMusicLibrary(1);
  assert.equal(requests.length, 3);
  requests[2].resolve(summary); await third;
});

test("liked playlist pages are bounded, shared, expired and invalidated after writes", async () => {
  const { api, requests, advance } = harness();
  const initial = api.getMusicLibrary(1);
  requests[0].resolve(summary); await initial;
  const page = { tracks: [], more: true, total: 2000 };
  const first = api.getLibraryTracks(summary.likedPlaylist, 0, 1);
  assert.equal(api.getLibraryTracks(summary.likedPlaylist, 0, 1), first);
  requests[1].resolve(page); await first;
  assert.equal(await api.getLibraryTracks(summary.likedPlaylist, 0, 1), page);
  for (let offset = 100; offset <= 1000; offset += 100) {
    const pending = api.getLibraryTracks(summary.likedPlaylist, offset, 1);
    requests.at(-1).resolve(page); await pending;
  }
  const evicted = api.getLibraryTracks(summary.likedPlaylist, 0, 1);
  assert.equal(requests.length, 13);
  requests.at(-1).resolve(page); await evicted;
  advance(600000);
  const expired = api.getLibraryTracks(summary.likedPlaylist, 0, 1);
  assert.equal(requests.length, 14);
  requests.at(-1).resolve(page); await expired;
  api.invalidateMusicLibrary();
  const changed = api.getMusicLibrary(1);
  requests.at(-1).resolve(summary); await changed;
  const reloaded = api.getLibraryTracks(summary.likedPlaylist, 0, 1);
  assert.equal(requests.length, 16);
  requests.at(-1).resolve(page); await reloaded;
});
