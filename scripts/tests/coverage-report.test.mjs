import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { summarizeCoverage } from "../coverage-tools/report.mjs";

function report(file, counts) {
  const path = resolve(file);
  return { [path]: { path,
    statementMap: Object.fromEntries(counts.map((_, id) => [id, { start: { line: id + 1, column: 0 }, end: { line: id + 1, column: 10 } }])),
    s: Object.fromEntries(counts.map((count, id) => [id, count])),
    fnMap: {}, f: {}, branchMap: {}, b: {},
  } };
}

test("coverage merges overlapping source identities instead of double counting a file", () => {
  const file = resolve("fixture/source.ts");
  const result = summarizeCoverage([report(file, [1, 0]), report(file, [0, 1])], [file]);
  assert.deepEqual(result.summary.lines, { total: 2, covered: 2, skipped: 0, pct: 100 });
  assert.equal(Object.keys(result.coverage).length, 1);
});

test("coverage refuses a report that silently omits an unloaded executable source", () => {
  const loaded = resolve("fixture/loaded.ts");
  const unloaded = resolve("fixture/unloaded.mjs");
  assert.throws(() => summarizeCoverage([report(loaded, [1])], [loaded, unloaded]), /Missing coverage for/);
});

test("coverage includes zero-covered files in the acceptance denominator", () => {
  const loaded = resolve("fixture/loaded.ts");
  const unloaded = resolve("fixture/unloaded.mjs");
  assert.throws(() => summarizeCoverage([report(loaded, [1, 1, 1]), report(unloaded, [0, 0])], [loaded, unloaded]), /60.*80/);
});

test("coverage threshold uses exact counts and accepts the boundary", () => {
  const file = resolve("fixture/source.ts");
  assert.equal(summarizeCoverage([report(file, [1, 1, 1, 1, 0])], [file]).summary.lines.pct, 80);
  assert.throws(() => summarizeCoverage([report(file, [1, 1, 1, 0, 0])], [file]), /60.*80/);
});

test("coverage rejects empty manifests and unexpected sources", () => {
  const file = resolve("fixture/source.ts");
  assert.throws(() => summarizeCoverage([], []), /empty/);
  assert.throws(() => summarizeCoverage([report(file, [1])], [resolve("fixture/other.ts")]), /Unexpected coverage source/);
});
