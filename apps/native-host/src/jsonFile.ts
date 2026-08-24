import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function writeJsonFileAtomically(path: string, value: unknown): Promise<void> {
  const targetDir = dirname(path);
  const tempPath = join(targetDir, `${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(targetDir, { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}
