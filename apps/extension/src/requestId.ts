export function createRequestId(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}
