import { resolve } from "node:path";
import coverage from "istanbul-lib-coverage";

export function summarizeCoverage(reports, sourceFiles, minimumLines = 80) {
  const expected = new Set(sourceFiles.map((file) => resolve(file)));
  if (expected.size === 0) throw new Error("Executable source manifest is empty");
  const map = coverage.createCoverageMap({});
  for (const report of reports) {
    for (const [file, data] of Object.entries(report)) {
      const source = resolve(file);
      if (!expected.has(source)) throw new Error(`Unexpected coverage source: ${source}`);
      map.addFileCoverage({ ...data, path: source });
    }
  }
  const missing = [...expected].filter((file) => !map.files().includes(file));
  if (missing.length) throw new Error(`Missing coverage for ${missing.join(", ")}`);
  const summary = map.getCoverageSummary().toJSON();
  const { covered, total } = summary.lines;
  if (total === 0) throw new Error("Executable line denominator is empty");
  if (covered * 100 / total < minimumLines) {
    throw new Error(`Workspace line coverage ${covered * 100 / total}% is below ${minimumLines}%`);
  }
  return { summary, coverage: map.toJSON() };
}
