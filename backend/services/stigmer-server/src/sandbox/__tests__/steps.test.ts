/**
 * Pins the sandbox invocation surface's postures:
 *
 *   - the session lane fires ONLY on resolved CLOUD target with
 *     per-session routing, is NON-critical (a provisioning failure never
 *     throws), and PRE-STAMPS the root cause onto status.error
 *     first-non-empty-wins — the 2026-07 quota-outage contract;
 *   - a disabled mint lane launches token-less rather than failing;
 *   - the caller class reaches the driver's environment unchanged (a
 *     composed lane such as `guest` included);
 *   - the credential mint names the session's creator, whoever's turn
 *     creates or restores the sandbox (stigmer#2075): a person the
 *     conversation is shared with never takes the runner over, and a
 *     creator stamp that names nobody mints nothing (tokenless, fail
 *     closed). Under the trusted-local posture (no accounts port) the
 *     caller, the one operator, is minted for.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import type { AccountsByCaller } from "../../domain/identityaccount/resolve.js";

import { createLogger } from "../../boot/logger.js";
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
import type { SandboxEnvironment, SandboxProvisioner } from "../provisioner.js";
import {
  deprovisionSessionSandboxBestEffort,
  ensureSessionSandboxForExecution,
  SANDBOX_PROVISIONING_FAILED_PREFIX,
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
}): SandboxProvisioner & {
  ensured: Array<{ scope: string; id: string; env: SandboxEnvironment }>;
  deprovisioned: Array<{ scope: string; id: string }>;
} {
  const ensured: Array<{ scope: string; id: string; env: SandboxEnvironment }> =
    [];
  const deprovisioned: Array<{ scope: string; id: string }> = [];
  const ensure = async (scope: string, id: string, env: SandboxEnvironment) => {
    if (overrides?.ensureError) {
      throw overrides.ensureError;
    }
    ensured.push({ scope, id, env });
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
    ensureSessionSandbox: (id, env) => ensure("session", id, env),
    deprovisionSessionSandbox: (id) => deprovision("session", id),
    createConnectSandbox: async (id, env) => {
      await ensure("connect", id, env);
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
        env: {
          taskQueue: `session:${sessionId}`,
          stigmerToken: `tok-${execution.metadata?.id ?? ""}`,
          callerClass: "user",
        },
      },
    ]);
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
    expect(provisioner.ensured[0]?.env.callerClass).toBe("guest");
    expect(credentials.minted[0]?.callerIdentityId).toBe(
      GUEST_CALLER.identityId,
    );
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
    expect(provisioner.ensured[0]?.env.stigmerToken).toBe("cloud-tok-session");
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
    expect(provisioner.ensured[0]?.env.stigmerToken).toBe("");
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
