import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");

const sharedBoundaryForbiddenSpecifiers = [
  /^@fluent-frame\/(?:extension|native-host)(?:\/|$)/,
  /^apps\//,
];
const extensionBoundaryForbiddenSpecifiers = [
  /^@fluent-frame\/native-host(?:\/|$)/,
  /(?:^|\/)apps\/native-host(?:\/|$)/,
  /(?:^|\/)packages\/shared\/src(?:\/|$)/,
];
const nativeHostBoundaryForbiddenSpecifiers = [
  /^@fluent-frame\/extension(?:\/|$)/,
  /(?:^|\/)apps\/extension(?:\/|$)/,
  /(?:^|\/)packages\/shared\/src(?:\/|$)/,
];

const sourceRoots = [
  {
    name: "shared",
    path: resolve(repoRoot, "packages/shared/src"),
    forbiddenSpecifiers: sharedBoundaryForbiddenSpecifiers,
  },
  {
    name: "shared tests",
    path: resolve(repoRoot, "packages/shared/tests"),
    forbiddenSpecifiers: sharedBoundaryForbiddenSpecifiers,
  },
  {
    name: "extension",
    path: resolve(repoRoot, "apps/extension/src"),
    forbiddenSpecifiers: extensionBoundaryForbiddenSpecifiers,
  },
  {
    name: "extension tests",
    path: resolve(repoRoot, "apps/extension/tests"),
    forbiddenSpecifiers: extensionBoundaryForbiddenSpecifiers,
  },
  {
    name: "native host",
    path: resolve(repoRoot, "apps/native-host/src"),
    forbiddenSpecifiers: nativeHostBoundaryForbiddenSpecifiers,
  },
  {
    name: "native host tests",
    path: resolve(repoRoot, "apps/native-host/tests"),
    forbiddenSpecifiers: nativeHostBoundaryForbiddenSpecifiers,
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

const operationalScriptRoot = resolve(repoRoot, "scripts");

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }

    return /\.(?:mjs|js|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function listFilesOneLevel(dir, pattern) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(dir, entry.name));
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

function findExportedStringConst(source, name) {
  const match = source.match(new RegExp(`export\\s+const\\s+${escapesForRegex(name)}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1];
}

function findRuntimeImportSpecifiers(source) {
  return [...source.matchAll(/import\s+(?!type\b)(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g)].map((match) => match[1]);
}

function resolveLocalSourceModule(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const resolved = resolve(fromFile, "..", specifier);
  const candidates = /\.(?:mjs|js|ts|tsx)$/.test(resolved)
    ? [
        resolved.replace(/\.(?:mjs|js)$/, ".ts"),
        resolved.replace(/\.(?:mjs|js)$/, ".tsx"),
        resolved,
      ]
    : [`${resolved}.ts`, `${resolved}.tsx`, join(resolved, "index.ts")];

  return candidates.find((candidate) => existsSync(candidate));
}

function collectRuntimeSourceClosure(entryFile) {
  const visited = new Set();
  const pending = [entryFile];

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || visited.has(filePath)) {
      continue;
    }
    visited.add(filePath);

    const source = readFileSync(filePath, "utf8");
    for (const specifier of findRuntimeImportSpecifiers(source)) {
      const resolved = resolveLocalSourceModule(filePath, specifier);
      if (resolved) {
        pending.push(resolved);
      }
    }
  }

  return [...visited].sort();
}

function findNamedExports(source, names) {
  const exportedNames = [];

  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
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

function findExportedDeclarationNames(source) {
  const exportedNames = [];

  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const exportEntry of match[1].split(",")) {
      const [localName, exportedAlias] = exportEntry
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .map((part) => part.trim());
      exportedNames.push(exportedAlias || localName);
    }
  }

  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
    exportedNames.push(match[1]);
  }

  return exportedNames.sort();
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

test("export scanner catches type-only named re-exports", () => {
  assert.deepEqual(findExportedDeclarationNames("export type { ContentScriptRuntime };"), ["ContentScriptRuntime"]);
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

test("operational scripts consume built workspace artifacts, not package source internals", () => {
  const violations = [];
  const forbiddenSourceImportPattern = /(?:^|\/)(?:apps|packages)\/[^/]+\/src(?:\/|$)/;

  for (const filePath of listFilesOneLevel(operationalScriptRoot, /\.mjs$/)) {
    const source = readFileSync(filePath, "utf8");
    const displayPath = relative(repoRoot, filePath);

    for (const specifier of findImportSpecifiers(source)) {
      const normalizedSpecifier = normalizeSpecifier(specifier, filePath);

      if (forbiddenSourceImportPattern.test(normalizedSpecifier)) {
        violations.push(`${displayPath} imports ${specifier}`);
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

test("native host parsed-request dispatcher exposes only the router boundary", () => {
  const hostRequestHandlersPath = resolve(repoRoot, "apps/native-host/src/hostRequestHandlers.ts");
  const source = readFileSync(hostRequestHandlersPath, "utf8");

  assert.deepEqual(findExportedDeclarationNames(source), ["handleParsedRequest"]);
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

test("extension content script entrypoint exposes only the bootstrap boundary", () => {
  const contentPath = resolve(repoRoot, "apps/extension/src/content.ts");
  const source = readFileSync(contentPath, "utf8");

  assert.deepEqual(findExportedDeclarationNames(source), ["ContentScriptRuntime", "bootstrapContentScript"]);
});

test("extension content script runtime graph keeps shared protocol imports type-only", () => {
  const contentPath = resolve(repoRoot, "apps/extension/src/content.ts");
  const violations = [];

  for (const filePath of collectRuntimeSourceClosure(contentPath)) {
    const source = readFileSync(filePath, "utf8");
    const runtimeSharedImports = findRuntimeImportSpecifiers(source)
      .filter((specifier) => specifier === "@fluent-frame/shared")
      .map((specifier) => `${relative(repoRoot, filePath)} imports ${specifier}`);
    violations.push(...runtimeSharedImports);
  }

  assert.deepEqual(violations, []);
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

test("extension YouTube URL parser delegates ID validation to shared parser", () => {
  const youtubeUrlPath = resolve(repoRoot, "apps/extension/src/youtubeUrl.ts");
  const source = readFileSync(youtubeUrlPath, "utf8");

  assert.match(source, /import\s+\{\s*parseYoutubeVideoId\s*\}\s+from\s+["']@fluent-frame\/shared["']/);
  assert.doesNotMatch(source, /\/\^\[A-Za-z0-9_-\]\{11\}\$\/|YOUTUBE_VIDEO_ID_PATTERN/);
});

test("shared caption language parser has one runtime owner", () => {
  const sharedSourceRoot = resolve(repoRoot, "packages/shared/src");
  const owners = listSourceFiles(sharedSourceRoot)
    .filter((filePath) => /function\s+parseCaptionLanguage\s*\(/.test(readFileSync(filePath, "utf8")))
    .map((filePath) => relative(repoRoot, filePath));

  assert.deepEqual(owners, ["packages/shared/src/protocolScalars.ts"]);
});

test("e2e native host manifests use the shared host name owner", () => {
  const helpersPath = resolve(repoRoot, "e2e/helpers.ts");
  const source = readFileSync(helpersPath, "utf8");

  assert.match(source, /import\s+\{\s*NATIVE_HOST_NAME\s*\}\s+from\s+["']\.\.\/packages\/shared\/dist\/index\.js["']/);
  assert.doesNotMatch(source, /NATIVE_HOST_NAME\s*=\s*["']com\.octopusgarage\.fluent_frame["']/);
});

test("local setup scripts keep their startup-safe native host name copy aligned with shared", () => {
  const sharedProtocolPath = resolve(repoRoot, "packages/shared/src/protocol.ts");
  const localCommonPath = resolve(repoRoot, "scripts/local-common.mjs");
  const sharedSource = readFileSync(sharedProtocolPath, "utf8");
  const localCommonSource = readFileSync(localCommonPath, "utf8");

  assert.equal(
    findExportedStringConst(localCommonSource, "nativeHostName"),
    findExportedStringConst(sharedSource, "NATIVE_HOST_NAME"),
  );
});

test("native host generation callers assemble runtime dependencies only through the video processing pipeline", () => {
  const generationCallerPaths = [
    resolve(repoRoot, "apps/native-host/src/processVideoRequestHandler.ts"),
    resolve(repoRoot, "apps/native-host/src/queueProcessor.ts"),
  ];
  const allowedGenerationBoundary = "./videoProcessingPipeline.js";
  const forbiddenGenerationInternals = new Set([
    "./agentRunner.js",
    "./cacheBackfill.js",
    "./captionCache.js",
    "./captionDownloader.js",
    "./processor.js",
    "./remoteCache.js",
  ]);
  const violations = [];

  for (const filePath of generationCallerPaths) {
    const source = readFileSync(filePath, "utf8");
    const displayPath = relative(repoRoot, filePath);
    const localRuntimeSpecifiers = findRuntimeImportSpecifiers(source).filter((specifier) => specifier.startsWith("."));

    if (!localRuntimeSpecifiers.includes(allowedGenerationBoundary)) {
      violations.push(`${displayPath} does not import runtime boundary ${allowedGenerationBoundary}`);
    }

    for (const specifier of localRuntimeSpecifiers) {
      if (forbiddenGenerationInternals.has(specifier)) {
        violations.push(`${displayPath} imports generation runtime internal ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
