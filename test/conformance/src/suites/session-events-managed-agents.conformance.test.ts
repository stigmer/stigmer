// Conformance suite for the Claude Managed Agents wire, without turns:
// who Anthropic's own SDK (`@anthropic-ai/sdk`, the exact pin the claim
// names) reaches a session as, and what the lane refuses.
// Domain: agentic / session — the session's event log on Managed Agents'
// paths (`/v1/sessions/{id}/events`, `/events/stream`).
//
// On the target's ENFORCING LANE (targets/target.ts), with keys the arms
// mint:
//
//   - the owner's key reads an empty log as `{data:[], next_page:null}`,
//     presented either way the SDK presents one (`apiKey` sends X-Api-Key,
//     `authToken` sends Authorization: Bearer);
//   - a key no verifier claims is the SDK's AuthenticationError;
//   - an outsider's own key is its PermissionDeniedError on list, stream
//     and send (a server that enforces does not say whether a session it
//     will not show exists: the native method's refusal is the answer);
//   - a Stigmer type filter, an event Stigmer does not serve, an image
//     block and a later Managed Agents version are each a BadRequestError
//     with nothing applied.
//
// On a target that requires no sign-in, any key the SDK sends is the local
// person (the SDK cannot send none), and an unknown session is its
// NotFoundError.
//
// The lane's answers on real turns (the stream, the pager, approvals, the
// interrupt, an agent that edits files) are the execution suite's,
// suites-execution/session-events-managed-agents.conformance.test.ts.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsSessionEventType } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { FixtureTracker } from "../harness/fixtures";
import type { ConformanceClients } from "../harness/clients";
import { managedAgentsClient } from "../support/managed-agents";
import { makeSession } from "../support/sessions";
import { uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";

const capabilities = createTarget().capabilities;
let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  enforcing = await enforcingLaneOf(target);
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

/** A key minted by `clients` in `org`: its plaintext, as a developer pastes it. */
async function mintKey(clients: ConformanceClients, org: string): Promise<string> {
  const key = await clients.apiKeyCommand.create({
    apiVersion: "iam.stigmer.ai/v1",
    kind: "ApiKey",
    metadata: { name: uniqueName("ma-key"), org },
    spec: {},
  });
  const id = key.metadata?.id ?? "";
  fixtures.defer(() => clients.apiKeyCommand.delete({ value: id }).catch(() => undefined));
  return key.spec?.keyHash ?? "";
}

async function newSession(clients: ConformanceClients, org: string): Promise<string> {
  const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("ma-session") }));
  const id = session.metadata!.id;
  fixtures.defer(() => clients.sessionCommand.delete({ value: id }).catch(() => undefined));
  return id;
}

/** The SDK error a call throws, or a failure when it succeeds. */
async function sdkError(work: Promise<unknown>): Promise<InstanceType<typeof Anthropic.APIError>> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return error;
    }
    throw error;
  }
  throw new Error("the call was admitted");
}

/** The Anthropic error type an SDK error carries in its body. */
function errorTypeOf(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { type?: string } } | undefined;
  return body?.error?.type ?? "";
}

describe("Anthropic's SDK against the Managed Agents lane (on the enforcing lane)", () => {
  it("the owner's key reads an empty log, presented as apiKey or as authToken", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy({ org }));
    const sessionId = await newSession(lane.clients, org);
    const key = await mintKey(lane.clients, org);

    for (const credential of [{ apiKey: key }, { authToken: key }]) {
      const page = await managedAgentsClient(lane.managedAgentsBaseUrl(), credential).beta.sessions.events.list(sessionId);
      expect(page.data, JSON.stringify(Object.keys(credential))).toEqual([]);
      expect(page.next_page).toBeNull();
      expect(page.hasNextPage()).toBe(false);
    }
  });

  it("a key no verifier claims is an AuthenticationError", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy({ org }));
    const sessionId = await newSession(lane.clients, org);
    const sdk = managedAgentsClient(lane.managedAgentsBaseUrl(), { apiKey: `stk_${uniqueName("unknown")}` });
    const error = await sdkError(sdk.beta.sessions.events.list(sessionId));
    expect(error).toBeInstanceOf(Anthropic.AuthenticationError);
    expect(errorTypeOf(error)).toBe("authentication_error");
  });

  it("an outsider's own key is a PermissionDeniedError on list, stream and send", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy({ org }));
    const sessionId = await newSession(lane.clients, org);
    const elsewhere = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(elsewhere));
    const outsider = await lane.provisionMember(elsewhere);
    const sdk = managedAgentsClient(lane.managedAgentsBaseUrl(), { apiKey: await mintKey(outsider, elsewhere.org) });

    const refusals = [
      await sdkError(sdk.beta.sessions.events.list(sessionId)),
      await sdkError(sdk.beta.sessions.events.stream(sessionId)),
      await sdkError(sdk.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] })),
    ];
    for (const error of refusals) {
      expect(error).toBeInstanceOf(Anthropic.PermissionDeniedError);
      expect(errorTypeOf(error)).toBe("permission_error");
    }
    expect((await lane.clients.sessionQuery.listEvents({ sessionId })).events, "nothing was written").toEqual([]);
  });

  it("a Stigmer type filter, an unserved event, an image block and a later version are each a BadRequestError with nothing applied", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy({ org }));
    const sessionId = await newSession(lane.clients, org);
    const sdk = managedAgentsClient(lane.managedAgentsBaseUrl(), { apiKey: await mintKey(lane.clients, org) });

    // The SDK's type union lists no stigmer.* type; a client that sends one anyway is refused by name.
    const stigmerType = "stigmer.permission.asked" as BetaManagedAgentsSessionEventType;
    const refusals: Array<[string, Promise<unknown>]> = [
      ["a stigmer.* type filter", sdk.beta.sessions.events.list(sessionId, { types: [stigmerType] })],
      [
        "an unserved event",
        sdk.beta.sessions.events.send(sessionId, {
          events: [{ type: "user.tool_result", tool_use_id: "toolu_never", content: [{ type: "text", text: "x" }] }],
        }),
      ],
      [
        "an image block, after an event that would apply",
        sdk.beta.sessions.events.send(sessionId, {
          events: [
            { type: "user.interrupt" },
            {
              type: "user.message",
              content: [{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }],
            },
          ],
        }),
      ],
      ["a later Managed Agents version", sdk.beta.sessions.events.list(sessionId, { betas: ["managed-agents-2099-01-01"] })],
    ];
    for (const [label, work] of refusals) {
      const error = await sdkError(work);
      expect(error, label).toBeInstanceOf(Anthropic.BadRequestError);
      expect(errorTypeOf(error), label).toBe("invalid_request_error");
    }
    expect((await lane.clients.sessionQuery.listEvents({ sessionId })).events, "nothing was applied").toEqual([]);
  });
});

describe.skipIf(capabilities.requiresAuthentication)("Anthropic's SDK against a server without sign-in", () => {
  it("any key is the local person, and an unknown session is a NotFoundError", async () => {
    const clients = target.clients();
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(clients, org);
    const sdk = managedAgentsClient(target.managedAgentsBaseUrl(), { apiKey: "any-key-at-all" });

    const page = await sdk.beta.sessions.events.list(sessionId);
    expect(page.data).toEqual([]);
    expect(page.next_page).toBeNull();

    const missing = await sdkError(sdk.beta.sessions.events.list(`ses_${uniqueName("missing")}`));
    expect(missing).toBeInstanceOf(Anthropic.NotFoundError);
    expect(errorTypeOf(missing)).toBe("not_found_error");
  });
});
