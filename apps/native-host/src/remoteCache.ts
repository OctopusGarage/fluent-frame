import { assertLearningSubtitleResult, WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";
import { matchesCacheIdentity } from "./cacheResult.js";
import type { RemoteCacheConfig } from "./config.js";

export type RemoteCacheProvider = {
  readResult(videoId: string, captionLanguage: string, workflowVersion?: string): Promise<LearningSubtitleResult | undefined>;
  writeResult(result: LearningSubtitleResult): Promise<void>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type GithubContentResponse = {
  content?: unknown;
  encoding?: unknown;
  sha?: unknown;
};

export type GithubRemoteCacheDeps = {
  config: Extract<RemoteCacheConfig, { provider: "github" }>;
  fetch?: FetchLike;
};

export function githubRemoteCachePath(
  basePath: string,
  videoId: string,
  captionLanguage: string,
  workflowVersion = WORKFLOW_VERSION,
): string {
  return `${basePath.replace(/^\/+|\/+$/g, "")}/${videoId}/${captionLanguage}/${workflowVersion}/result.json`;
}

function apiUrl(config: Extract<RemoteCacheConfig, { provider: "github" }>, path: string, ref?: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodedPath}`);
  if (ref) {
    url.searchParams.set("ref", ref);
  }
  return url.toString();
}

function headers(config: Extract<RemoteCacheConfig, { provider: "github" }>): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "FluentFrame",
    "x-github-api-version": "2022-11-28",
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
  };
}

function decodeContent(response: GithubContentResponse): unknown {
  if (typeof response.content !== "string" || response.encoding !== "base64") {
    throw new Error("Invalid GitHub cache response");
  }
  return JSON.parse(Buffer.from(response.content.replace(/\s/g, ""), "base64").toString("utf8")) as unknown;
}

function contentSha(response: unknown): string | undefined {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return undefined;
  }
  const sha = (response as GithubContentResponse).sha;
  return typeof sha === "string" && sha ? sha : undefined;
}

function assertRemoteResult(value: unknown): asserts value is LearningSubtitleResult {
  assertLearningSubtitleResult(value, "Invalid GitHub cached subtitle result");
}

export function createGithubRemoteCache({ config, fetch: fetchImpl = fetch }: GithubRemoteCacheDeps): RemoteCacheProvider {
  async function readContent(path: string): Promise<GithubContentResponse | undefined> {
    const response = await fetchImpl(apiUrl(config, path, config.branch), {
      method: "GET",
      headers: headers(config),
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`GitHub cache read failed: ${response.status}`);
    }
    return await response.json() as GithubContentResponse;
  }

  return {
    async readResult(videoId, captionLanguage, workflowVersion = WORKFLOW_VERSION) {
      const path = githubRemoteCachePath(config.basePath, videoId, captionLanguage, workflowVersion);
      const content = await readContent(path);
      if (!content) {
        return undefined;
      }
      const parsed = decodeContent(content);
      assertRemoteResult(parsed);
      if (!matchesCacheIdentity(parsed, videoId, captionLanguage, workflowVersion)) {
        return undefined;
      }
      return parsed;
    },

    async writeResult(result) {
      if (!config.writeEnabled || !config.token) {
        return;
      }
      const path = githubRemoteCachePath(config.basePath, result.videoId, result.sourceLanguage, result.workflowVersion);
      const existing = await readContent(path);
      const body = {
        message: `chore(cache): update FluentFrame subtitles for ${result.videoId}`,
        content: Buffer.from(`${JSON.stringify(result, null, 2)}\n`, "utf8").toString("base64"),
        branch: config.branch,
        ...(contentSha(existing) ? { sha: contentSha(existing) } : {}),
      };
      const response = await fetchImpl(apiUrl(config, path), {
        method: "PUT",
        headers: {
          ...headers(config),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`GitHub cache write failed: ${response.status}`);
      }
    },
  };
}

export function createRemoteCacheProvider(config: RemoteCacheConfig): RemoteCacheProvider | undefined {
  if (!config.enabled) {
    return undefined;
  }
  return createGithubRemoteCache({ config });
}
