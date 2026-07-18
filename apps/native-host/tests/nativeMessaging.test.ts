import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  decodeNativeMessage,
  encodeNativeMessage,
  INBOUND_MAX_BODY_BYTES,
  readNativeMessage,
} from "../src/nativeMessaging.js";

describe("native messaging framing", () => {
  it("round-trips one JSON message", () => {
    const encoded = encodeNativeMessage({ ok: true });
    expect(decodeNativeMessage(encoded)).toEqual({ ok: true });
  });

  it("throws for oversized outbound responses", () => {
    expect(() => encodeNativeMessage("x".repeat(1024 * 1024))).toThrow("Native message exceeds outbound size limit");
  });

  it("throws for oversized inbound frames", () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(INBOUND_MAX_BODY_BYTES + 1, 0);

    expect(() => decodeNativeMessage(header)).toThrow("Native message exceeds inbound size limit");
  });

  it("throws for partial bodies", () => {
    const partial = Buffer.alloc(7);
    partial.writeUInt32LE(4, 0);
    partial.write("nul", 4, "utf8");

    expect(() => decodeNativeMessage(partial)).toThrow("Native message body length mismatch");
  });

  it("throws for trailing bytes after one frame", () => {
    const encoded = encodeNativeMessage({ ok: true });

    expect(() => decodeNativeMessage(Buffer.concat([encoded, Buffer.from([0])]))).toThrow(
      "Native message has trailing bytes",
    );
  });

  it("throws for malformed JSON", () => {
    const body = Buffer.from("{", "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);

    expect(() => decodeNativeMessage(Buffer.concat([header, body]))).toThrow("Native message body is malformed JSON");
  });

  it("reads one exact frame from a stream", async () => {
    const encoded = encodeNativeMessage({ ok: true });
    const stream = new PassThrough();
    stream.write(encoded.subarray(0, 2));
    stream.write(encoded.subarray(2));

    try {
      await expect(
        Promise.race([
          readNativeMessage(stream),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Timed out waiting for native message")), 50);
          }),
        ]),
      ).resolves.toEqual({ ok: true });
    } finally {
      stream.destroy();
    }
  });
});
