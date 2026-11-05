/**
 * The lane's small parts: a receipt opens only under its key, for its
 * queue, unaltered; the frame helpers read gRPC's own encodings; the
 * held-poll limits count per sandbox and in all and free a slot once; the
 * receipt key is one claimed row, read once, retried after a failure, and
 * refused when it is not 32 bytes.
 */
import { describe, expect, it, vi } from "vitest";

import { temporalAddressThroughServer } from "../address.js";
import { newHeldPolls } from "../capacity.js";
import { grpcTimeoutMs, percentEncode, readUnaryMessage, unframe, writeGrpcAnswer } from "../frame.js";
import { issueReceipt, openReceipt } from "../receipts.js";
import { RECEIPT_KEY_STATE_KEY, newReceiptKeySource } from "../receipt-key.js";

const KEY = Buffer.alloc(32, 1);

describe("receipts", () => {
  it("open under their key to their queue and Temporal's token", () => {
    const receipt = issueReceipt(KEY, "session:ses_é", Buffer.from("tok"));
    expect(openReceipt(KEY, receipt)).toEqual({ queue: "session:ses_é", token: new Uint8Array(Buffer.from("tok")) });
  });

  it("refuse another key, an altered byte, another version, and short or empty bytes", () => {
    const receipt = issueReceipt(KEY, "session:a", Buffer.from("tok"));
    expect(openReceipt(Buffer.alloc(32, 2), receipt)).toBeUndefined();
    for (const index of [5, receipt.length - 1]) {
      const altered = Buffer.from(receipt);
      altered[index] = (altered[index] ?? 0) ^ 1;
      expect(openReceipt(KEY, altered)).toBeUndefined();
    }
    const versioned = Buffer.from(receipt);
    versioned[0] = 2;
    expect(openReceipt(KEY, versioned)).toBeUndefined();
    expect(openReceipt(KEY, receipt.subarray(0, 3 + 9 + 32))).toBeUndefined();
    expect(openReceipt(KEY, new Uint8Array([1]))).toBeUndefined();
  });
});

describe("frame helpers", () => {
  it("unframe one message, and refuse a length that disagrees", () => {
    expect(unframe(Buffer.from([0, 0, 0, 0, 2, 7, 8]))).toEqual({ ok: true, message: Buffer.from([7, 8]) });
    expect(unframe(Buffer.from([0, 0, 0, 0, 3, 7, 8]))).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("read grpc-timeout in each unit, and nothing else", () => {
    expect(grpcTimeoutMs("7S")).toBe(7_000);
    expect(grpcTimeoutMs("1H")).toBe(3_600_000);
    expect(grpcTimeoutMs("2M")).toBe(120_000);
    expect(grpcTimeoutMs("250m")).toBe(250);
    expect(grpcTimeoutMs("5000u")).toBe(5);
    expect(grpcTimeoutMs("1000000n")).toBe(1);
    for (const bad of ["7", "S", "123456789S", undefined, ["7S"]]) expect(grpcTimeoutMs(bad)).toBeUndefined();
  });

  it("refuse a body larger than the message cap, and write nothing to an answered response", async () => {
    const body = (async function* () {
      yield Buffer.alloc(8);
      yield Buffer.alloc(8);
    })();
    expect(await readUnaryMessage(body as never, 4)).toMatchObject({ ok: false, reason: "tooLarge", code: 8 });
    const writeHead = vi.fn();
    writeGrpcAnswer({ headersSent: true, destroyed: false, writeHead } as never, { code: 0 });
    writeGrpcAnswer({ headersSent: false, destroyed: true, writeHead } as never, { code: 0 });
    expect(writeHead).not.toHaveBeenCalled();
  });

  it("percent-encode grpc-message as gRPC does", () => {
    expect(percentEncode("ok 100%\n é")).toBe("ok 100%25%0A %C3%A9");
  });
});

describe("held polls", () => {
  it("count per sandbox and in all, and free a slot once", () => {
    const held = newHeldPolls(2, 3);
    const a1 = held.hold("a");
    const a2 = held.hold("a");
    expect(held.hold("a")).toEqual({ refused: "per-sandbox" });
    const b1 = held.hold("b");
    expect(held.hold("c")).toEqual({ refused: "in-all" });
    if (!("release" in a1) || !("release" in a2) || !("release" in b1)) throw new Error("expected slots");
    a1.release();
    a1.release();
    expect("release" in held.hold("c")).toBe(true);
    expect(held.hold("d")).toEqual({ refused: "in-all" });
    a2.release();
    b1.release();
    expect("release" in held.hold("a")).toBe(true);
  });
});

describe("the receipt key", () => {
  it("is one claimed row of 32 random bytes, read once per process", async () => {
    const claim = vi.fn(async (_key: string, value: string) => value);
    const key = newReceiptKeySource({ claim });
    const first = await key();
    expect(await key()).toBe(first);
    expect(first).toHaveLength(32);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0]?.[0]).toBe(RECEIPT_KEY_STATE_KEY);
  });

  it("takes the winner's key, retries after a failure, and refuses a key of the wrong size", async () => {
    const winner = Buffer.alloc(32, 4).toString("base64");
    const claim = vi
      .fn<(key: string, value: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("store down"))
      .mockResolvedValueOnce(winner);
    const key = newReceiptKeySource({ claim });
    await expect(key()).rejects.toThrow("store down");
    expect((await key()).toString("base64")).toBe(winner);
    await expect(newReceiptKeySource({ claim: async () => "c2hvcnQ=" })()).rejects.toThrow(/not 32 bytes/);
  });
});

describe("temporalAddressThroughServer (a sandbox's Temporal address: the server's own)", () => {
  it("reads the backend endpoint as the runner reads it", () => {
    expect(temporalAddressThroughServer("http://stigmer.stigmer.svc:7234")).toBe("stigmer.stigmer.svc:7234");
    expect(temporalAddressThroughServer("https://api.stigmer.ai")).toBe("api.stigmer.ai:443");
    expect(temporalAddressThroughServer("http://Host.Docker.Internal")).toBe("host.docker.internal:80");
    expect(temporalAddressThroughServer("localhost:7234")).toBe("localhost:7234");
    expect(temporalAddressThroughServer("api.stigmer.ai:443")).toBe("api.stigmer.ai:443");
  });
});
