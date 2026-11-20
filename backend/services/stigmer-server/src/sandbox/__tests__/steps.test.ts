/**
 * Pins the sandbox invocation surface's postures:
 *
 *   - the session lane fires ONLY on resolved CLOUD target with
 *     per-session routing, is NON-critical (a provisioning failure never
 *     throws), and PRE-STAMPS the root cause onto status.error
 *     first-non-empty-wins — the 2026-07 quota-outage contract;
 *   - a disabled mint lane launches token-less rather than failing;
 *   - the caller class reaches the driver's environment unchanged (a
 *     composed lane such as `guest` included), and so does a routine's
 *     fire's routine, under the owner's own class;
 *   - the credential mint names the session's creator, whoever's turn
 *     creates or restores the sandbox (stigmer#2075): a person the
 *     conversation is shared with never takes the runner over, and a
 *     creator stamp that names nobody mints nothing (tokenless, fail
 *     closed). Under the trusted-local posture (no accounts port) the
 *     caller, the one operator, is minted for;
 *   - the ensure answers in one word (ready, no_room, not_carried,
 *     skipped, failed), and the fleet's "no room" (SandboxNoRoomError) is
 *     not a failure: nothing is stamped, so a turn that waits and then
 *     starts carries no false root cause;
 *   - a sandbox whose files cannot be carried to this server's runner
 *     (SandboxNotCarriedError, through a wrapping driver's cause too)
 *     answers not_carried and pre-stamps the person's line itself, never
 *     the driver's words (stigmer#1843);
 *   - only a caller that says the runner is idle (the workflow's ensure,
 *     right before it invokes the runner) hands `runnerIdle` to the
 *     driver: the request's and the recover's ensures never do;
 *   - only a caller that says its run is waiting (the workflow's ensure)
 *     asks the driver to make room on "no room": once per ask, then asks
 *     for the sandbox again on the short schedule with the same facts (one
 *     mint), starting when the freed seat is seen and waiting as before
 *     when it is not; no room made, a makeRoom that throws (logged, read
 *     as false) and a driver that offers none all wait as before; the
 *     ask's one info line says whether room was made.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { AccountsByCaller } from "../../domain/identityaccount/resolve.js";

import { createLogger, type LogEntry } from "../../boot/logger.js";
import {
  AgentExecutionTemporalConfig,
  ROUTING_GLOBAL,
  ROUTING_SESSION,
} from "../../domain/run/temporal/config.js";
import type {
  RunnerCredentialProvider,
  SandboxCredentialRequest,
} from "../../runnerauth/runner-credential-provider.js";
import { SqliteStore } from "../../store/sqlite/store.js";
import type { SandboxLane } from "../lane.js";
import { MAKE_ROOM_RETRY_DELAYS_MS } from "../make-room.js";
import {
  SandboxNoRoomError,
  SandboxNotCarriedError,
  type SandboxFacts,
  type SandboxProvisioner,
} from "../provisioner.js";
import { SANDBOX_NOT_CARRIED_COPY } from "../../temporal/agentexecution/sandbox-wait.js";
import {
  deprovisionSessionSandboxBestEffort,
  ensureSessionSandboxForExecution,
  SANDBOX_PROVISIONING_FAILED_PREFIX,
  type EnsureSessionSandboxOptions,
  type SandboxCaller,
} from "../steps.js";

/**
 * The caller the ensure bodies split two ways: the identity id into the
 * credential mint (the OSS execution-scoped mint ignores it, so the
 * token assertions stay binding-shaped) and the class onto the driver's
 * environment. `user` is the plain lane; the class-propagation cases hand
 * in a composed lane's word to prove the body copies, never normalises.
 */
