import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness(responses, kind = "netease") {
  const calls = [];
  const exports = {};
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/lib/load-lyrics.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  runInNewContext(outputText, { exports, require: () => ({ nativeCall: async (_command, args) => { calls.push(args); return responses.shift(); } }) });
  return { calls, load: (sources = { amll: true, qq: true }, current) => exports.loadLyrics({ key: `${kind}:1`, source: { kind } }, true, sources,
    (lyrics) => { if (lyrics?.content === "broken") throw new Error("invalid lyrics"); return lyrics?.content; }, current) };
}

test("semantic failures continue through local, AMLL, QQ and NetEase once", async () => {
  const { load, calls } = harness(["local", "amll", "qq"].map((source) => ({ source, content: "broken" })).concat([{ source: "netease", content: "usable" }]));
  assert.equal((await load()).parsed, "usable");
  assert.deepEqual(calls.map((c) => [c.skipLocal, c.skipAmll, c.skipQq, c.refresh]), [
    [false, false, false, true], [true, false, false, false], [true, true, false, false], [true, true, true, false],
  ]);
});

test("disabled sources are skipped for every combination and local files remain eligible", async () => {
  for (const amll of [false, true]) for (const qq of [false, true]) {
    const { load, calls } = harness([{ source: "netease", content: "usable" }]);
    await load({ amll, qq });
    assert.deepEqual([calls[0].skipAmll, calls[0].skipQq, calls[0].skipLocal], [!amll, !qq, false]);
  }
});

test("late responses are discarded and final-source failures do not loop", async () => {
  const stale = harness([{ source: "amll", content: "broken" }]);
  assert.equal(await stale.load(undefined, () => false), null);
  assert.equal(stale.calls.length, 1);
  const terminal = harness([{ source: "netease", content: "broken" }]);
  await assert.rejects(terminal.load(), /invalid lyrics/);
  assert.equal(terminal.calls.length, 1);
});

test("invalid QRC tries QQ LRC before disabling QQ and requesting NetEase", async () => {
  const { load, calls } = harness([
    { source: "qq", format: "qrc", content: "broken" },
    { source: "qq", format: "lrc", content: "broken" },
    { source: "netease", format: "yrc", content: "usable" },
  ]);
  assert.equal((await load()).parsed, "usable");
  assert.deepEqual(calls.map((c) => [c.skipQq, c.skipQrc]), [[false, false], [false, true], [true, true]]);
});

test("local tracks fall back to sidecar lyrics after online semantic failures", async () => {
  const { load, calls } = harness([{source: "netease", content: "broken"}, {source: "local", content: "usable"}], "local");
  assert.equal((await load()).parsed, "usable");
  assert.deepEqual(calls.map(c => [c.skipNetease, c.skipLocal]), [[false,false],[true,false]]);
});
