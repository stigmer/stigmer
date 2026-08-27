/**
 * Pins the sandbox invocation surface's per-lane postures (§6d, O6 —
 * the T01 gate rulings Q1/Q2/Q3/Q6):
 *
 *   - the session lane fires ONLY on resolved CLOUD target with
 *     per-session routing, is NON-critical (a provisioning failure never
 *     throws), and PRE-STAMPS the root cause onto status.error
 *     first-non-empty-wins — the 2026-07 quota-outage contract;
 *   - the workflow lane fires only on CLOUD + per-execution routing and
 *     is CRITICAL (Unavailable on failure);
 *   - the terminal observer deprovisions exactly on transitions INTO a
 *     terminal phase, fire-and-forget, and swallows (logs) teardown
 *     failures;
 *   - a disabled mint lane launches token-less rather than failing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../boot/logger.js";
import {
  AgentExecutionTemporalConfig,
  ROUTING_GLOBAL,
  ROUTING_SESSION,
} from "../../domain/agentexecution/temporal/config.js";
import {
  WORKFLOW_ROUTING_EXECUTION,
  WORKFLOW_ROUTING_GLOBAL,
  WorkflowExecutionTemporalConfig,
} from "../../domain/workflowexecution/temporal/config.js";
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
  ensureWorkflowSandboxForExecution,
  newWorkflowSandboxTerminalObserver,
  SANDBOX_PROVISIONING_FAILED_PREFIX,
} from "../steps.js";

/**
 * The caller identity the ensure bodies thread into the credential mint
 * (C4): the OSS execution-scoped mint ignores it, so these tests pass a
 * fixed value and the token assertions stay binding-shaped.
 */
const TEST_CALLER_IDENTITY_ID = "ida_test_caller";

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
    ensureWorkflowSandbox: (id, env) => ensure("workflow", id, env),
    deprovisionWorkflowSandbox: (id) => deprovision("workflow", id),
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
 * A provider with the C4 mintSandboxCredential capability: records the
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

const executionRoutingConfig = new WorkflowExecutionTemporalConfig(
  "workflow_execution_stigmer",
  "stigmer_runner",
  WORKFLOW_ROUTING_EXECUTION,
  "local",
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
    execution: AgentExecution;
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
    const execution = create(AgentExecutionSchema, {
      metadata: { id: executionId, name: executionId },
      spec: { sessionId },
    });
    await store.saveResource(
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
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
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
    );
    expect(provisioner.ensured).toEqual([
      {
        scope: "session",
        id: sessionId,
        env: {
          taskQueue: `session:${sessionId}`,
          stigmerToken: `tok-${execution.metadata?.id ?? ""}`,
        },
      },
    ]);
  });

  it("delegates the mint to the capability provider with the full provisioning context (C4)", async () => {
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
    const execution = create(AgentExecutionSchema, {
      metadata: { id: executionId, name: executionId, org: "org-test" },
      spec: { sessionId },
    });

    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner, credentials),
        temporalConfig: sessionRoutingCloudDefault,
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
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

  it("skips on resolved LOCAL target — the roster fast path", async () => {
    const provisioner = fakeProvisioner();
    const { execution } = await seed(ExecutionTarget.LOCAL);
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
    );
    expect(provisioner.ensured).toEqual([]);
  });

  it("skips when the lane is disabled without touching the store", async () => {
    const execution = create(AgentExecutionSchema, {
      metadata: { id: "axr_disabled" },
      spec: { sessionId: "ses_never_loaded" },
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
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
    );
  });

  it("skips on the wfexec: queue-override lane (child sandbox affinity)", async () => {
    const provisioner = fakeProvisioner();
    const { execution } = await seed(ExecutionTarget.CLOUD);
    if (execution.spec !== undefined) {
      execution.spec.activityTaskQueue = "wfexec:wfx_parent";
    }
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
    );
    expect(provisioner.ensured).toEqual([]);
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
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
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
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
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
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
    );
    const stamped = await store.getResource(
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
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
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        metadata: { id: executionId, name: executionId },
        spec: { sessionId },
        status: { error: "the real root cause" },
      }),
    );
    await ensureSessionSandboxForExecution(
      {
        store,
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: sessionRoutingCloudDefault,
      },
      execution,
      TEST_CALLER_IDENTITY_ID,
    );
    const after = await store.getResource(
      ApiResourceKind.agent_execution,
      executionId,
      AgentExecutionSchema,
    );
    expect(after.status?.error).toBe("the real root cause");
  });
});