const TEST_CALLER_IDENTITY_ID = "ida_test_caller";
const TEST_CALLER: SandboxCaller = {
  identityId: TEST_CALLER_IDENTITY_ID,
  callerClass: "user",
};
const GUEST_CALLER: SandboxCaller = {
  identityId: "ida_guest_caller",
  callerClass: "guest",
};

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** Records every provisioner call; ensure/deprovision failures injectable. */
function fakeProvisioner(overrides?: {
  ensureError?: Error;
  deprovisionError?: Error;
  /** Errors the session ensures throw in turn, oldest first, before they succeed. */
  ensureErrors?: Error[];
}): SandboxProvisioner & {
  ensured: Array<{ scope: string; id: string; facts: SandboxFacts }>;
  deprovisioned: Array<{ scope: string; id: string }>;
  /** Every session ensure asked, failed or not. */
  asked: SandboxFacts[];
} {
  const ensured: Array<{ scope: string; id: string; facts: SandboxFacts }> =
    [];
  const deprovisioned: Array<{ scope: string; id: string }> = [];
  const asked: SandboxFacts[] = [];
  const ensure = async (scope: string, id: string, facts: SandboxFacts) => {
    asked.push(facts);
    if (overrides?.ensureError) {
      throw overrides.ensureError;
    }
    const next = overrides?.ensureErrors?.shift();
    if (next !== undefined) {
      throw next;
    }
    ensured.push({ scope, id, facts });
  };
  const deprovision = async (scope: string, id: string) => {
    if (overrides?.deprovisionError) {
      throw overrides.deprovisionError;
    }
    deprovisioned.push({ scope, id });
  };
  return {
    ensured,
    deprovisioned,
    asked,
    ensureSessionSandbox: (id, facts) => ensure("session", id, facts),
    deprovisionSessionSandbox: (id) => deprovision("session", id),
    createConnectSandbox: async (id, facts) => {
      await ensure("connect", id, facts);
      return id;
    },
    deprovisionConnectSandbox: (id) => deprovision("connect", id),
    probe: async () => "absent" as const,
  };
}

const mintingCredentials: RunnerCredentialProvider = {
  isEnabled: (lane) => lane === "execution_scoped",
  mint: (_lane, binding, ttlSeconds) => ({
    token: `tok-${binding}`,
    ttlSeconds,
  }),
  verify: () => {
    throw new Error("verify is not under test");
  },
};

const disabledCredentials: RunnerCredentialProvider = {
  isEnabled: () => false,
  mint: () => {
    throw new Error("mint must not be called when the lane is disabled");
  },
  verify: () => {
    throw new Error("verify is not under test");
  },
};

/**
 * A provider with the mintSandboxCredential capability: records the
 * full provisioning context it received and returns a distinguishable
 * token — proving the ensure steps delegate the WHOLE mint decision
 * (the primitives must never be consulted on this path).
 */
function capabilityCredentials(): RunnerCredentialProvider & {
  minted: SandboxCredentialRequest[];
} {
  const minted: SandboxCredentialRequest[] = [];
  return {
    minted,
    isEnabled: () => {
      throw new Error(
        "primitives must not be consulted on the capability path",
      );
    },
    mint: () => {
      throw new Error(
        "primitives must not be consulted on the capability path",
      );
    },
    verify: () => {
      throw new Error("verify is not under test");
    },
    mintSandboxCredential: (request) => {
      minted.push(request);
      return `cloud-tok-${request.scope}`;
    },
  };
}

function lane(
  provisioner: SandboxProvisioner,
  credentials: RunnerCredentialProvider = mintingCredentials,
): SandboxLane {
  return { enabled: true, provisioner, credentials };
}

const sessionRoutingCloudDefault = new AgentExecutionTemporalConfig(
  "agent_execution_stigmer",
  "stigmer_runner",
  ROUTING_SESSION,
  "cloud",
);

