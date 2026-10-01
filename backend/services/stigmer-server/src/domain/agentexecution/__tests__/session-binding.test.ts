/**
 * Pins session-binding.ts: an execution belongs to its session and to that
 * session's organization.
 *
 * - create (stigmer/stigmer#1580): a turn under another organization is
 *   refused with FailedPrecondition naming neither organization, for any
 *   caller, an upstream-admitted lane included; an empty organization is
 *   taken from the session; no session id, or a dangling one, is left to
 *   the steps that own those shapes; a store fault is Internal.
 * - update (stigmer/stigmer#1588): a changed session id is refused; an
 *   empty one, or no spec at all, keeps the stored session; the same one
 *   passes; an execution stored without a session cannot be moved into
 *   one.
 *
 * A real SQLite store holds the sessions, as in the thinking-mode tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  newValidateSessionImmutabilityStep,
  newValidateSessionOrganizationStep,
} from "../session-binding.js";

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "session-binding-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type ExecutionInit = MessageInitShape<typeof AgentExecutionSchema>;

function contextFor(
  init: ExecutionInit,
  caller = testCallerIdentity(),
): RequestContext<typeof AgentExecutionSchema> {
  return new RequestContext(
    AgentExecutionSchema,
    create(AgentExecutionSchema, init),
    caller,
    ApiResourceKind.agent_execution,
  );
}

async function storeSession(id: string, org: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    create(SessionSchema, { metadata: { id, org } }),
  );
}

async function refusalOf(
  run: () => Promise<void> | void,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected a refusal, the step passed");
}

/** A store whose session read must never happen. */
function untouchable(): Store {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "getResource") {
        throw new Error("the store must not be read");
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("ValidateSessionOrganization (create)", () => {
  it("a turn under the session's organization passes unchanged", async () => {
    await storeSession("ses_acme", "acme");
    const ctx = contextFor({
      metadata: { org: "acme" },
      spec: { sessionId: "ses_acme" },
    });

    await newValidateSessionOrganizationStep(store).execute(ctx);

    expect(ctx.newState.metadata?.org).toBe("acme");
  });

  it("a turn under another organization is refused with FailedPrecondition, naming neither", async () => {
    await storeSession("ses_acme", "acme");
    const ctx = contextFor({
      metadata: { org: "personal" },
      spec: { sessionId: "ses_acme" },
    });

    const err = await refusalOf(() =>
      newValidateSessionOrganizationStep(store).execute(ctx),
    );

    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      "an execution in session 'ses_acme' must belong to the session's organization",
    );
  });

  it("an upstream-admitted lane caller learns no organization from the refusal", async () => {
    // An edition lane (here a guest) passes the run gate unchecked and is
    // admitted later, in the gate slot, so it may not be able to read the
    // session it named: the refusal must not tell it the session's org.
    await storeSession("ses_lane", "acme");
    const guest = testCallerIdentity({
      identityId: "ida_guest",
      callerClass: "guest",
    });
    const ctx = contextFor(
      { metadata: { org: "guest-org" }, spec: { sessionId: "ses_lane" } },
      guest,
    );

    const err = await refusalOf(() =>
      newValidateSessionOrganizationStep(store).execute(ctx),
    );

    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).not.toContain("acme");
    expect(err.rawMessage).toBe(
      "an execution in session 'ses_lane' must belong to the session's organization",
    );
  });

  it("an empty organization is taken from the session", async () => {
    await storeSession("ses_acme", "acme");
    const withMetadata = contextFor({
      metadata: { org: "" },
      spec: { sessionId: "ses_acme" },
    });
    const withoutMetadata = contextFor({ spec: { sessionId: "ses_acme" } });

    await newValidateSessionOrganizationStep(store).execute(withMetadata);
    await newValidateSessionOrganizationStep(store).execute(withoutMetadata);

    expect(withMetadata.newState.metadata?.org).toBe("acme");
    expect(withoutMetadata.newState.metadata?.org).toBe("acme");
  });

  it("a session with no organization is not judged", async () => {
    await storeSession("ses_orgless", "");
    const ctx = contextFor({
      metadata: { org: "acme" },
      spec: { sessionId: "ses_orgless" },
    });

    await expect(
      newValidateSessionOrganizationStep(store).execute(ctx),
    ).resolves.toBeUndefined();
    expect(ctx.newState.metadata?.org).toBe("acme");
  });

  it("a turn with no session id is not judged and never reads the store", async () => {
    const ctx = contextFor({
      metadata: { org: "personal" },
      spec: { agentId: "agt_x" },
    });

    await newValidateSessionOrganizationStep(untouchable()).execute(ctx);

    expect(ctx.newState.metadata?.org).toBe("personal");
  });

  it("a dangling session id passes, leaving the NotFound to the loading steps", async () => {
    const ctx = contextFor({
      metadata: { org: "personal" },
      spec: { sessionId: "ses_missing" },
    });

    await expect(
      newValidateSessionOrganizationStep(store).execute(ctx),
    ).resolves.toBeUndefined();
    expect(ctx.newState.metadata?.org).toBe("personal");
  });

  it("a store fault is Internal, never a reading of the session", async () => {
    const faulty = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "getResource") {
          return async () => {
            throw new Error("simulated store fault");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const ctx = contextFor({
      metadata: { org: "acme" },
      spec: { sessionId: "ses_any" },
    });

    const err = await refusalOf(() =>
      newValidateSessionOrganizationStep(faulty).execute(ctx),
    );

    expect(err.code).toBe(Code.Internal);
  });
});

