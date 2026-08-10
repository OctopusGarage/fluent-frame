import type { HostRequest, HostResponse } from "@fluent-frame/shared";
import type { HostConfig } from "./config.js";
import { readPersonalNotes, writePersonalNotes } from "./notes.js";

type GetPersonalNotesRequest = Extract<HostRequest, { type: "getPersonalNotes" }>;
type SavePersonalNotesRequest = Extract<HostRequest, { type: "savePersonalNotes" }>;

function notesErrorResponse(id: string, error: unknown): HostResponse {
  return {
    id,
    ok: false,
    type: "error",
    code: "NOTES_ERROR",
    message: error instanceof Error ? error.message : "Notes operation failed",
  };
}

export function createNotesRequestHandler(config: HostConfig) {
  return {
    async getPersonalNotes(request: GetPersonalNotesRequest): Promise<HostResponse> {
      try {
        return { id: request.id, ok: true, type: "personalNotes", notes: await readPersonalNotes(config.notesFile) };
      } catch (error) {
        return notesErrorResponse(request.id, error);
      }
    },
    async savePersonalNotes(request: SavePersonalNotesRequest): Promise<HostResponse> {
      try {
        await writePersonalNotes(config.notesFile, request.notes);
        return { id: request.id, ok: true, type: "personalNotesSaved" };
      } catch (error) {
        return notesErrorResponse(request.id, error);
      }
    },
  };
}