describe("the session lane (ensureSessionSandboxForExecution)", () => {
  let dir: string;
  let store: SqliteStore;
  let counter = 0;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sandbox-steps-"));
    store = SqliteStore.open(path.join(dir, "test.db"));
  });
  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seed(target: ExecutionTarget): Promise<{
    sessionId: string;
    execution: Run;
  }> {
    counter += 1;
    const sessionId = `ses_sbx_${counter}`;
    const executionId = `axr_sbx_${counter}`;
    await store.saveResource(
      ApiResourceKind.session,
      sessionId,
      SessionSchema,
      create(SessionSchema, {
        metadata: { id: sessionId, name: sessionId },
        spec: { executionTarget: target },
      }),
    );
    const execution = create(RunSchema, {
      metadata: { id: executionId, name: executionId },
      spec: { target: { case: "sessionId", value: sessionId } },
    });
    await store.saveResource(
      ApiResourceKind.run,
      executionId,
      RunSchema,
      execution,
    );
    return { sessionId, execution };
  }

  it("fires on CLOUD target with the per-session queue and the minted token", async () => {
    const provisioner = fakeProvisioner();
    const { sessionId, execution } = await seed(ExecutionTarget.CLOUD);
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
    expect(provisioner.ensured).toEqual([
      {
        scope: "session",
        id: sessionId,
        facts: {
          taskQueue: `session:${sessionId}`,
          stigmerToken: `tok-${execution.metadata?.id ?? ""}`,
          callerClass: "user",
          executionId: execution.metadata?.id ?? "",
        },
      },
    ]);
  });

  it("names the turn's run in the facts, so a host can tie the sandbox's place to the start it accepted", async () => {
    const provisioner = fakeProvisioner();
    const { execution } = await seed(ExecutionTarget.CLOUD);
    const runId = execution.metadata?.id ?? "";
    expect(runId).not.toBe("");
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
    expect(provisioner.ensured[0]?.facts.executionId).toBe(runId);
  });

  it("hands the caller's class to the driver unchanged and the caller's id to the mint", async () => {
    const provisioner = fakeProvisioner();
    const credentials = capabilityCredentials();
    const { execution } = await seed(ExecutionTarget.CLOUD);
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner, credentials),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      GUEST_CALLER,
    );
    expect(provisioner.ensured[0]?.facts.callerClass).toBe("guest");
    expect(provisioner.ensured[0]?.facts.routineId).toBeUndefined();
    expect(credentials.minted[0]?.callerIdentityId).toBe(
      GUEST_CALLER.identityId,
    );
  });

  it("hands a routine's fire to the driver under its owner's own class, with the routine it fired", async () => {
    const provisioner = fakeProvisioner();
    const credentials = capabilityCredentials();
    const { execution } = await seed(ExecutionTarget.CLOUD);
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner, credentials),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      { ...TEST_CALLER, routineId: "rtn_oncall" },
    );
    expect(provisioner.ensured[0]?.facts.callerClass).toBe("user");
    expect(provisioner.ensured[0]?.facts.routineId).toBe("rtn_oncall");
  });

  it("delegates the mint to the capability provider with the full provisioning context", async () => {
    const provisioner = fakeProvisioner();
    const credentials = capabilityCredentials();
    counter += 1;
    const sessionId = `ses_sbx_${counter}`;
    const executionId = `axr_sbx_${counter}`;
    await store.saveResource(
      ApiResourceKind.session,
      sessionId,
      SessionSchema,
      create(SessionSchema, {
        metadata: { id: sessionId, name: sessionId },
        spec: { executionTarget: ExecutionTarget.CLOUD },
      }),
    );
    const execution = create(RunSchema, {
      metadata: { id: executionId, name: executionId, org: "org-test" },
      spec: { target: { case: "sessionId", value: sessionId } },
    });

    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner, credentials),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );

    expect(credentials.minted).toEqual([
      {
        scope: "session",
        sessionId,
        executionId,
        org: "org-test",
        callerIdentityId: TEST_CALLER_IDENTITY_ID,
      },
    ]);
    expect(provisioner.ensured[0]?.facts.stigmerToken).toBe("cloud-tok-session");
  });

  describe("whom the runner acts as", () => {
    const CREATOR = "ida_01jcreatorcreatorcreator0";
    const SENDER = "ida_01jsendersendersendersen0";
    const accounts: AccountsByCaller = {
      findById: (id: string): Promise<IdentityAccount | undefined> =>
        Promise.resolve(
          id === CREATOR || id === SENDER
            ? create(IdentityAccountSchema, { metadata: { id } })
            : undefined,
        ),
      findDirectByIdpId: (): Promise<IdentityAccount | undefined> =>
        Promise.resolve(undefined),
    };

    async function seedCreatedBy(creator: string): Promise<Run> {
      counter += 1;
      const sessionId = `ses_sbx_${counter}`;
      await store.saveResource(
        ApiResourceKind.session,
        sessionId,
        SessionSchema,
        create(SessionSchema, {
          metadata: { id: sessionId, name: sessionId },
          spec: { executionTarget: ExecutionTarget.CLOUD },
          status: { audit: { specAudit: { createdBy: { id: creator } } } },
        }),
      );
      return create(RunSchema, {
        metadata: { id: `axr_sbx_${counter}`, name: `axr_sbx_${counter}` },
        spec: { target: { case: "sessionId", value: sessionId } },
      });
    }

    async function mintedFor(execution: Run, caller: SandboxCaller): Promise<string | undefined> {
      const credentials = capabilityCredentials();
      await ensureSessionSandboxForExecution(
        {
          store,
          logger: silentLogger,
          lane: lane(fakeProvisioner(), credentials),
          temporalConfig: sessionRoutingCloudDefault,
          accounts,
        },
        execution,
        caller,
      );
      return credentials.minted[0]?.callerIdentityId;
    }

    it("mints for the session's creator when another person's turn creates or restores the sandbox", async () => {
      const execution = await seedCreatedBy(CREATOR);
      expect(
        await mintedFor(execution, { identityId: SENDER, callerClass: "user" }),
      ).toBe(CREATOR);
      expect(
        await mintedFor(execution, { identityId: CREATOR, callerClass: "user" }),
      ).toBe(CREATOR);
    });

    it("mints nothing when the creator stamp names nobody: the sandbox launches tokenless", async () => {
      const execution = await seedCreatedBy("system");
      expect(
        await mintedFor(execution, { identityId: SENDER, callerClass: "user" }),
      ).toBe("");
    });
  });

  it("skips on resolved LOCAL target — the roster fast path", async () => {
    const provisioner = fakeProvisioner();
    const { execution } = await seed(ExecutionTarget.LOCAL);
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
    expect(provisioner.ensured).toEqual([]);
  });

  it("skips when the lane is disabled without touching the store", async () => {
    const execution = create(RunSchema, {
      metadata: { id: "axr_disabled" },
      spec: { target: { case: "sessionId", value: "ses_never_loaded" } },
    });
    // A store that fails every read proves the disabled arm never reads.
    const explodingStore = new Proxy(store, {
      get() {
        throw new Error("the disabled lane must not touch the store");
      },
    });
    await ensureSessionSandboxForExecution(
      {
        store: explodingStore,
        logger: silentLogger,
        lane: { enabled: false },
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
  });

  it("skips (warn) on CLOUD target under global routing — the dark-config belt", async () => {
    const provisioner = fakeProvisioner();
    const { execution } = await seed(ExecutionTarget.CLOUD);
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: new AgentExecutionTemporalConfig(
          "agent_execution_stigmer",
          "stigmer_runner",
          ROUTING_GLOBAL,
          "cloud",
        ),
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
    expect(provisioner.ensured).toEqual([]);
  });

  it("launches token-less when the mint lane is disabled (redaction posture)", async () => {
    const provisioner = fakeProvisioner();
    const { execution } = await seed(ExecutionTarget.CLOUD);
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner, disabledCredentials),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
    expect(provisioner.ensured[0]?.facts.stigmerToken).toBe("");
  });

  it("a provisioning failure never throws and pre-stamps status.error", async () => {
    const provisioner = fakeProvisioner({
      ensureError: new Error("quota exhausted: count/secrets"),
    });
    const { execution } = await seed(ExecutionTarget.CLOUD);
    const executionId = execution.metadata?.id ?? "";
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
    const stamped = await store.getResource(
      ApiResourceKind.run,
      executionId,
      RunSchema,
    );
    expect(stamped.status?.error).toBe(
      `${SANDBOX_PROVISIONING_FAILED_PREFIX}quota exhausted: count/secrets`,
    );
  });

  it("the pre-stamp is first-non-empty-wins — an existing error survives", async () => {
    const provisioner = fakeProvisioner({
      ensureError: new Error("second failure"),
    });
    const { sessionId, execution } = await seed(ExecutionTarget.CLOUD);
    const executionId = execution.metadata?.id ?? "";
    // Re-seed WITH a status already carrying the first error — the state
    // a concurrent runner write (or an earlier stamp) leaves behind.
    await store.saveResource(
      ApiResourceKind.run,
      executionId,
      RunSchema,
      create(RunSchema, {
        metadata: { id: executionId, name: executionId },
        spec: { target: { case: "sessionId", value: sessionId } },
        status: { error: "the real root cause" },
      }),
    );
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
    );
    const after = await store.getResource(
      ApiResourceKind.run,
      executionId,
      RunSchema,
    );
    expect(after.status?.error).toBe("the real root cause");
  });
});

