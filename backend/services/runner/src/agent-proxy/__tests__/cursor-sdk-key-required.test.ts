/**
 * An organization with no Cursor key, end to end with the real SDK:
 * `@cursor/sdk` in a process of its own (`__test-utils__/cursor-sdk-wire-child.ts`),
 * through the real local proxy's Cursor lane in forward mode, against a
 * stand-in for the Stigmer Cloud proxy that refuses every REST call the way
 * the cloud's Cursor REST lane refuses an organization with no Cursor key:
 * HTTP 403 with `{"code":"permission_denied","message":"… [code:
 * STIGMER_PROVIDER_KEY_REQUIRED]"}`.
 *
 * The refusal reaches the SDK at its key exchange, the first call a turn
 * makes. The classifier recognises it only by the code in the message, so
 * what this test pins is that the SDK keeps the body's message on the error
 * it throws, and that the runner's classification of that error (the
 * `CursorSdkError` arm of `execute-cursor/turn.ts`) reads as the missing
 * key and is not retried. Every other test of the wording doubles the SDK.
 */

import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { formatClassifiedError, synthesizeError } from "../../activities/execute-cursor/error-classifier.js";
import { writeTrustedCertificates } from "../../agent-host/hosting.js";
import { PROVIDER_KEY_REQUIRED_SENTINEL } from "../../shared/model-error.js";
import { AgentProxy } from "../server.js";

const HOST_TOKEN = "host-token-key-required";
const RUNNER_TOKEN = "runner-token-key-required";
const EXECUTION = "aex-key-required";
const TURN_KEY = "turn-key-key-required";
const CHILD = fileURLToPath(new URL("../../__test-utils__/cursor-sdk-wire-child.ts", import.meta.url));
const NO_KEY = "This organization has no Cursor key. An admin can add one in Settings → Provider keys.";

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
}

interface Reported {
  readonly status: string;
  readonly error: string | null;
  readonly sdkError?: { readonly code: string | null; readonly status: number | null };
}

/** The Stigmer Cloud proxy for an organization with no Cursor key: every REST call refused. */
const seen: Seen[] = [];
const cloud = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    seen.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers });
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "permission_denied", message: `${NO_KEY} [code: ${PROVIDER_KEY_REQUIRED_SENTINEL}]` }));
  });
});
let proxy: AgentProxy;
let trust: { readonly file: string; remove(): void };

beforeAll(async () => {
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const proxyEndpoint = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`;
  proxy = await AgentProxy.start(testConfig({ proxyEndpoint, proxyTokenRef: { current: RUNNER_TOKEN } }));
  proxy.authorizeHost(HOST_TOKEN);
  proxy.openTurn({ executionId: EXECUTION, threadId: "thread-ses-key-required", turnKey: TURN_KEY });
  trust = writeTrustedCertificates(proxy.cursorCertificate, undefined);
});

afterAll(async () => {
  await proxy.close();
  trust.remove();
  await new Promise<void>((resolve) => cloud.close(() => resolve()));
});

/** Run the SDK's side in its own process and read the line it reports. */
function runSdk(): Promise<Reported> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_EXTRA_CA_CERTS: trust.file, CURSOR_BACKEND_URL: proxy.cursorEndpoint };
    delete env.NODE_TLS_REJECT_UNAUTHORIZED;
    const child = spawn(process.execPath, ["--import", "tsx", CHILD, proxy.cursorEndpoint, HOST_TOKEN, EXECUTION, TURN_KEY], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
    child.on("exit", () => {
      const line = out.split("\n").find((l) => l.startsWith("WIRE "));
      if (line === undefined) reject(new Error(`the SDK's process reported nothing:\n${out}\n${err}`));
      else resolve(JSON.parse(line.slice("WIRE ".length)) as Reported);
    });
  });
}

describe("the real Cursor SDK refused for an organization with no Cursor key", () => {
  it("keeps the refusal's code on the error it throws, and the runner words it as the missing key, not retried", async () => {
    const result = await runSdk();

    const exchange = seen.find((s) => s.path === "/v1/proxy/cursor/api2.cursor.sh/auth/exchange_user_api_key");
    expect(exchange?.method, "the key exchange reached the cloud through the lane").toBe("POST");
    expect(exchange?.headers.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
    expect(exchange?.headers["x-stigmer-execution-id"]).toBe(EXECUTION);

    expect(result.status).toBe("thrown");
    expect(result.error).toContain(PROVIDER_KEY_REQUIRED_SENTINEL);
    expect(result.sdkError, "the SDK threw a CursorSdkError").toBeDefined();

    // As `classifyThrown` in execute-cursor/turn.ts classifies a CursorSdkError.
    const classified = synthesizeError({
      sdkError: { code: result.sdkError?.code ?? undefined, status: result.sdkError?.status ?? undefined, message: result.error ?? undefined },
      sdkResultFields: undefined,
      streamErrorMessage: undefined,
      capturedRejection: undefined,
      isResumedHandle: false,
      fallbackContext: { model: "composer-2.5", mode: "local", agentId: "" },
    });
    expect(formatClassifiedError(classified)).toBe(`${NO_KEY} [category=auth, source=sdk, retryable=false]`);
  }, 60_000);
});
