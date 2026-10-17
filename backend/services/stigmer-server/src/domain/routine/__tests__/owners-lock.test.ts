/**
 * Pins the owner's lock (../owners-lock.ts) step by step:
 *   - `routineChangesRuns` reads the whole spec, a switch-off ignored:
 *     stopping it changes nothing, switching it back on does, and metadata
 *     (the name, the labels) is not what it runs;
 *   - the step refuses a non-owner's change to what a routine runs with the
 *     lock's copy, and admits their switch-off and their metadata edit;
 *   - the owner is the principal the creator stamp names, or the account it
 *     resolves to (by id, or through the 3.14.x raw issuer subject), and an
 *     unprovisioned caller whose subject is the stamp is the owner too;
 *   - a routine whose stamp names nobody has no owner: only the internal
 *     class changes what it runs;
 *   - under the trusted-local posture (no account port) the step is off;
 *   - an account-store fault is INTERNAL, never a refusal;
 *   - a chain that never loaded the existing routine is a broken invariant
 *     and throws INTERNAL.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { AccountsByCaller } from "../../identityaccount/resolve.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { OWNERS_LOCK_MESSAGE, newOwnersLockStep, routineChangesRuns } from "../owners-lock.js";

const PRIYA = create(IdentityAccountSchema, {
  metadata: { id: "ida_priya" },
  spec: { idpId: "auth0|priya" },
});

const ACCOUNTS: AccountsByCaller = {
  findById: (id) => Promise.resolve(id === "ida_priya" ? PRIYA : undefined),
  findDirectByIdpId: (subject) => Promise.resolve(subject === "auth0|priya" ? PRIYA : undefined),
};

function routine(createdBy: string): Routine {
  return create(RoutineSchema, {
    metadata: { id: "rtn_1", org: "acme", name: "Triage", labels: { team: "ops" } },
    spec: {
      timeZone: "UTC",
      enabled: true,
      agent: { agentRef: { kind: ApiResourceKind.agent, org: "acme", id: "agt_1" }, message: "Triage the alert." },
    },
    status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
  });
}

function edited(existing: Routine, change: (next: Routine) => void): Routine {
  const next = clone(RoutineSchema, existing);
  change(next);
  return next;
}

async function run(
  accounts: AccountsByCaller | undefined,
  existing: Routine,
  next: Routine,
  caller: CallerIdentity,
): Promise<void> {
  const ctx = new RequestContext(RoutineSchema, next, caller, ApiResourceKind.routine);
  ctx.set(EXISTING_RESOURCE_KEY, existing);
  await newOwnersLockStep(accounts).execute(ctx);
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

const ADMIN = testCallerIdentity({ identityId: "ida_admin" });
const newMessage = (next: Routine) => {
  next.spec!.agent!.message = "Delete everything.";
};

describe("routineChangesRuns", () => {
  const existing = routine("ida_priya");

  it("is false for a switch-off, a rename and a relabel", () => {
    expect(routineChangesRuns(existing, edited(existing, (next) => (next.spec!.enabled = false)))).toBe(false);
    expect(routineChangesRuns(existing, edited(existing, (next) => (next.metadata!.name = "Renamed")))).toBe(false);
    expect(routineChangesRuns(existing, edited(existing, (next) => (next.metadata!.labels = {})))).toBe(false);
  });

  it("is true for the message, a schedule added, and switching a stopped routine back on", () => {
    expect(routineChangesRuns(existing, edited(existing, newMessage))).toBe(true);
    expect(routineChangesRuns(existing, edited(existing, (next) => (next.spec!.cron = "0 9 * * *")))).toBe(true);
    const stopped = edited(existing, (next) => (next.spec!.enabled = false));
    expect(routineChangesRuns(stopped, edited(stopped, (next) => (next.spec!.enabled = true)))).toBe(true);
  });
});

describe("the owner's lock", () => {
  it("refuses a non-owner's change to what it runs with the lock's copy", async () => {
    const existing = routine("ida_priya");
    const error = await refusal(run(ACCOUNTS, existing, edited(existing, newMessage), ADMIN));
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(OWNERS_LOCK_MESSAGE);
  });

  it("admits a non-owner's switch-off and metadata edit", async () => {
    const existing = routine("ida_priya");
    await run(ACCOUNTS, existing, edited(existing, (next) => (next.spec!.enabled = false)), ADMIN);
    await run(ACCOUNTS, existing, edited(existing, (next) => (next.metadata!.name = "Renamed")), ADMIN);
  });

  it("admits the owner, named by the stamp or by the account the stamp resolves to", async () => {
    const byId = routine("ida_priya");
    await run(ACCOUNTS, byId, edited(byId, newMessage), testCallerIdentity({ identityId: "ida_priya" }));
    const bySubject = routine("auth0|priya");
    await run(ACCOUNTS, bySubject, edited(bySubject, newMessage), testCallerIdentity({ identityId: "ida_priya" }));
    await run(ACCOUNTS, byId, edited(byId, newMessage), testCallerIdentity({ identityId: "auth0|priya" }));
  });

  it("admits an unprovisioned caller whose subject is the stamp itself", async () => {
    const stamped = routine("fake|ana");
    await run(ACCOUNTS, stamped, edited(stamped, newMessage), testCallerIdentity({ identityId: "fake|ana" }));
  });

  it("leaves a routine whose stamp names nobody to the server alone", async () => {
    const orphan = routine("");
    const error = await refusal(run(ACCOUNTS, orphan, edited(orphan, newMessage), testCallerIdentity({ identityId: "" })));
    expect(error.code).toBe(Code.PermissionDenied);
    await run(ACCOUNTS, orphan, edited(orphan, newMessage), testCallerIdentity({ callerClass: "internal" }));
  });

  it("is off where the composition signs nobody in", async () => {
    const existing = routine("system");
    await run(undefined, existing, edited(existing, newMessage), testCallerIdentity({ identityId: "system" }));
  });

  it("answers INTERNAL for an account-store fault, never a refusal", async () => {
    const failing: AccountsByCaller = {
      findById: () => Promise.reject(new Error("store offline")),
      findDirectByIdpId: () => Promise.reject(new Error("store offline")),
    };
    const existing = routine("ida_priya");
    const error = await refusal(run(failing, existing, edited(existing, newMessage), ADMIN));
    expect(error.code).toBe(Code.Internal);
  });

  it("throws INTERNAL when the chain never loaded the existing routine", async () => {
    const existing = routine("ida_priya");
    const ctx = new RequestContext(RoutineSchema, edited(existing, newMessage), ADMIN, ApiResourceKind.routine);
    const error = await refusal(Promise.resolve(newOwnersLockStep(ACCOUNTS).execute(ctx)));
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("existing routine not found in context");
  });
});
