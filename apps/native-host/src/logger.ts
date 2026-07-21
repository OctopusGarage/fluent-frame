import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  level: LogLevel;
  component: string;
  event: string;
  message: string;
  requestId?: string;
  jobId?: string;
  videoId?: string;
  details?: Record<string, unknown>;
};

export type Logger = {
  log(event: LogEvent): Promise<void>;
};

export type LoggerOptions = {
  maxBytes?: number;
  now?: () => string;
};

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

function safeDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [
    key,
    value instanceof Error ? normalizeError(value) : value,
  ]));
}

async function rotateIfNeeded(logFile: string, maxBytes: number): Promise<void> {
  try {
    const file = await stat(logFile);
    if (file.size < maxBytes) {
      return;
    }
    await rename(logFile, `${logFile}.1`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function createLogger(logFile: string, options: LoggerOptions = {}): Logger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async log(event) {
      try {
        await mkdir(dirname(logFile), { recursive: true });
        await rotateIfNeeded(logFile, maxBytes);
        const line = {
          timestamp: now(),
          level: event.level,
          component: event.component,
          event: event.event,
          message: event.message,
          ...(event.requestId ? { requestId: event.requestId } : {}),
          ...(event.jobId ? { jobId: event.jobId } : {}),
          ...(event.videoId ? { videoId: event.videoId } : {}),
          ...(event.details ? { details: safeDetails(event.details) } : {}),
        };
        await appendFile(logFile, `${JSON.stringify(line)}\n`, "utf8");
      } catch {
        // Logging must never break native messaging or queue processing.
      }
    },
  };
}
