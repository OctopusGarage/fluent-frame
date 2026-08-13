import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");

const sourceRoots = [
  {
    name: "shared",
    path: resolve(repoRoot, "packages/shared/src"),
    forbiddenSpecifiers: [/^@fluent-frame\/(?:extension|native-host)(?:\/|$)/, /^apps\//],
  },
  {
    name: "shared tests",
    path: resolve(repoRoot, "packages/shared/tests"),
    forbiddenSpecifiers: [/^@fluent-frame\/(?:extension|native-host)(?:\/|$)/, /^apps\//],
  },
  {
    name: "extension",
    path: resolve(repoRoot, "apps/extension/src"),
    forbiddenSpecifiers: [/^@fluent-frame\/native-host(?:\/|$)/, /(?:^|\/)apps\/native-host(?:\/|$)/, /(?:^|\/)packages\/shared\/src(?:\/|$)/],
  },
  {
    name: "extension tests",
    path: resolve(repoRoot, "apps/extension/tests"),
    forbiddenSpecifiers: [/^@fluent-frame\/native-host(?:\/|$)/, /(?:^|\/)apps\/native-host(?:\/|$)/, /(?:^|\/)packages\/shared\/src(?:\/|$)/],
  },
  {
    name: "native host",
    path: resolve(repoRoot, "apps/native-host/src"),
    forbiddenSpecifiers: [/^@fluent-frame\/extension(?:\/|$)/, /(?:^|\/)apps\/extension(?:\/|$)/, /(?:^|\/)packages\/shared\/src(?:\/|$)/],
  },
  {
    name: "native host tests",
    path: resolve(repoRoot, "apps/native-host/tests"),
    forbiddenSpecifiers: [/^@fluent-frame\/extension(?:\/|$)/, /(?:^|\/)apps\/extension(?:\/|$)/, /(?:^|\/)packages\/shared\/src(?:\/|$)/],
  },
];

const packageBoundaries = [
  {
    path: resolve(repoRoot, "packages/shared/package.json"),
    forbiddenDependencies: ["@fluent-frame/extension", "@fluent-frame/native-host"],
  },
  {
    path: resolve(repoRoot, "apps/extension/package.json"),
    forbiddenDependencies: ["@fluent-frame/native-host"],
  },
  {
    path: resolve(repoRoot, "apps/native-host/package.json"),
    forbiddenDependencies: ["@fluent-frame/extension"],
  },
];

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }

    return /\.(?:mjs|js|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function findImportSpecifiers(source) {
  const specifiers = [];
  const importExportPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importExportPattern)) {
    specifiers.push(match[1]);
  }

  for (const match of source.matchAll(dynamicImportPattern)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function normalizeSpecifier(specifier, fromFile) {
  if (!specifier.startsWith(".")) {
    return specifier;
  }

  return relative(repoRoot, resolve(fromFile, "..", specifier)).split(sep).join("/");
}

test("workspace package source and tests keep documented architecture boundaries", () => {
  const violations = [];

  for (const root of sourceRoots) {
    for (const filePath of listSourceFiles(root.path)) {
      const source = readFileSync(filePath, "utf8");
      const displayPath = relative(repoRoot, filePath);

      for (const specifier of findImportSpecifiers(source)) {
        const normalizedSpecifier = normalizeSpecifier(specifier, filePath);

        if (root.forbiddenSpecifiers.some((pattern) => pattern.test(normalizedSpecifier))) {
          violations.push(`${displayPath} imports ${specifier}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("workspace package manifests keep app dependencies one-way through shared", () => {
  const violations = [];

  for (const boundary of packageBoundaries) {
    const packageJson = JSON.parse(readFileSync(boundary.path, "utf8"));
    const dependencyNames = Object.keys({
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
      ...packageJson.optionalDependencies,
    });

    for (const forbiddenDependency of boundary.forbiddenDependencies) {
      if (dependencyNames.includes(forbiddenDependency)) {
        violations.push(`${relative(repoRoot, boundary.path)} depends on ${forbiddenDependency}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
