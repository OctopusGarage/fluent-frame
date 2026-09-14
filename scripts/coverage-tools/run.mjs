import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { rootDir, run } from "../local-common.mjs";
import { summarizeCoverage } from "./report.mjs";

const output = join(rootDir, "coverage");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const packages = JSON.parse(await run("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
  stdio: ["ignore", "pipe", "inherit"],
})).map((entry) => resolve(entry.path)).filter((path) => path !== rootDir);
const sources = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await collect(file);
    else if (/\.(?:ts|js|mjs)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) sources.push(file);
  }
}
for (const directory of packages) await collect(join(directory, "src"));
for (const name of await readdir(join(rootDir, "scripts"))) {
  if (name.endsWith(".mjs")) sources.push(join(rootDir, "scripts", name));
}
await run("pnpm", ["--filter", "@fluent-frame/shared", "build"]);
const reports = [];
for (const [index, directory] of packages.entries()) {
  const reportDir = join(output, `package-${index}`);
  await run("pnpm", ["--dir", directory, "test", "--coverage",
    "--coverage.include=src/**/*.{ts,js,mjs}", "--coverage.exclude=src/**/*.d.ts",
    "--coverage.reporter=json", `--coverage.reportsDirectory=${reportDir}`]);
  reports.push(JSON.parse(await readFile(join(reportDir, "coverage-final.json"), "utf8")));
}
const scriptDir = join(output, "scripts");
const scriptTests = (await readdir(join(rootDir, "scripts/tests")))
  .filter((name) => name.endsWith(".test.mjs")).sort().map((name) => join("scripts/tests", name));
await run("pnpm", ["exec", "c8", "--all", "--src=scripts", "--include=scripts/*.mjs",
  "--reporter=json", `--reports-dir=${scriptDir}`, "node", "--test", ...scriptTests]);
reports.push(JSON.parse(await readFile(join(scriptDir, "coverage-final.json"), "utf8")));
const result = summarizeCoverage(reports, sources, 0);
await writeFile(join(output, "coverage-final.json"), `${JSON.stringify(result.coverage)}\n`);
await writeFile(join(output, "workspace-summary.json"), `${JSON.stringify({
  minimumLines: 80, sourceFiles: sources.map((file) => file.slice(rootDir.length + 1)).sort(),
  ...result.summary,
}, null, 2)}\n`);
for (const metric of ["lines", "branches", "functions", "statements"]) {
  const { covered, total, pct } = result.summary[metric];
  console.log(`Workspace ${metric}: ${covered}/${total} (${pct}%)`);
}
summarizeCoverage(reports, sources, 80);