describe("ValidateSessionImmutability (update)", () => {
  function mergedFor(
    sessionId: string,
    stored: AgentExecution | undefined,
  ): RequestContext<typeof AgentExecutionSchema> {
    const ctx = contextFor({
      metadata: { id: "aex_1", org: "acme" },
      spec: { sessionId, message: "edited" },
    });
    if (stored !== undefined) ctx.set(EXISTING_RESOURCE_KEY, stored);
    return ctx;
  }

  const stored = create(AgentExecutionSchema, {
    metadata: { id: "aex_1", org: "acme" },
    spec: { sessionId: "ses_first", message: "original" },
  });

  it("the same session id passes", () => {
    const ctx = mergedFor("ses_first", stored);

    newValidateSessionImmutabilityStep().execute(ctx);

    expect(ctx.newState.spec?.sessionId).toBe("ses_first");
  });

  it("a changed session id is refused with FailedPrecondition naming the stored session", async () => {
    const ctx = mergedFor("ses_other_org", stored);

    const err = await refusalOf(() =>
      newValidateSessionImmutabilityStep().execute(ctx),
    );

    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      "session_id cannot be changed — an execution belongs to the session it was created in ('ses_first')",
    );
  });

  it("an update with no spec at all keeps the stored session", () => {
    const ctx = contextFor({ metadata: { id: "aex_1", org: "acme" } });
    ctx.set(EXISTING_RESOURCE_KEY, stored);

    newValidateSessionImmutabilityStep().execute(ctx);

    expect(ctx.newState.spec?.sessionId).toBe("ses_first");
  });

  it("an execution stored without a session cannot be moved into one", async () => {
    const sessionless = create(AgentExecutionSchema, {
      metadata: { id: "aex_1", org: "acme" },
      spec: { message: "original" },
    });

    const err = await refusalOf(() =>
      newValidateSessionImmutabilityStep().execute(
        mergedFor("ses_any", sessionless),
      ),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      "session_id cannot be set on update — an execution created without a session cannot join one",
    );

    const unchanged = mergedFor("", sessionless);
    newValidateSessionImmutabilityStep().execute(unchanged);
    expect(unchanged.newState.spec?.sessionId).toBe("");
  });

  it("an empty session id keeps the stored session", () => {
    const ctx = mergedFor("", stored);

    newValidateSessionImmutabilityStep().execute(ctx);

    expect(ctx.newState.spec?.sessionId).toBe("ses_first");
    expect(ctx.newState.spec?.message).toBe("edited");
  });
});