describe("the workflow lane (ensureWorkflowSandboxForExecution)", () => {
  function workflowExecution(target: ExecutionTarget) {
    return create(WorkflowExecutionSchema, {
      metadata: { id: "wfx_sbx_1", name: "wfx_sbx_1" },
      spec: { executionTarget: target },
    });
  }

  it("fires on CLOUD + per-execution routing with the wfexec queue", async () => {
    const provisioner = fakeProvisioner();
    await ensureWorkflowSandboxForExecution(
      {
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: executionRoutingConfig,
      },
      workflowExecution(ExecutionTarget.CLOUD),
      TEST_CALLER_IDENTITY_ID,
    );
    expect(provisioner.ensured).toEqual([
      {
        scope: "workflow",
        id: "wfx_sbx_1",
        env: { taskQueue: "wfexec:wfx_sbx_1", stigmerToken: "tok-wfx_sbx_1" },
      },
    ]);
  });

  it("delegates the mint to the capability provider on the workflow scope (C4)", async () => {
    const provisioner = fakeProvisioner();
    const credentials = capabilityCredentials();
    await ensureWorkflowSandboxForExecution(
      {
        logger: silentLogger,
        lane: lane(provisioner, credentials),
        temporalConfig: executionRoutingConfig,
      },
      create(WorkflowExecutionSchema, {
        metadata: { id: "wfx_sbx_cap", name: "wfx_sbx_cap", org: "org-test" },
        spec: { executionTarget: ExecutionTarget.CLOUD },
      }),
      TEST_CALLER_IDENTITY_ID,
    );
    expect(credentials.minted).toEqual([
      {
        scope: "workflow",
        sessionId: "",
        executionId: "wfx_sbx_cap",
        org: "org-test",
        callerIdentityId: TEST_CALLER_IDENTITY_ID,
      },
    ]);
    expect(provisioner.ensured[0]?.env.stigmerToken).toBe("cloud-tok-workflow");
  });

  it("skips on LOCAL target and on global routing", async () => {
    const provisioner = fakeProvisioner();
    await ensureWorkflowSandboxForExecution(
      {
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: executionRoutingConfig,
      },
      workflowExecution(ExecutionTarget.LOCAL),
      TEST_CALLER_IDENTITY_ID,
    );
    await ensureWorkflowSandboxForExecution(
      {
        logger: silentLogger,
        lane: lane(provisioner),
        temporalConfig: new WorkflowExecutionTemporalConfig(
          "workflow_execution_stigmer",
          "stigmer_runner",
          WORKFLOW_ROUTING_GLOBAL,
          "cloud",
        ),
      },
      workflowExecution(ExecutionTarget.CLOUD),
      TEST_CALLER_IDENTITY_ID,
    );
    expect(provisioner.ensured).toEqual([]);
  });

  it("a provisioning failure is CRITICAL — Unavailable, the create refused", async () => {
    const provisioner = fakeProvisioner({
      ensureError: new Error("no capacity"),
    });
    try {
      await ensureWorkflowSandboxForExecution(
        {
          logger: silentLogger,
          lane: lane(provisioner),
          temporalConfig: executionRoutingConfig,
        },
        workflowExecution(ExecutionTarget.CLOUD),
        TEST_CALLER_IDENTITY_ID,
      );
      expect.unreachable("the workflow lane must throw on failure");
    } catch (error) {
      const connectError = ConnectError.from(error);
      expect(connectError.code).toBe(Code.Unavailable);
      expect(connectError.rawMessage).toBe(
        "failed to provision workflow sandbox",
      );
    }
  });
});

describe("the terminal observer (newWorkflowSandboxTerminalObserver)", () => {
  const P = WorkflowExecutionPhase;

  it("deprovisions on every transition INTO a terminal phase", async () => {
    const provisioner = fakeProvisioner();
    const observe = newWorkflowSandboxTerminalObserver(
      lane(provisioner),
      silentLogger,
    );
    observe("wfx_1", P.EXECUTION_IN_PROGRESS, P.EXECUTION_COMPLETED);
    observe("wfx_2", P.EXECUTION_IN_PROGRESS, P.EXECUTION_FAILED);
    observe("wfx_3", P.EXECUTION_PENDING, P.EXECUTION_CANCELLED);
    observe("wfx_4", P.EXECUTION_PAUSED, P.EXECUTION_TERMINATED);
    await vi.waitFor(() => {
      expect(provisioner.deprovisioned.map((d) => d.id)).toEqual([
        "wfx_1",
        "wfx_2",
        "wfx_3",
        "wfx_4",
      ]);
    });
    expect(provisioner.deprovisioned.every((d) => d.scope === "workflow")).toBe(
      true,
    );
  });

  it("ignores non-terminal phases, non-transitions, and the disabled lane", async () => {
    const provisioner = fakeProvisioner();
    const observe = newWorkflowSandboxTerminalObserver(
      lane(provisioner),
      silentLogger,
    );
    observe("wfx_a", P.EXECUTION_PENDING, P.EXECUTION_IN_PROGRESS);
    observe("wfx_b", P.EXECUTION_FAILED, P.EXECUTION_FAILED);
    const disabledObserve = newWorkflowSandboxTerminalObserver(
      { enabled: false },
      silentLogger,
    );
    disabledObserve("wfx_c", P.EXECUTION_IN_PROGRESS, P.EXECUTION_COMPLETED);
    // Give any wrongly-fired teardown a chance to surface.
    await new Promise((resolve) => setImmediate(resolve));
    expect(provisioner.deprovisioned).toEqual([]);
  });

  it("a teardown failure is logged, never thrown (fire-and-forget)", async () => {
    const failures: string[] = [];
    const loggingLogger = createLogger({
      level: "error",
      pretty: false,
      write: (line) => failures.push(line),
    });
    const provisioner = fakeProvisioner({
      deprovisionError: new Error("api unreachable"),
    });
    const observe = newWorkflowSandboxTerminalObserver(
      lane(provisioner),
      loggingLogger,
    );
    observe("wfx_leak", P.EXECUTION_IN_PROGRESS, P.EXECUTION_FAILED);
    await vi.waitFor(() => {
      expect(failures.join("")).toContain("sandbox may be leaked");
    });
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
