/**
 * The Temporal connection settings (`connection/config.ts`): what each
 * setting turns on, the misconfigurations that stop the boot, the rule that
 * an empty value is unset, the refusal to read Temporal's own names (they
 * are the user's), and the round trip through the environment a child
 * runner receives.
 */

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadTemporalConnectionConfig,
  temporalConnectionEnv,
  TEMPORAL_CONNECTION_ENV_NAMES,
} from "../connection/config.js";

const CA = "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----\n";
const CRT = "-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----\n";
const KEY = "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n";

const dir = mkdtempSync(join(tmpdir(), "temporal-connection-config-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function load(env: Record<string, string>) {
  return loadTemporalConnectionConfig((name) => env[name]);
}

function text(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : Buffer.from(bytes).toString("utf8");
}

describe("loadTemporalConnectionConfig", () => {
  it("is a plaintext connection when nothing is set", () => {
    expect(load({})).toEqual({});
  });

  it("treats every empty or blank value as unset", () => {
    expect(
      load({
        STIGMER_TEMPORAL_API_KEY: "",
        STIGMER_TEMPORAL_TLS: "  ",
        STIGMER_TEMPORAL_TLS_SERVER_NAME: "",
        STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA: "",
        STIGMER_TEMPORAL_TLS_CLIENT_CERT_PATH: "",
      }),
    ).toEqual({});
  });

  it("never reads Temporal's own TEMPORAL_* names, which are the user's", () => {
    expect(
      load({
        TEMPORAL_API_KEY: "the-users-own-key",
        TEMPORAL_TLS: "true",
        TEMPORAL_TLS_SERVER_CA_CERT_DATA: CA,
      }),
    ).toEqual({});
  });

  it("turns TLS on with the system's roots for STIGMER_TEMPORAL_TLS=true or 1", () => {
    expect(load({ STIGMER_TEMPORAL_TLS: "true" })).toEqual({ tls: {} });
    expect(load({ STIGMER_TEMPORAL_TLS: "1" })).toEqual({ tls: {} });
    expect(load({ STIGMER_TEMPORAL_TLS: "false" })).toEqual({});
  });

  it("an API key implies TLS", () => {
    expect(load({ STIGMER_TEMPORAL_API_KEY: " k-1 " })).toEqual({ tls: {}, apiKey: "k-1" });
  });

  it("a CA or a server name implies TLS and is carried in the SDK's shape", () => {
    const config = load({
      STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA: CA,
      STIGMER_TEMPORAL_TLS_SERVER_NAME: "temporal.internal",
    });
    expect(config.tls?.serverNameOverride).toBe("temporal.internal");
    expect(text(config.tls?.serverRootCACertificate)).toBe(CA);
    expect(config.apiKey).toBeUndefined();
  });

  it("reads a client pair for mutual TLS, from data or from files", () => {
    const fromData = load({
      STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA: CRT,
      STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA: KEY,
    });
    expect(text(fromData.tls?.clientCertPair?.crt)).toBe(CRT);
    expect(text(fromData.tls?.clientCertPair?.key)).toBe(KEY);

    writeFileSync(join(dir, "client.crt"), CRT);
    writeFileSync(join(dir, "client.key"), KEY);
    const fromFiles = load({
      STIGMER_TEMPORAL_TLS_CLIENT_CERT_PATH: join(dir, "client.crt"),
      STIGMER_TEMPORAL_TLS_CLIENT_KEY_PATH: join(dir, "client.key"),
    });
    expect(text(fromFiles.tls?.clientCertPair?.crt)).toBe(CRT);
    expect(text(fromFiles.tls?.clientCertPair?.key)).toBe(KEY);
  });

  it.each([
    [{ STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA: CRT }, /mutual TLS needs both/],
    [{ STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA: KEY }, /mutual TLS needs both/],
    [
      {
        STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA: CA,
        STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_PATH: "/etc/ca.pem",
      },
      /set STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_PATH or STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA, not both/,
    ],
    [
      { STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_PATH: "/nonexistent/ca.pem" },
      /STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_PATH "\/nonexistent\/ca.pem" cannot be read/,
    ],
    [{ STIGMER_TEMPORAL_TLS: "yes" }, /must be true, 1, false or 0/],
    [
      { STIGMER_TEMPORAL_TLS: "false", STIGMER_TEMPORAL_API_KEY: "k" },
      /STIGMER_TEMPORAL_TLS is false while/,
    ],
  ])("stops the boot on a contradictory or unreadable setting (%o)", (env, message) => {
    expect(() => load(env)).toThrow(message);
  });

  it("reads every value through the injected reader, and only it", () => {
    const asked: string[] = [];
    loadTemporalConnectionConfig((name) => {
      asked.push(name);
      return undefined;
    });
    // The exported list is exactly what the reader reads, so a process
    // that strips inherited settings strips all of them and nothing else.
    expect([...new Set(asked)].sort()).toEqual([...TEMPORAL_CONNECTION_ENV_NAMES].sort());
  });
});

describe("temporalConnectionEnv", () => {
  it("renders nothing for a plaintext connection", () => {
    expect(temporalConnectionEnv({})).toEqual({});
  });

  it("round-trips every setting through the _DATA forms a child runner reads", () => {
    writeFileSync(join(dir, "ca.pem"), CA);
    const loaded = load({
      STIGMER_TEMPORAL_API_KEY: "k-2",
      STIGMER_TEMPORAL_TLS_SERVER_NAME: "temporal.internal",
      STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_PATH: join(dir, "ca.pem"),
      STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA: CRT,
      STIGMER_TEMPORAL_TLS_CLIENT_KEY_DATA: KEY,
    });
    const env = temporalConnectionEnv(loaded);

    expect(Object.keys(env).some((name) => name.endsWith("_PATH"))).toBe(false);
    expect(env["STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_DATA"]).toBe(CA);
    expect(load(env)).toEqual(loaded);
  });
});
