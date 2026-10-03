/**
 * Pins the attach push's checks (push.ts):
 *
 *   - the sandbox name derived from a queue is the server's own
 *     `sandboxBaseName` for that scope and id, under the server's own queue
 *     prefix for the scope: the test loads the server's module
 *     (`stigmer-server/src/sandbox/naming.ts`, the one home of the
 *     derivation and of SANDBOX_QUEUE_PREFIXES) and compares the two over
 *     generated ids, so a change on either side turns it red;
 *   - a queue pushed to a sandbox whose name is not the one derived from it is
 *     refused, on all three queue kinds, without reading the token;
 *   - the push can set only the runner's secret variables;
 *   - a token must be JWT-shaped and unexpired, and an empty token (the
 *     tokenless lane) passes;
 *   - every refusal carries its stable code;
 *   - the secret names a push may carry are the server's copy of them
 *     (`stigmer-server/src/sandbox/runner-secret-names.ts`), which the
 *     server checks an operator's runner lists against at boot.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { sandboxNameForQueue, verifyAttachPush } from "../push.js";
import { RUNNER_SECRET_ENV_KEYS } from "../../shared/runner-credential-keys.js";

const NOW = 1_800_000_000;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

const SESSION_QUEUE = "session:ses_01m3zkdb7wxbe2gx0ezmf8fmaq";
const SESSION_SANDBOX = "sbx-ses-4e918096d317";

type ServerScope = "session" | "workflow" | "connect";
interface ServerNaming {
  sandboxBaseName(scope: ServerScope, id: string): string;
  SANDBOX_QUEUE_PREFIXES: Readonly<Record<ServerScope, string>>;
}

/**
 * The server's naming module, loaded by URL so the runner's typecheck does not
 * follow the server's imports; the runner imports nothing from the server.
 */
async function serverNaming(): Promise<ServerNaming> {
  const path = resolve(import.meta.dirname, "../../../../stigmer-server/src/sandbox/naming.ts");
  return (await import(pathToFileURL(path).href)) as ServerNaming;
}

describe("sandboxNameForQueue", () => {
  it("is the server's sandboxBaseName for every queue kind", async () => {
    const { sandboxBaseName, SANDBOX_QUEUE_PREFIXES } = await serverNaming();
    const kinds = Object.entries(SANDBOX_QUEUE_PREFIXES).map(
      ([scope, prefix]) => [prefix, scope as ServerScope] as const,
    );
    expect(kinds.map(([prefix]) => prefix).sort()).toEqual(["mcpconnect:", "session:", "wfexec:"]);
    const ids = ["ses_01m3zkdb7wxbe2gx0ezmf8fmaq", "wfx_01J_UNDERSCORED.id", ...Array.from({ length: 50 }, () => randomUUID())];
    for (const [prefix, scope] of kinds) {
      for (const id of ids) {
        expect(sandboxNameForQueue(`${prefix}${id}`)).toBe(sandboxBaseName(scope, id));
      }
    }
    expect(sandboxNameForQueue(SESSION_QUEUE)).toBe(SESSION_SANDBOX);
  });

  it("names no sandbox for a queue a sandbox does not serve", () => {
    expect(sandboxNameForQueue("sandbox:pm_1")).toBeUndefined();
    expect(sandboxNameForQueue("stigmer_runner")).toBeUndefined();
    expect(sandboxNameForQueue("session:")).toBeUndefined();
  });
});

describe("the secret names a push may carry", () => {
  it("are the runner's secret names as the server knows them", async () => {
    const path = resolve(
      import.meta.dirname,
      "../../../../stigmer-server/src/sandbox/runner-secret-names.ts",
    );
    const { RUNNER_SECRET_NAMES } = (await import(pathToFileURL(path).href)) as {
      RUNNER_SECRET_NAMES: readonly string[];
    };
    expect([...RUNNER_SECRET_NAMES].sort()).toEqual([...RUNNER_SECRET_ENV_KEYS].sort());
  });
});

describe("verifyAttachPush", () => {
  const token = jwt({ token_type: "sandbox", session_id: "ses_01m3zkdb7wxbe2gx0ezmf8fmaq", exp: NOW + 3600 });

  it("accepts a push for this sandbox's queue with the runner's secrets", () => {
    const secrets = { STIGMER_TOKEN: token, STIGMER_PAYLOAD_ENCRYPTION_KEY: "k" };
    expect(verifyAttachPush({ taskQueue: SESSION_QUEUE, secrets }, SESSION_SANDBOX, NOW)).toEqual({
      ok: true,
      push: { taskQueue: SESSION_QUEUE, secrets },
    });
  });

  it("refuses a queue that another sandbox serves, on every queue kind", () => {
    for (const taskQueue of [
      "session:ses_other",
      "wfexec:wfx_01m3zk8zjqdj5jsep1zngaawxq",
      "mcpconnect:aex_01m3zkdb6zbg983x4yvttsysyy",
    ]) {
      const verdict = verifyAttachPush({ taskQueue, secrets: { STIGMER_TOKEN: token } }, SESSION_SANDBOX, NOW);
      expect(verdict).toMatchObject({ ok: false, status: 403, code: "binding" });
    }
  });

  it("refuses a queue no sandbox serves", () => {
    expect(verifyAttachPush({ taskQueue: "sandbox:pm_1", secrets: {} }, SESSION_SANDBOX, NOW)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("accepts the tokenless lane: no token, or an empty one", () => {
    expect(verifyAttachPush({ taskQueue: SESSION_QUEUE, secrets: {} }, SESSION_SANDBOX, NOW).ok).toBe(true);
    expect(
      verifyAttachPush({ taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: "" } }, SESSION_SANDBOX, NOW).ok,
    ).toBe(true);
  });

  it("refuses a token that is not a JWT, or has expired", () => {
    for (const bad of ["not-a-jwt", "a.b.c", jwt({ exp: NOW }), jwt({ exp: NOW - 1 })]) {
      const verdict = verifyAttachPush({ taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: bad } }, SESSION_SANDBOX, NOW);
      expect(verdict).toMatchObject({ ok: false, status: 403, code: "token_unusable" });
    }
  });

  it("accepts a JWT without an exp claim (the server decides its validity)", () => {
    const verdict = verifyAttachPush(
      { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: jwt({ token_type: "execution_scoped" }) } },
      SESSION_SANDBOX,
      NOW,
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a push that would set anything but the runner's secret variables", () => {
    for (const secrets of [{ STIGMER_TASK_QUEUE: "session:x" }, { NODE_OPTIONS: "--require /tmp/x.js" }, { PATH: "/tmp" }]) {
      expect(verifyAttachPush({ taskQueue: SESSION_QUEUE, secrets }, SESSION_SANDBOX, NOW)).toMatchObject({
        ok: false,
        status: 400,
      });
    }
  });

  it("refuses a NUL byte in the queue or in any secret, which no process can receive", () => {
    expect(verifyAttachPush({ taskQueue: `${SESSION_QUEUE}\u0000`, secrets: {} }, SESSION_SANDBOX, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(verifyAttachPush({ taskQueue: SESSION_QUEUE, secrets: { STIGMER_PAYLOAD_ENCRYPTION_KEY: "k\u0000" } }, SESSION_SANDBOX, NOW)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses malformed bodies", () => {
    for (const body of [null, [], "push", { secrets: {} }, { taskQueue: "", secrets: {} }, { taskQueue: SESSION_QUEUE }, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: 1 } }]) {
      expect(verifyAttachPush(body, SESSION_SANDBOX, NOW)).toMatchObject({ ok: false, status: 400, code: "malformed" });
    }
  });
});
