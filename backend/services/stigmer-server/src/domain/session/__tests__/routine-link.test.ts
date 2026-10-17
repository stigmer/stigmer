/**
 * Pins the session create's routine stamp (../routine-link.ts): a session
 * created by a request the server composed for a routine's fire (an
 * in-process identity carrying `routineId`) records that routine as
 * `status.routine_id`; a wire request never does, even one whose identity
 * claims a routine (no verifier sets one, but the step does not trust it
 * to be absent); and a session nobody fired records none. The step runs
 * after the create cleared any status a client sent (BuildNewState), so a
 * client-sent routine id never survives, which the routine conformance
 * suite pins on the wire.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { newStampSessionRoutineStep } from "../routine-link.js";

function stamped(caller: CallerIdentity): string | undefined {
  const ctx = new RequestContext(
    SessionSchema,
    create(SessionSchema, { metadata: { id: "ses_1", org: "acme" } }),
    caller,
    ApiResourceKind.session,
  );
  newStampSessionRoutineStep().execute(ctx);
  return ctx.newState.status?.routineId;
}

describe("the session's routine stamp", () => {
  it("records the routine a server-composed fire carries", () => {
    expect(stamped(testCallerIdentity({ origin: "in-process", routineId: "rtn_1" }))).toBe("rtn_1");
    expect(stamped(testCallerIdentity({ callerClass: "internal", routineId: "rtn_1" }))).toBe("rtn_1");
  });

  it("never records a routine a wire request's identity carries", () => {
    expect(stamped(testCallerIdentity({ routineId: "rtn_forged" }))).toBeUndefined();
  });

  it("records nothing for a session no fire started", () => {
    expect(stamped(testCallerIdentity({ origin: "in-process" }))).toBeUndefined();
  });
});
