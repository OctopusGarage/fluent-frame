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

function escapesForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasReExportFrom(source, specifier) {
  return new RegExp(`export\\s+[^;]*from\\s+["']${escapesForRegex(specifier)}["']`).test(source);
}

function findRuntimeImportSpecifiers(source) {
  return [...source.matchAll(/import\s+(?!type\b)(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)].map((match) => match[1]);
}

function findNamedExports(source, names) {
  const exportedNames = [];

  for (const match of source.matchAll(/export\s+\{([^}]+)\}/g)) {
    const exportList = match[1];
    for (const exportEntry of exportList.split(",")) {
      const [localName, exportedAlias] = exportEntry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .map((part) => part.trim());
      for (const name of names) {
        if (localName === name || exportedAlias === name) {
          exportedNames.push(name);
        }
      }
    }
  }

  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    const exportedName = match[1];
    if (names.includes(exportedName)) {
      exportedNames.push(exportedName);
    }
  }

  return exportedNames;
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

test("named export scanner catches forbidden aliases", () => {
  assert.deepEqual(
    findNamedExports("export { localRequestId as createRequestId };", ["createRequestId"]),
    ["createRequestId"],
  );
});

test("named export scanner catches forbidden direct declarations", () => {
  assert.deepEqual(
    findNamedExports("export function createRequestId() {}", ["createRequestId"]),
    ["createRequestId"],
  );
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

test("native host request handlers do not re-export worker or processor internals", () => {
  const queueRequestHandlerPath = resolve(repoRoot, "apps/native-host/src/queueRequestHandler.ts");
  const source = readFileSync(queueRequestHandlerPath, "utf8");
  const forbiddenReExports = [
    ...findImportSpecifiers(source)
      .filter((specifier) => specifier === "./queueWorkerProcess.js" || specifier === "./queueProcessor.js")
      .filter((specifier) => hasReExportFrom(source, specifier)),
    ...findNamedExports(source, ["startDetachedQueueWorker", "DetachedQueueWorkerDeps", "isQueueReadyOutput"]),
  ];

  assert.deepEqual(forbiddenReExports, []);
});

test("extension runtime entrypoint does not re-export request or native-client internals", () => {
  const backgroundPath = resolve(repoRoot, "apps/extension/src/background.ts");
  const source = readFileSync(backgroundPath, "utf8");
  const forbiddenReExports = [
    ...findImportSpecifiers(source)
      .filter((specifier) => specifier === "./backgroundRequests.js" || specifier === "./nativeHostClient.js")
      .filter((specifier) => hasReExportFrom(source, specifier)),
    ...findNamedExports(source, ["createProcessVideoRequest", "createRequestId", "normalizeExtensionError", "normalizeNativeResponse"]),
  ];

  assert.deepEqual(forbiddenReExports, []);
});

test("extension runtime entrypoint does not re-export queue context-menu internals", () => {
  const backgroundPath = resolve(repoRoot, "apps/extension/src/background.ts");
  const source = readFileSync(backgroundPath, "utf8");
  const forbiddenReExports = [
    ...findImportSpecifiers(source)
      .filter((specifier) => specifier === "./backgroundQueueContextMenus.js")
      .filter((specifier) => hasReExportFrom(source, specifier)),
    ...findNamedExports(source, ["registerQueueContextMenus", "rememberQueueContextMenuLink"]),
  ];

  assert.deepEqual(forbiddenReExports, []);
});

test("extension runtime entrypoint does not re-export streaming internals", () => {
  const backgroundPath = resolve(repoRoot, "apps/extension/src/background.ts");
  const source = readFileSync(backgroundPath, "utf8");
  const forbiddenReExports = [
    ...findImportSpecifiers(source)
      .filter((specifier) => specifier === "./backgroundStreaming.js")
      .filter((specifier) => hasReExportFrom(source, specifier)),
    ...findNamedExports(source, ["registerStreamingPortListener"]),
  ];

  assert.deepEqual(forbiddenReExports, []);
});

test("extension runtime entrypoint does not re-export one-shot native message internals", () => {
  const backgroundPath = resolve(repoRoot, "apps/extension/src/background.ts");
  const source = readFileSync(backgroundPath, "utf8");
  const forbiddenReExports = [
    ...findImportSpecifiers(source)
      .filter((specifier) => specifier === "./backgroundNativeMessages.js")
      .filter((specifier) => hasReExportFrom(source, specifier)),
    ...findNamedExports(source, ["registerNativeMessageListener"]),
  ];

  assert.deepEqual(forbiddenReExports, []);
});

test("extension native client does not re-export request-id helpers", () => {
  const nativeHostClientPath = resolve(repoRoot, "apps/extension/src/nativeHostClient.ts");
  const source = readFileSync(nativeHostClientPath, "utf8");
  const forbiddenReExports = [
    ...findImportSpecifiers(source)
      .filter((specifier) => specifier === "./requestId.js")
      .filter((specifier) => hasReExportFrom(source, specifier)),
    ...findNamedExports(source, ["createRequestId"]),
  ];

  assert.deepEqual(forbiddenReExports, []);
});

test("shared host response parser does not import request parser runtime", () => {
  const hostResponsePath = resolve(repoRoot, "packages/shared/src/hostResponse.ts");
  const source = readFileSync(hostResponsePath, "utf8");
  const forbiddenRuntimeImports = findRuntimeImportSpecifiers(source)
    .filter((specifier) => specifier === "./protocol.js");

  assert.deepEqual(forbiddenRuntimeImports, []);
});

test("shared YouTube video ID parser has one runtime owner", () => {
  const sharedSourceRoot = resolve(repoRoot, "packages/shared/src");
  const owners = listSourceFiles(sharedSourceRoot)
    .filter((filePath) => /function\s+parseYoutubeVideoId\s*\(/.test(readFileSync(filePath, "utf8")))
    .map((filePath) => relative(repoRoot, filePath));

  assert.deepEqual(owners, ["packages/shared/src/protocolScalars.ts"]);
});