describe("what an ensure came to", () => {
  let dir: string;
  let store: SqliteStore;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sandbox-outcome-"));
    store = SqliteStore.open(path.join(dir, "test.db"));
  });
  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seeded(id: string, target: ExecutionTarget, error = ""): Promise<Run> {
    await store.saveResource(
      ApiResourceKind.session,
      `ses_${id}`,
      SessionSchema,
      create(SessionSchema, { metadata: { id: `ses_${id}`, name: id }, spec: { executionTarget: target } }),
    );
    const execution = create(RunSchema, {
      metadata: { id: `axr_${id}`, name: id },
      spec: { target: { case: "sessionId", value: `ses_${id}` } },
      ...(error !== "" ? { status: { error } } : {}),
    });
    await store.saveResource(ApiResourceKind.run, `axr_${id}`, RunSchema, execution);
    return execution;
  }

  function ensureWith(
    provisioner: SandboxProvisioner,
    execution: Run,
    enabled = true,
    options?: { readonly runnerIdle?: boolean },
  ) {
    return ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: enabled ? lane(provisioner) : { enabled: false },
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
      },
      execution,
      TEST_CALLER,
      options,
    );
  }

  it("answers ready, skipped and failed for the arms that already were", async () => {
    expect(await ensureWith(fakeProvisioner(), await seeded("ready", ExecutionTarget.CLOUD))).toBe("ready");
    expect(await ensureWith(fakeProvisioner(), await seeded("local", ExecutionTarget.LOCAL))).toBe("skipped");
    expect(await ensureWith(fakeProvisioner(), await seeded("off", ExecutionTarget.CLOUD), false)).toBe("skipped");
    const sessionless = create(RunSchema, { metadata: { id: "axr_no_session", name: "no-session" }, spec: {} });
    expect(await ensureWith(fakeProvisioner(), sessionless), "a run in no session").toBe("skipped");
    expect(
      await ensureWith(fakeProvisioner({ ensureError: new Error("quota") }), await seeded("broken", ExecutionTarget.CLOUD)),
    ).toBe("failed");
  });

  it("answers no_room for the fleet's no-room, and stamps nothing", async () => {
    const execution = await seeded("full", ExecutionTarget.CLOUD);
    const outcome = await ensureWith(
      fakeProvisioner({ ensureError: new SandboxNoRoomError("no free Substrate worker for sandbox s: none") }),
      execution,
    );
    expect(outcome).toBe("no_room");
    const after = await store.getResource(ApiResourceKind.run, "axr_full", RunSchema);
    expect(after.status?.error ?? "").toBe("");
  });

  it("reads no room through a wrapping driver's cause, as the cloud's provisioner wraps substrate's", async () => {
    const wrapped = new Error("Failed to wake session sandbox for ses_wrapped: no free Substrate worker", {
      cause: new SandboxNoRoomError("no free Substrate worker for sandbox s: none"),
    });
    const execution = await seeded("wrapped", ExecutionTarget.CLOUD);
    expect(await ensureWith(fakeProvisioner({ ensureError: wrapped }), execution)).toBe("no_room");
    expect((await store.getResource(ApiResourceKind.run, "axr_wrapped", RunSchema)).status?.error ?? "").toBe("");
  });

  it("answers not_carried for a sandbox whose files cannot be carried, pre-stamping the person's line, never the driver's words (stigmer#1843)", async () => {
    const execution = await seeded("old", ExecutionTarget.CLOUD);
    const refused = new SandboxNotCarriedError(
      "Substrate refused to move sandbox sbx-ses-1 from template stigmer-runner-old to stigmer-runner-new (its volumes differ)",
    );
    expect(await ensureWith(fakeProvisioner({ ensureError: refused }), execution)).toBe("not_carried");
    expect((await store.getResource(ApiResourceKind.run, "axr_old", RunSchema)).status?.error).toBe(
      SANDBOX_NOT_CARRIED_COPY,
    );
  });

  it("reads not_carried through a wrapping driver's cause", async () => {
    const wrapped = new Error("Failed to wake session sandbox for ses_old2", {
      cause: new SandboxNotCarriedError("refused"),
    });
    const execution = await seeded("old2", ExecutionTarget.CLOUD);
    expect(await ensureWith(fakeProvisioner({ ensureError: wrapped }), execution)).toBe("not_carried");
  });

  it("hands runnerIdle to the driver only when its caller says the runner is idle", async () => {
    const provisioner = fakeProvisioner();
    await ensureWith(provisioner, await seeded("idle", ExecutionTarget.CLOUD), true, { runnerIdle: true });
    await ensureWith(provisioner, await seeded("busy", ExecutionTarget.CLOUD));
    expect(provisioner.ensured.map((call) => call.facts.runnerIdle)).toEqual([true, undefined]);
  });
});

