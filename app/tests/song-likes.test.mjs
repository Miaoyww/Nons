import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the real account provider with controlled requests and hook lifecycles.
function harness() {
  const slots = [], requests = [], effects = [], libraryRefreshes = [];
  let cursor = 0;
  const react = {
    createContext: () => ({ Provider: "provider" }), useContext() {},
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: (fn) => fn,
    useEffect(fn, deps) {
      const index = cursor++, old = slots[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        old?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = fn(); });
      }
    },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "@tauri-apps/api/core": { isTauri: () => true },
    "@/features/library/library-api": { resetAccountCache() {}, invalidateMusicLibrary() { libraryRefreshes.push("invalidate"); }, getMusicLibrary(userId) { libraryRefreshes.push(userId); return Promise.resolve(); } },
    "@/lib/player": {
      errorText: String,
      nativeCall(command, args) { return new Promise((resolve, reject) => requests.push({ command, args, resolve, reject })); },
    },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/features/account/account.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  runInNewContext(outputText, { exports, require: (name) => modules[name] });
  function render() { cursor = 0; const value = exports.AccountProvider({ children: null }).props.value; effects.splice(0).forEach((fn) => fn()); return value; }
  return { requests, render, libraryRefreshes };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function loggedIn() {
  const app = harness(); app.render();
  app.requests[0].resolve({ userId: 1 }); await settle(); app.render();
  app.requests[1].resolve([123]); await settle();
  return app;
}

test("likes update only after success and duplicate clicks issue one request", async () => {
  const app = await loggedIn(); const state = app.render();
  assert.equal(state.likedIds.has(123), true);
  const first = state.toggleLike(123); await state.toggleLike(123);
  assert.equal(app.requests.length, 3);
  assert.deepEqual({ ...app.requests[2].args }, { id: 123, liked: false });
  assert.equal(app.render().likedIds.has(123), true);
  assert.equal(app.render().pendingLikes.has(123), true);
  app.requests[2].resolve(); await first;
  assert.equal(app.render().likedIds.has(123), false);
  assert.equal(app.render().pendingLikes.size, 0);
  assert.equal(app.render().likesRevision, 1);
  assert.deepEqual(app.libraryRefreshes, ["invalidate", 1]);
});

test("failed writes preserve the liked state and release the button", async () => {
  const app = await loggedIn(); const request = app.render().toggleLike(123);
  app.requests[2].reject(new Error("network failure"));
  await assert.rejects(request, /network failure/);
  assert.equal(app.render().likedIds.has(123), true);
  assert.equal(app.render().pendingLikes.size, 0);
  assert.deepEqual(app.libraryRefreshes, []);
});

test("switching account discards old write responses", async () => {
  const app = await loggedIn(); const old = app.render().toggleLike(123);
  app.render().setProfile({ userId: 2 }); app.render();
  app.requests[3].resolve([456]); await settle();
  app.requests[2].resolve(); await old;
  assert.deepEqual([...app.render().likedIds], [456]);
});

test("switching account discards old liked list responses", async () => {
  const app = harness(); app.render();
  app.requests[0].resolve({ userId: 1 }); await settle(); app.render();
  app.render().setProfile({ userId: 2 }); app.render();
  app.requests[2].resolve([456]); await settle();
  app.requests[1].resolve([123]); await settle();
  assert.deepEqual([...app.render().likedIds], [456]);
});
