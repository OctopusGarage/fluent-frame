import { describe, expect, it } from "vitest";
import { WORKFLOW_VERSION, type LearningSubtitleResult } from "@fluent-frame/shared";
import { createGithubRemoteCache, githubRemoteCachePath } from "../src/remoteCache.js";

const result: LearningSubtitleResult = {
  videoId: "dQw4w9WgXcQ",
  sourceLanguage: "en",
  workflowVersion: WORKFLOW_VERSION,
  generatedAt: "2026-07-21T00:00:00.000Z",
  subtitles: [
    {
      id: 1,
      startMs: 0,
      endMs: 1000,
      english: "Nice pass.",
      chinese: "传得漂亮。",
      phraseIds: ["p1"],
    },
  ],
  phrases: [
    {
      id: "p1",
      cueId: 1,
      phrase: "nice pass",
      meaningZh: "传得漂亮",
      explanationEn: "A useful match phrase.",
      difficulty: "basic",
    },
  ],
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("githubRemoteCachePath", () => {
  it("builds deterministic result paths under the configured base path", () => {
    expect(githubRemoteCachePath("data/youtube", "dQw4w9WgXcQ", "en")).toBe(
      `data/youtube/dQw4w9WgXcQ/en/${WORKFLOW_VERSION}/result.json`,
    );
  });
});

describe("createGithubRemoteCache", () => {
  it("reads and validates a base64 encoded GitHub contents response", async () => {
    const requests: Request[] = [];
    const provider = createGithubRemoteCache({
      config: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled: false,
        tokenEnv: "FF_GITHUB_TOKEN",
        token: "token-1",
      },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return jsonResponse({
          content: Buffer.from(JSON.stringify(result), "utf8").toString("base64"),
          encoding: "base64",
          sha: "abc123",
        });
      },
    });

    await expect(provider.readResult("dQw4w9WgXcQ", "en")).resolves.toEqual(result);
    expect(requests[0]?.url).toBe(
      `https://api.github.com/repos/octo/cache/contents/data/youtube/dQw4w9WgXcQ/en/${WORKFLOW_VERSION}/result.json?ref=main`,
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer token-1");
  });

  it("returns undefined for GitHub 404 cache misses", async () => {
    const provider = createGithubRemoteCache({
      config: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled: false,
      },
      fetch: async () => new Response("", { status: 404 }),
    });

    await expect(provider.readResult("dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });

  it("returns undefined when GitHub cache metadata does not match the request", async () => {
    const provider = createGithubRemoteCache({
      config: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled: false,
      },
      fetch: async () => jsonResponse({
        content: Buffer.from(JSON.stringify({ ...result, videoId: "aaaaaaaaaaa" }), "utf8").toString("base64"),
        encoding: "base64",
      }),
    });

    await expect(provider.readResult("dQw4w9WgXcQ", "en")).resolves.toBeUndefined();
  });

  it("uploads result JSON with an existing file sha when writes are enabled", async () => {
    const requests: Request[] = [];
    const provider = createGithubRemoteCache({
      config: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled: true,
        tokenEnv: "FF_GITHUB_TOKEN",
        token: "token-1",
      },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === "GET") {
          return jsonResponse({ sha: "existing-sha", content: "", encoding: "base64" });
        }
        return jsonResponse({ content: { sha: "next-sha" } });
      },
    });

    await provider.writeResult(result);

    expect(requests).toHaveLength(2);
    expect(requests[1]?.method).toBe("PUT");
    const body = JSON.parse(await requests[1]!.text()) as {
      message: string;
      branch: string;
      sha: string;
      content: string;
    };
    expect(body).toMatchObject({
      message: "chore(cache): update FluentFrame subtitles for dQw4w9WgXcQ",
      branch: "main",
      sha: "existing-sha",
    });
    expect(JSON.parse(Buffer.from(body.content, "base64").toString("utf8"))).toEqual(result);
  });

  it("uploads results under their own workflow version", async () => {
    const requests: Request[] = [];
    const historicalResult = { ...result, workflowVersion: "2026-07-18-mvp-1" };
    const provider = createGithubRemoteCache({
      config: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled: true,
        token: "token-1",
      },
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return requests.at(-1)?.method === "GET"
          ? new Response("", { status: 404 })
          : jsonResponse({ content: { sha: "next-sha" } });
      },
    });

    await provider.writeResult(historicalResult);

    expect(requests.map((request) => request.url)).toEqual([
      "https://api.github.com/repos/octo/cache/contents/data/youtube/dQw4w9WgXcQ/en/2026-07-18-mvp-1/result.json?ref=main",
      "https://api.github.com/repos/octo/cache/contents/data/youtube/dQw4w9WgXcQ/en/2026-07-18-mvp-1/result.json",
    ]);
  });

  it("skips uploads when writeEnabled is false", async () => {
    let calls = 0;
    const provider = createGithubRemoteCache({
      config: {
        enabled: true,
        provider: "github",
        owner: "octo",
        repo: "cache",
        branch: "main",
        basePath: "data/youtube",
        writeEnabled: false,
      },
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });

    await provider.writeResult(result);

    expect(calls).toBe(0);
  });
});