describe("making room for a waiting run", () => {
  let dir: string;
  let store: SqliteStore;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sandbox-make-room-"));
    store = SqliteStore.open(path.join(dir, "test.db"));
  });
  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const noRoom = () => new SandboxNoRoomError("no free Substrate worker for sandbox s: none");

  async function seeded(id: string): Promise<Run> {
    await store.saveResource(
      ApiResourceKind.session,
      `ses_${id}`,
      SessionSchema,
      create(SessionSchema, { metadata: { id: `ses_${id}`, name: id }, spec: { executionTarget: ExecutionTarget.CLOUD } }),
    );
    const execution = create(RunSchema, {
      metadata: { id: `axr_${id}`, name: id },
      spec: { target: { case: "sessionId", value: `ses_${id}` } },
    });
    await store.saveResource(ApiResourceKind.run, `axr_${id}`, RunSchema, execution);
    return execution;
  }

  /** A provisioner whose ensures throw `errors` in turn and whose makeRoom answers `room`, recording every ask. */
  function roomy(errors: Error[], room: () => Promise<boolean>) {
    const provisioner = fakeProvisioner({ ensureErrors: errors });
    const forSessions: string[] = [];
    return {
      provisioner: Object.assign(provisioner, {
        makeRoom: async (forSessionId: string) => {
          forSessions.push(forSessionId);
          return room();
        },
      }),
      forSessions,
    };
  }

  function capture() {
    const entries: LogEntry[] = [];
    const logger = createLogger({ level: "info", pretty: false, write: () => {}, sink: (entry) => entries.push(entry) });
    return { entries, logger };
  }

  function ensure(
    provisioner: SandboxProvisioner,
    execution: Run,
    options: EnsureSessionSandboxOptions | undefined,
    logger = silentLogger,
    slept: number[] = [],
  ) {
    return ensureSessionSandboxForExecution(
      {
        store,
        logger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
        accounts: undefined,
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
      execution,
      TEST_CALLER,
      options,
    );
  }

  it("without the option, never asks: the request's ensure stays as it was", async () => {
    const { provisioner, forSessions } = roomy([noRoom()], async () => true);
    expect(await ensure(provisioner, await seeded("request"), { runnerIdle: false })).toBe("no_room");
    expect(await ensure(provisioner, await seeded("request2"), undefined)).toBe("ready");
    expect(forSessions).toEqual([]);
  });

  it("asks once for the waiting session, then asks for its sandbox again with the same facts and starts", async () => {
    const { provisioner, forSessions } = roomy([noRoom(), noRoom()], async () => true);
    const slept: number[] = [];
    const { entries, logger } = capture();
    expect(await ensure(provisioner, await seeded("made"), { runnerIdle: true, makeRoom: true }, logger, slept)).toBe("ready");
    expect(forSessions).toEqual(["ses_made"]);
    expect(slept).toEqual(MAKE_ROOM_RETRY_DELAYS_MS.slice(0, 2));
    expect(provisioner.asked).toHaveLength(3);
    const [first, ...retries] = provisioner.asked;
    for (const facts of retries) expect(facts, "one mint per ask").toBe(first);
    expect(entries.filter((entry) => entry.message === "No sandbox has room for the session now")).toEqual([]);
  });

  it("waits as before when the freed seat is still not seen after the retries, saying room was made", async () => {
    const { provisioner, forSessions } = roomy(
      Array.from({ length: 1 + MAKE_ROOM_RETRY_DELAYS_MS.length }, noRoom),
      async () => true,
    );
    const slept: number[] = [];
    const { entries, logger } = capture();
    expect(await ensure(provisioner, await seeded("unseen"), { makeRoom: true }, logger, slept)).toBe("no_room");
    expect(forSessions).toEqual(["ses_unseen"]);
    expect(slept).toEqual([...MAKE_ROOM_RETRY_DELAYS_MS]);
    const lines = entries.filter((entry) => entry.message === "No sandbox has room for the session now");
    expect(lines.map((entry) => entry.fields?.madeRoom)).toEqual([true]);
  });

  it("waits at once when no idle sandbox could be put to sleep, saying so", async () => {
    const { provisioner } = roomy([noRoom()], async () => false);
    const slept: number[] = [];
    const { entries, logger } = capture();
    expect(await ensure(provisioner, await seeded("none"), { makeRoom: true }, logger, slept)).toBe("no_room");
    expect(slept).toEqual([]);
    expect(provisioner.asked).toHaveLength(1);
    const lines = entries.filter((entry) => entry.message === "No sandbox has room for the session now");
    expect(lines.map((entry) => entry.fields?.madeRoom)).toEqual([false]);
  });

  it("a makeRoom that throws is logged once and read as false: the turn waits as it would have", async () => {
    const { provisioner } = roomy([noRoom()], () => Promise.reject(new Error("store unavailable")));
    const { entries, logger } = capture();
    expect(await ensure(provisioner, await seeded("threw"), { makeRoom: true }, logger)).toBe("no_room");
    expect(
      entries.filter((entry) => entry.message.startsWith("Could not put an idle sandbox to sleep")).map((e) => e.fields?.error),
    ).toEqual(["store unavailable"]);
    expect(entries.find((entry) => entry.message === "No sandbox has room for the session now")?.fields?.madeRoom).toBe(false);
  });

  it("a retry that fails otherwise is a provisioning failure, as any ensure's is", async () => {
    const { provisioner } = roomy([noRoom(), new Error("quota")], async () => true);
    expect(await ensure(provisioner, await seeded("broke"), { makeRoom: true })).toBe("failed");
  });

  it("asks nothing of a provisioner that offers no makeRoom, and nothing on any other failure", async () => {
    const plain = fakeProvisioner({ ensureError: noRoom() });
    expect(await ensure(plain, await seeded("plain"), { makeRoom: true })).toBe("no_room");
    const { provisioner, forSessions } = roomy([new Error("quota")], async () => true);
    expect(await ensure(provisioner, await seeded("quota"), { makeRoom: true })).toBe("failed");
    expect(forSessions).toEqual([]);
  });
});

describe("deprovisionSessionSandboxBestEffort", () => {
  it("tears down through the lane and swallows failures", async () => {
    const ok = fakeProvisioner();
    await deprovisionSessionSandboxBestEffort(lane(ok), silentLogger, "ses_1");
    expect(ok.deprovisioned).toEqual([{ scope: "session", id: "ses_1" }]);

    const failing = fakeProvisioner({
      deprovisionError: new Error("gone wrong"),
    });
    await deprovisionSessionSandboxBestEffort(
      lane(failing),
      silentLogger,
      "ses_2",
    );
    // Reaching here IS the assertion: the failure was swallowed.

    await deprovisionSessionSandboxBestEffort(
      { enabled: false },
      silentLogger,
      "ses_3",
    );
  });
});
