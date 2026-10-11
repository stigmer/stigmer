// Conformance suite for who may read and write a session's event log.
// Domain: agentic / session.
//
// The arms run on the target's ENFORCING LANE (targets/target.ts), where a
// second provisioned identity holds no grant on the owner's session:
//
//   - the owner lists an event log (empty before any turn);
//   - an outsider is refused listEvents and streamEvents with each method's
//     byte-pinned annotation copy, and sees nothing;
//   - appendEvents admits only the runner acting for a run: a signed-in
//     person's own credential, even the session owner's, is refused.
//
// The log's content on real turns, and the runner's own appends, are the
// execution suite's (suites-execution/session-events.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { collectStream } from "../support/collect-stream";
import { makeSession } from "../support/sessions";
import { uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";

let target: TargetProfile;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  enforcing = await enforcingLaneOf(target);
  clients = enforcing.lane?.clients ?? target.clients();
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

async function ownersSession(lane: EnforcingLane): Promise<string> {
  const { org } = await lane.provisionTenancy();
  const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("events-authz") }));
  const id = session.metadata!.id;
  fixtures.defer(() => clients.sessionCommand.delete({ value: id }));
  return id;
}

describe("a session's event log — who may read and write it (on the enforcing lane)", () => {
  it("[rpc:SessionQueryController.listEvents] [rpc:SessionQueryController.streamEvents] the owner lists an empty log; an outsider is refused both reads with their annotation copies", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const sessionId = await ownersSession(lane);
    const outsider = await lane.provisionIdentity();

    const mine = await clients.sessionQuery.listEvents({ sessionId });
    expect(mine.events).toEqual([]);
    expect(mine.nextPageToken).toBe("");

    const listed = await expectGrpcCode(
      () => outsider.sessionQuery.listEvents({ sessionId }),
      Code.PermissionDenied,
      "outsider listEvents on a foreign session",
    );
    expect(listed.rawMessage).toBe("unauthorized to list session events");
    const streamed = await expectGrpcCode(
      () => collectStream((signal) => outsider.sessionQuery.streamEvents({ sessionId }, { signal })),
      Code.PermissionDenied,
      "outsider streamEvents on a foreign session",
    );
    expect(streamed.rawMessage).toBe("unauthorized to stream session events");
  });

  it("[rpc:SessionCommandController.appendEvents] a person's own credential is no runner's: even the session's owner is refused", async (ctx) => {
    const lane = laneOrSkip(ctx);
    await ownersSession(lane);
    const refused = await expectGrpcCode(
      () =>
        clients.sessionCommand.appendEvents({
          runId: "run_01conformancenotarunner",
          events: [{ event: { case: "agentThinking", value: { id: "evt-1" } } }],
        }),
      Code.PermissionDenied,
      "appendEvents with a signed-in person's credential",
    );
    expect(refused.rawMessage).toBe("only the runner acting for this run may append its events");
  });
});
