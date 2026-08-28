/**
 * Pins the decode-only codec contract (Go DecryptionCodec parity;
 * stigmer#398): encode is the IDENTITY even when encryption is configured
 * (server histories stay plaintext), decode delegates to the shared codec
 * (runner-encrypted payloads decrypt; unencrypted payloads pass through;
 * tampering fails closed), and the loader is enabled-iff-configured with
 * boot-fatal misconfiguration.
 */
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { EncryptionPayloadCodec } from "@stigmer/temporal-codecs";
import type { Payload } from "@temporalio/common";

import {
  loadServerPayloadCodecs,
  ServerDecryptionPayloadCodec,
} from "../payload-codec.js";

const KEY = randomBytes(32);
const KEY_ID = "test-key-1";

function textPayload(text: string): Payload {
  return {
    metadata: { encoding: Buffer.from("json/plain") },
    data: Buffer.from(JSON.stringify(text)),
  };
}

function newCodecPair(): {
  runnerSide: EncryptionPayloadCodec;
  serverSide: ServerDecryptionPayloadCodec;
} {
  const config = { primary: { keyId: KEY_ID, key: KEY } };
  return {
    runnerSide: new EncryptionPayloadCodec(config),
    serverSide: new ServerDecryptionPayloadCodec(
      new EncryptionPayloadCodec(config),
    ),
  };
}

describe("ServerDecryptionPayloadCodec", () => {
  it("passes payloads through encode untouched even with a key configured", async () => {
    const { serverSide } = newCodecPair();
    const payload = textPayload("server-authored payload");

    const encoded = await serverSide.encode([payload]);

    expect(encoded).toHaveLength(1);
    // Same object, not an equal copy — identity is the contract.
    expect(encoded[0]).toBe(payload);
  });

  it("decrypts payloads the runner-side codec encrypted", async () => {
    const { runnerSide, serverSide } = newCodecPair();
    const original = textPayload("runner activity result");
    const [encrypted] = await runnerSide.encode([original]);
    expect(Buffer.from(encrypted!.metadata!["encoding"]!).toString()).toBe(
      "binary/encrypted",
    );

    const [decoded] = await serverSide.decode([encrypted!]);

    expect(Buffer.from(decoded!.data!).toString()).toBe(
      JSON.stringify("runner activity result"),
    );
  });

  it("passes through payloads nobody encrypted", async () => {
    const { serverSide } = newCodecPair();
    const payload = textPayload("plaintext history entry");

    const [decoded] = await serverSide.decode([payload]);

    expect(decoded).toBe(payload);
  });

  it("fails closed on tampered ciphertext", async () => {
    const { runnerSide, serverSide } = newCodecPair();
    const [encrypted] = await runnerSide.encode([textPayload("secret")]);
    const tampered: Payload = {
      metadata: encrypted!.metadata,
      data: Buffer.from(
        encrypted!.data!.map((b, i) => (i === 20 ? b ^ 0xff : b)),
      ),
    };

    await expect(serverSide.decode([tampered])).rejects.toThrow();
  });
});

describe("loadServerPayloadCodecs", () => {
  // The loader deliberately reads process.env (see the module header), so
  // these tests set and restore the real environment.
  const ENV_KEYS = [
    "STIGMER_PAYLOAD_ENCRYPTION_KEY",
    "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID",
  ] as const;

  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("returns no codecs when encryption is not configured", () => {
    expect(loadServerPayloadCodecs()).toEqual([]);
  });

  it("returns the decode-only codec when a key pair is configured", () => {
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY"] = KEY.toString("base64");
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY_ID"] = KEY_ID;

    const codecs = loadServerPayloadCodecs();

    expect(codecs).toHaveLength(1);
    expect(codecs[0]).toBeInstanceOf(ServerDecryptionPayloadCodec);
  });

  it("boot-fails on a key without its id (never a silent plaintext downgrade)", () => {
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY"] = KEY.toString("base64");

    expect(() => loadServerPayloadCodecs()).toThrow(/KEY_ID/);
  });

  it("boot-fails on a malformed key", () => {
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY"] =
      Buffer.from("short").toString("base64");
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY_ID"] = KEY_ID;

    expect(() => loadServerPayloadCodecs()).toThrow(/32 bytes/);
  });

  // The resolvePayloadKey threading (C4 Stage 2): the composed provider's
  // capability rides the decode codec as its resolveKey fallback —
  // consulted for key ids outside the env pair, never installed without
  // the env-keyed codec (the named coupling in the module header).
  it("threads the resolver into the decode codec for rpk_ key ids", async () => {
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY"] = KEY.toString("base64");
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY_ID"] = KEY_ID;

    const runnerKey = { keyId: "rpk_identity1", key: randomBytes(32) };
    const desktopRunner = new EncryptionPayloadCodec({ primary: runnerKey });
    const [encrypted] = await desktopRunner.encode([
      textPayload("desktop runner activity result"),
    ]);

    const [codec] = loadServerPayloadCodecs(async (keyId) =>
      keyId === runnerKey.keyId ? runnerKey.key : undefined,
    );
    const [decoded] = await codec!.decode([encrypted!]);

    expect(Buffer.from(decoded!.data!).toString()).toBe(
      JSON.stringify("desktop runner activity result"),
    );
  });

  it("keeps the fail-closed throw when the resolver does not know the id", async () => {
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY"] = KEY.toString("base64");
    process.env["STIGMER_PAYLOAD_ENCRYPTION_KEY_ID"] = KEY_ID;

    const desktopRunner = new EncryptionPayloadCodec({
      primary: { keyId: "rpk_unknown", key: randomBytes(32) },
    });
    const [encrypted] = await desktopRunner.encode([textPayload("secret")]);

    const [codec] = loadServerPayloadCodecs(async () => undefined);
    await expect(codec!.decode([encrypted!])).rejects.toThrow(
      /unknown key id 'rpk_unknown'/,
    );
  });

  it("returns no codecs even with a resolver when encryption is not configured", () => {
    expect(loadServerPayloadCodecs(async () => undefined)).toEqual([]);
  });
});
