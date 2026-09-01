export function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}

export function isExtensionContextInvalidated(error: unknown): boolean {
  return errorMessage(error)?.includes("Extension context invalidated") ?? false;
}
