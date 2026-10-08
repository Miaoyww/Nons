import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness() {
  const calls = [];
  let profile = { userId: 7 };
  const actions = { busy: false, play: (...args) => calls.push(["play", ...args]), copy: item => calls.push(["copy", item]), edit: item => calls.push(["edit", item]), remove: item => calls.push(["remove", item]) };
  const menu = Object.fromEntries(["Root", "Trigger", "Portal", "Positioner", "Popup", "Item", "Separator"].map(key => [key, key]));
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { createContext: () => ({}), useContext: () => actions },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@base-ui/react/context-menu": { ContextMenu: menu },
    "@tauri-apps/api/core": { isTauri: () => true },
    "lucide-react": {}, "@/lib/player": {}, "@/lib/music-library": {}, "@/components/ui/dialog": {}, "@/components/ui/button": {},
    "./account": { useAccount: () => ({ profile }) }, "./music-navigation": {},
  };
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/components/player/collection-actions.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  runInNewContext(outputText, { exports, require: name => modules[name] });
  function flatten(node) { return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : []; }
  return { calls, logout: () => { profile = undefined; }, menu(item, busy = false) { return flatten(exports.CollectionContextMenu({ item, busy, render: jsx("article", {}), children: "card" })).filter(node => node.type === "Item"); } };
}
const playlist = { id: 12, kind: "playlist", creatorId: 7, liked: false, name: "Mine" };
test("playlist menus replace the queue or insert the whole collection next and expose management", () => {
  const app = harness(), items = app.menu(playlist);
  assert.equal(items.length, 5);
  items[0].props.onClick(); items[1].props.onClick(); items[2].props.onClick();
  assert.deepEqual(app.calls.map(call => [call[0], call[1].id, call[2]]), [["play", 12, undefined], ["play", 12, true], ["copy", 12, undefined]]);
  assert.equal(items[3].props.disabled, undefined);
  assert.equal(items[4].props.disabled, undefined);
});
test("albums omit edit and delete; other people's and liked playlists cannot be managed", () => {
  const app = harness();
  assert.equal(app.menu({ ...playlist, kind: "album" }).length, 3);
  for (const item of [{ ...playlist, creatorId: 8 }, { ...playlist, liked: true }]) {
    assert.equal(app.menu(item).length, 3);
  }
  app.logout(); assert.equal(app.menu(playlist).length, 3);
});
test("busy cards hide unavailable actions while share copying remains available", () => {
  const app = harness(), items = app.menu(playlist, true);
  assert.equal(items.length, 1);
  items[0].props.onClick(); assert.equal(app.calls[0][0], "copy");
});

test("song favorite action precedes the divider and unavailable remove actions are hidden", () => {
  const jsx = (type, props) => ({ type, props });
  const menu = Object.fromEntries(["Root", "Trigger", "Portal", "Positioner", "Popup", "Item", "Separator", "SubmenuRoot", "SubmenuTrigger"].map(key => [key, key]));
  const modules = {
    react: { createContext: () => ({}), useContext: () => ({}) },
    "react/jsx-runtime": { jsx, jsxs: jsx }, "@base-ui/react/context-menu": { ContextMenu: menu },
    "@tauri-apps/api/core": { isTauri: () => true }, "lucide-react": {}, "@/lib/player": {},
    "@/components/animate-ui/components/base/dialog": {}, "./action-button": {}, "./playlist-picker": {},
    "./account": { useAccount: () => ({ profile: { userId: 7 }, likedIds: new Set([12]), likesReady: true, pendingLikes: new Set() }) },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/components/player/song-actions.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  runInNewContext(outputText, { exports, require: name => modules[name] });
  function flatten(node) { return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : []; }
  const props = { track: { title: "Song", source: { kind: "netease", id: 12 } }, render: jsx("div", {}), children: null, onPlay() {} };
  const nodes = flatten(exports.SongContextMenu(props));
  const favorite = nodes.findIndex(node => node.type === "Item" && node.props.children?.includes("取消收藏"));
  const separator = nodes.findIndex(node => node.type === "Separator");
  assert.ok(favorite >= 0 && favorite < separator);
  assert.equal(nodes.some(node => node.props?.className === "song-menu-remove"), false);
  assert.equal(flatten(exports.SongContextMenu({ ...props, onRemove() {} })).some(node => node.props?.className === "song-menu-remove"), true);
});
