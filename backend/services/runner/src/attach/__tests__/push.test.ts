/**
 * Pins the attach push's checks (push.ts):
 *
 *   - the sandbox name derived from a queue is byte-identical to the server's
 *     `sandboxBaseName`, by vectors both packages pin
 *     (stigmer-server `src/sandbox/__tests__/provisioner.test.ts`);
 *   - a queue pushed to a sandbox whose name is not the one derived from it is
 *     refused, on all three queue kinds, without reading the token;
 *   - the push can set only the runner's secret variables;
 *   - a token must be JWT-shaped and unexpired, and an empty token (the
 *     tokenless lane) passes.
 */
import { describe, expect, it } from "vitest";

import { sandboxNameForQueue, verifyAttachPush } from "../push.js";

const NOW = 1_800_000_000;

function jwt(payload: Record<string, unknown>): string {
  const b64 = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

const SESSION_QUEUE = "session:ses_01m3zkdb7wxbe2gx0ezmf8fmaq";
const SESSION_SANDBOX = "sbx-ses-4e918096d317";

describe("sandboxNameForQueue", () => {
  it("matches the server's sandboxBaseName vectors for every queue kind", () => {
    expect(sandboxNameForQueue(SESSION_QUEUE)).toBe(SESSION_SANDBOX);
    expect(sandboxNameForQueue("wfexec:wfx_01m3zk8zjqdj5jsep1zngaawxq")).toBe("sbx-wfx-6406dd0a36ee");
    expect(sandboxNameForQueue("mcpconnect:aex_01m3zkdb6zbg983x4yvttsysyy")).toBe("sbx-mcp-aa8898c8a32c");
  });

  it("names no sandbox for a queue a sandbox does not serve", () => {
    expect(sandboxNameForQueue("sandbox:pm_1")).toBeUndefined();
    expect(sandboxNameForQueue("stigmer_runner")).toBeUndefined();
    expect(sandboxNameForQueue("session:")).toBeUndefined();
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
      expect(verdict).toMatchObject({ ok: false, status: 403 });
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
      expect(verdict).toMatchObject({ ok: false, status: 403 });
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

  it("refuses malformed bodies", () => {
    for (const body of [null, [], "push", { secrets: {} }, { taskQueue: "", secrets: {} }, { taskQueue: SESSION_QUEUE }, { taskQueue: SESSION_QUEUE, secrets: { STIGMER_TOKEN: 1 } }]) {
      expect(verifyAttachPush(body, SESSION_SANDBOX, NOW)).toMatchObject({ ok: false, status: 400 });
    }
  });
});
