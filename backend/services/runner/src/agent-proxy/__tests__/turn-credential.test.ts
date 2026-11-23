/**
 * Whose credential a call through the local proxy (`agent-proxy/server.ts`)
 * reaches the Stigmer platform with: the credential of the turn whose key it
 * carries, never the runner's own key while that turn has one, and never
 * another turn's.
 *
 * Why it matters: a runner shared by many organizations holds a key that
 * opens nothing but its Temporal door, so a turn's model, checkpoint and
 * engine-session calls must each go out as that turn's own person. Two
 * turns of two organizations run at once here, each opened by its own
 * locked host's slot; every forwarded call is read at the fake platform.
 *
 * What these pin:
 *  - each turn's model, checkpoint and engine-session calls carry that
 *    turn's credential, in the same window as the other turn's;
 *  - a turn opened without a credential (a dispatch that carried none)
 *    falls back to the runner's own token, as the artifact store does;
 *  - a host presenting another slot's turn key is refused, so turn A's host
 *    cannot borrow turn B's credential, and nothing reaches the platform;
 *  - a turn opened without a slot belongs to the open host.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { FakeUpstream } from "../../__test-utils__/fake-upstream.js";
import { AgentProxy } from "../server.js";

const RUNNER_TOKEN = "shared-runner-key";
const BODY = JSON.stringify({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] });

/** One turn of one organization, on its own locked host's slot. */
const ORG_A = { slot: "fenced-0", hostToken: "host-token-a", executionId: "run_org_a", threadId: "thread-ses-a", turnKey: "turn-key-a", credential: "credential-of-org-a" };
const ORG_B = { slot: "fenced-1", hostToken: "host-token-b", executionId: "run_org_b", threadId: "thread-ses-b", turnKey: "turn-key-b", credential: "credential-of-org-b" };
type Turn = typeof ORG_A;

const upstream = new FakeUpstream();
let proxy: AgentProxy;
const closes: (() => void)[] = [];

beforeAll(() => upstream.start());
afterAll(() => upstream.stop());
beforeEach(async () => {
  upstream.received.length = 0;
  proxy = await AgentProxy.start(
    testConfig({ stigmerTokenRef: { current: RUNNER_TOKEN }, proxyEndpoint: upstream.url, checkpointerType: "http", checkpointerProxyEndpoint: upstream.url }),
  );
});
afterEach(async () => {
  for (const close of closes.splice(0)) close();
  await proxy.close();
});

/** Open `turn` in its slot, with its credential, or none when `credential` is `null`. */
function open(turn: Turn, credential: string | null = turn.credential): void {
  proxy.authorizeHost(turn.slot, turn.hostToken);
  closes.push(proxy.openTurn({ executionId: turn.executionId, threadId: turn.threadId, turnKey: turn.turnKey, slot: turn.slot, ...(credential === null ? {} : { credential }) }));
}

function asHostOf(turn: Turn, key: string = turn.turnKey): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${turn.hostToken}`, "x-stigmer-execution-id": turn.executionId, "x-stigmer-turn-key": key };
}

async function modelCall(turn: Turn): Promise<number> {
  const res = await fetch(`${proxy.endpoint}/v1/proxy/llm/anthropic/v1/messages`, { method: "POST", headers: asHostOf(turn), body: BODY });
  await res.text();
  return res.status;
}

async function checkpointRead(turn: Turn): Promise<number> {
  const res = await fetch(`${proxy.endpoint}/v1/proxy/checkpoints/checkpoint?thread_id=${turn.threadId}&checkpoint_ns=`, { headers: asHostOf(turn) });
  await res.text();
  return res.status;
}

async function engineSessionWrite(turn: Turn): Promise<number> {
  const res = await fetch(`${proxy.endpoint}/v1/proxy/engine-sessions/entries`, {
    method: "PUT",
    headers: asHostOf(turn),
    body: JSON.stringify({ thread_id: turn.threadId, entries: [] }),
  });
  await res.text();
  return res.status;
}

/** The bearer each forwarded call reached the platform with, by the execution or thread it named. */
function bearersFor(turn: Turn): string[] {
  return upstream.received
    .filter((r) => r.headers["x-stigmer-execution-id"] === turn.executionId || r.path.includes(turn.threadId) || r.body.includes(turn.threadId))
    .map((r) => String(r.headers.authorization));
}

describe("every call a turn makes through the local proxy carries that turn's credential", () => {
  it("two turns of two organizations at once: each model, checkpoint and engine-session call carries its own turn's credential", async () => {
    open(ORG_A);
    open(ORG_B);

    const statuses = await Promise.all([
      modelCall(ORG_A),
      modelCall(ORG_B),
      checkpointRead(ORG_B),
      checkpointRead(ORG_A),
      engineSessionWrite(ORG_A),
      engineSessionWrite(ORG_B),
    ]);

    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    expect(bearersFor(ORG_A)).toEqual(Array(3).fill(`Bearer ${ORG_A.credential}`));
    expect(bearersFor(ORG_B)).toEqual(Array(3).fill(`Bearer ${ORG_B.credential}`));
    expect(JSON.stringify(upstream.received.map((r) => r.headers)), "the runner's own key reaches the platform on no call").not.toContain(RUNNER_TOKEN);
  });

  it("falls back to the runner's own token for a turn whose dispatch carried no credential", async () => {
    open(ORG_A, null);

    expect(await modelCall(ORG_A)).toBe(200);
    expect(await checkpointRead(ORG_A)).toBe(200);
    expect(bearersFor(ORG_A)).toEqual([`Bearer ${RUNNER_TOKEN}`, `Bearer ${RUNNER_TOKEN}`]);
  });

  it("refuses turn A's host a call under turn B's key, so it never reaches the platform with B's credential", async () => {
    open(ORG_A);
    open(ORG_B);

    const borrowed = { ...ORG_A, executionId: ORG_B.executionId, threadId: ORG_B.threadId };
    const model = await fetch(`${proxy.endpoint}/v1/proxy/llm/anthropic/v1/messages`, { method: "POST", headers: asHostOf(borrowed, ORG_B.turnKey), body: BODY });
    expect(model.status, "a model call").toBe(403);
    expect(((await model.json()) as { error: { message: string } }).error.message).toBe("the turn key is not a turn of the agent host that presents it");
    const checkpoint = await fetch(`${proxy.endpoint}/v1/proxy/checkpoints/checkpoint?thread_id=${ORG_B.threadId}&checkpoint_ns=`, { headers: asHostOf(borrowed, ORG_B.turnKey) });
    expect(checkpoint.status, "a checkpoint read").toBe(403);
    await checkpoint.text();

    expect(upstream.received, "nothing reached the platform").toHaveLength(0);
  });

  it("holds a turn opened without a slot to the open host", async () => {
    proxy.authorizeHost("open", "host-token-open");
    proxy.authorizeHost(ORG_A.slot, ORG_A.hostToken);
    closes.push(proxy.openTurn({ executionId: ORG_A.executionId, threadId: ORG_A.threadId, turnKey: ORG_A.turnKey, credential: ORG_A.credential }));

    expect(await modelCall(ORG_A), "a locked host's token").toBe(403);
    const asOpen = { ...asHostOf(ORG_A), authorization: "Bearer host-token-open" };
    const res = await fetch(`${proxy.endpoint}/v1/proxy/llm/anthropic/v1/messages`, { method: "POST", headers: asOpen, body: BODY });
    expect(res.status, "the open host's token").toBe(200);
    expect(upstream.last.headers.authorization).toBe(`Bearer ${ORG_A.credential}`);
  });
});
