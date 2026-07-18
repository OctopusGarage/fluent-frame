import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parsePersonalNotes, type PersonalNote } from "@fluent-frame/shared";

type NotesFile = {
  version: 1;
  notes: PersonalNote[];
};

function parseNotesFile(value: unknown): PersonalNote[] {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid personal notes file");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error("Invalid personal notes file");
  }
  try {
    return parsePersonalNotes(raw.notes);
  } catch {
    throw new Error("Invalid personal notes file");
  }
}

export async function readPersonalNotes(notesFile: string): Promise<PersonalNote[]> {
  try {
    const content = await readFile(notesFile, "utf8");
    return parseNotesFile(JSON.parse(content) as unknown);
  } catch (error) {
    if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    if (error instanceof SyntaxError) {
      throw new Error("Invalid personal notes file");
    }
    throw error;
  }
}

export async function writePersonalNotes(notesFile: string, notes: PersonalNote[]): Promise<void> {
  const checkedNotes = parsePersonalNotes(notes);
  const payload: NotesFile = { version: 1, notes: checkedNotes };
  await mkdir(dirname(notesFile), { recursive: true });
  const tempFile = `${notesFile}.${process.pid}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tempFile, notesFile);
}
