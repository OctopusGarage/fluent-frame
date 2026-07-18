export const OUTBOUND_MAX_BODY_BYTES = 1024 * 1024;
export const INBOUND_MAX_BODY_BYTES = 64 * 1024 * 1024;

export function encodeNativeMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > OUTBOUND_MAX_BODY_BYTES) {
    throw new Error("Native message exceeds outbound size limit");
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function decodeNativeMessage(buffer: Buffer): unknown {
  if (buffer.length < 4) {
    throw new Error("Native message buffer is missing length header");
  }
  const length = buffer.readUInt32LE(0);
  if (length > INBOUND_MAX_BODY_BYTES) {
    throw new Error("Native message exceeds inbound size limit");
  }
  if (buffer.length > 4 + length) {
    throw new Error("Native message has trailing bytes");
  }
  const body = buffer.subarray(4, 4 + length);
  if (body.length !== length) {
    throw new Error("Native message body length mismatch");
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error("Native message body is malformed JSON", { cause: error });
  }
}

type NativeMessageReadable = AsyncIterable<Buffer | Uint8Array | string>;

class NativeFrameReader {
  private buffered = Buffer.alloc(0);
  private readonly iterator: AsyncIterator<Buffer | Uint8Array | string>;

  constructor(stream: NativeMessageReadable) {
    this.iterator = stream[Symbol.asyncIterator]();
  }

  async readExact(length: number, errorMessage: string): Promise<Buffer> {
    while (this.buffered.length < length) {
      const next = await this.iterator.next();
      if (next.done) {
        throw new Error(errorMessage);
      }
      this.buffered = Buffer.concat([this.buffered, toBuffer(next.value)]);
    }

    const result = this.buffered.subarray(0, length);
    this.buffered = this.buffered.subarray(length);
    return result;
  }

  hasBufferedBytes(): boolean {
    return this.buffered.length > 0;
  }
}

function toBuffer(chunk: Buffer | Uint8Array | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

export async function readNativeMessage(stdin: NativeMessageReadable = process.stdin): Promise<unknown> {
  const reader = new NativeFrameReader(stdin);
  const header = await reader.readExact(4, "Native message buffer is missing length header");
  const length = header.readUInt32LE(0);
  if (length > INBOUND_MAX_BODY_BYTES) {
    throw new Error("Native message exceeds inbound size limit");
  }

  const body = await reader.readExact(length, "Native message body length mismatch");
  if (reader.hasBufferedBytes()) {
    throw new Error("Native message has trailing bytes");
  }

  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error("Native message body is malformed JSON", { cause: error });
  }
}

export function writeNativeMessage(message: unknown, stdout: NodeJS.WriteStream = process.stdout): void {
  stdout.write(encodeNativeMessage(message));
}
