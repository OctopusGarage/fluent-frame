const HOME_PATH_PATTERN = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;

export function compactHomePath(path: string): string {
  return path.replace(HOME_PATH_PATTERN, "~");
}
