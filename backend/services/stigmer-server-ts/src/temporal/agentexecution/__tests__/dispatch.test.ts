/**
 * Dispatch-resolution tests — ports
 * pkg/domain/agentexecution/temporal/dispatch_test.go case-for-case: the
 * queue-routing modes (global vs session), the harness/execution-target
 * extraction with the session-not-found degrade, the UNSPECIFIED-target
 * resolution against the config default, and the sandbox-affinity
 * override lane (opaque queue pass-through with forced LOCAL target so
 * cloud sandbox provisioning never triggers, and NATIVE-harness default
 * when the session is absent). Go's private resolveTaskQueue cases are
 * asserted through resolveActivityTaskQueue — the public boundary is the
 * contract.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  ExecutionTarget,
  Harness,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  AgentExecutionTemporalConfig,
  DEFAULT_EXECUTION_TARGET_CLOUD,
  DEFAULT_EXECUTION_TARGET_LOCAL,
  ROUTING_GLOBAL,
  ROUTING_SESSION,
} from "../../../domain/agentexecution/temporal/config.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";
import { formatSessionTaskQueue, resolveActivityTaskQueue } from "../dispatch.js";
import { DEFAULT_ACTIVITY_TASK_QUEUE } from "../names.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function newStore(): Store {
  const dir = mkdtempSync(path.join(tmpdir(), "dispatch-test-"));
  const store = SqliteStore.open(path.join(dir, "dispatch_test.sqlite"), silentLogger);
  cleanups.push(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

async function saveSession(
  store: Store,
  id: string,
  harness: Harness,
  executionTarget = ExecutionTarget.UNSPECIFIED,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    create(SessionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { id, name: "test-session", org: "test-org" },
      spec: { agentInstanceId: "test-instance", harness, executionTarget },
    }),
  );
}

function globalConfig(): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig(
    "agent_execution_stigmer",
    DEFAULT_ACTIVITY_TASK_QUEUE,
    ROUTING_GLOBAL,
    DEFAULT_EXECUTION_TARGET_LOCAL,
  );
}

function sessionConfig(): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig(
    "agent_execution_stigmer",
    DEFAULT_ACTIVITY_TASK_QUEUE,
    ROUTING_SESSION,
    DEFAULT_EXECUTION_TARGET_LOCAL,
  );
}

function cloudConfig(): AgentExecutionTemporalConfig {
  return new AgentExecutionTemporalConfig(
    "agent_execution_stigmer",
    DEFAULT_ACTIVITY_TASK_QUEUE,
    ROUTING_SESSION,
    DEFAULT_EXECUTION_TARGET_CLOUD,
  );
}

describe("formatSessionTaskQueue", () => {
  it.each([
    ["ses_01arz3ndektsv4rrffq69g5fav", "session:ses_01arz3ndektsv4rrffq69g5fav"],
    ["ses_abc123", "session:ses_abc123"],
    ["any-arbitrary-id", "session:any-arbitrary-id"],
  ])("formats %s", (sessionId, want) => {
    expect(formatSessionTaskQueue(sessionId)).toBe(want);
  });
});

describe("resolveActivityTaskQueue — global routing", () => {
  it("no session ID — returns default queue with NATIVE harness", async () => {
    const store = newStore();
    const result = await resolveActivityTaskQueue(store, "", globalConfig(), "", silentLogger);
    expect(result.taskQueue).toBe(DEFAULT_ACTIVITY_TASK_QUEUE);
    expect(result.harness).toBe(Harness.NATIVE);
  });

  it("session not found — returns default queue without error", async () => {
    const store = newStore();
    const result = await resolveActivityTaskQueue(
      store,
      "nonexistent-session",
      globalConfig(),
      "",
      silentLogger,
    );
    expect(result.taskQueue).toBe(DEFAULT_ACTIVITY_TASK_QUEUE);
  });

  it("valid session — returns default queue even with session present", async () => {
    const store = newStore();
    await saveSession(store, "ses_global_test", Harness.CURSOR);
    const result = await resolveActivityTaskQueue(
      store,
      "ses_global_test",
      globalConfig(),
      "",
      silentLogger,
    );
    expect(result.taskQueue, "global routing must always return default queue").toBe(
      DEFAULT_ACTIVITY_TASK_QUEUE,
    );
    expect(result.harness).toBe(Harness.CURSOR);
  });
});

describe("resolveActivityTaskQueue — session routing", () => {
  it("no session ID — falls back to default queue", async () => {
    const store = newStore();
    const result = await resolveActivityTaskQueue(store, "", sessionConfig(), "", silentLogger);
    expect(result.taskQueue).toBe(DEFAULT_ACTIVITY_TASK_QUEUE);
    expect(result.harness).toBe(Harness.NATIVE);
  });

  it("valid session ID — returns per-session queue", async () => {
    const store = newStore();
    const sessionId = "ses_01arz3ndektsv4rrffq69g5fav";
    await saveSession(store, sessionId, Harness.NATIVE);
    const result = await resolveActivityTaskQueue(
      store,
      sessionId,
      sessionConfig(),
      "",
      silentLogger,
    );
    expect(result.taskQueue).toBe(`session:${sessionId}`);
    expect(result.harness).toBe(Harness.NATIVE);
  });

  it("session not found — still returns per-session queue with NATIVE default", async () => {
    const store = newStore();
    const sessionId = "ses_nonexistent";
    const result = await resolveActivityTaskQueue(
      store,
      sessionId,
      sessionConfig(),
      "",
      silentLogger,
    );
    expect(result.taskQueue).toBe(`session:${sessionId}`);
    expect(result.harness, "NATIVE default when session not found").toBe(Harness.NATIVE);
  });

  it("CURSOR harness — returns per-session queue with correct harness", async () => {
    const store = newStore();
    const sessionId = "ses_cursor_session";
    await saveSession(store, sessionId, Harness.CURSOR);
    const result = await resolveActivityTaskQueue(
      store,
      sessionId,
      sessionConfig(),
      "",
      silentLogger,
    );
    expect(result.taskQueue).toBe(`session:${sessionId}`);
    expect(result.harness).toBe(Harness.CURSOR);
  });

  it("custom runner queue used as the empty-session fallback", async () => {
    const store = newStore();
    const config = new AgentExecutionTemporalConfig(
      "agent_execution_stigmer",
      "custom_queue",
      ROUTING_SESSION,
      DEFAULT_EXECUTION_TARGET_LOCAL,
    );
    const result = await resolveActivityTaskQueue(store, "", config, "", silentLogger);
    expect(result.taskQueue).toBe("custom_queue");
  });
});

describe("resolveActivityTaskQueue — execution target", () => {
  it("session with LOCAL target returns LOCAL in result", async () => {
    const store = newStore();
    await saveSession(store, "ses_local", Harness.NATIVE, ExecutionTarget.LOCAL);
    const result = await resolveActivityTaskQueue(
      store,
      "ses_local",
      sessionConfig(),
      "",
      silentLogger,
    );
    expect(result.executionTarget).toBe(ExecutionTarget.LOCAL);
  });

  it("session with CLOUD target returns CLOUD in result", async () => {
    const store = newStore();
    await saveSession(store, "ses_cloud", Harness.NATIVE, ExecutionTarget.CLOUD);
    const result = await resolveActivityTaskQueue(
      store,
      "ses_cloud",
      sessionConfig(),
      "",
      silentLogger,
    );
    expect(result.executionTarget).toBe(ExecutionTarget.CLOUD);
  });

  it("session with UNSPECIFIED target resolves based on config", async () => {
    const store = newStore();
    await saveSession(store, "ses_unspecified", Harness.NATIVE);
    const result = await resolveActivityTaskQueue(
      store,
      "ses_unspecified",
      cloudConfig(),
      "",
      silentLogger,
    );
    expect(result.executionTarget, "CLOUD from config default").toBe(ExecutionTarget.CLOUD);
  });

  it("activity_task_queue override routes to the parent workflow sandbox", async () => {
    const store = newStore();
    const sessionId = "ses_override_test";
    await saveSession(store, sessionId, Harness.CURSOR);
    const override = "wfexec:wfx_parent_abc123";
    const result = await resolveActivityTaskQueue(
      store,
      sessionId,
      sessionConfig(),
      override,
      silentLogger,
    );
    expect(result.taskQueue).toBe(override);
    expect(result.harness, "the session's harness still resolves").toBe(Harness.CURSOR);
    expect(result.executionTarget, "LOCAL — no provisioning needed").toBe(ExecutionTarget.LOCAL);
  });

  it("activity_task_queue override with no session still works", async () => {
    const store = newStore();
    const override = "wfexec:wfx_no_session";
    const result = await resolveActivityTaskQueue(
      store,
      "",
      cloudConfig(),
      override,
      silentLogger,
    );
    expect(result.taskQueue).toBe(override);
    expect(result.harness, "default NATIVE harness").toBe(Harness.NATIVE);
    expect(result.executionTarget, "LOCAL — sandbox already exists").toBe(ExecutionTarget.LOCAL);
  });

  it("surfaces non-NotFound store failures with the pinned dispatch message", async () => {
    const store = newStore();
    await store.close();
    // The message text is contract: the create step maps it VERBATIM to
    // FailedPrecondition (Go's ResolveActivityTaskQueue boundary).
    await expect(
      resolveActivityTaskQueue(store, "ses_any", sessionConfig(), "", silentLogger),
    ).rejects.toThrow(/^failed to load session for dispatch: /);
  });

  it("empty override falls through to normal routing", async () => {
    const store = newStore();
    const sessionId = "ses_no_override";
    await saveSession(store, sessionId, Harness.NATIVE);
    const result = await resolveActivityTaskQueue(
      store,
      sessionId,
      sessionConfig(),
      "",
      silentLogger,
    );
    expect(result.taskQueue).toBe(formatSessionTaskQueue(sessionId));
  });
});

describe("AgentExecutionTemporalConfig.resolveExecutionTarget", () => {
  it.each([
    ["LOCAL passes through", ExecutionTarget.LOCAL, globalConfig(), ExecutionTarget.LOCAL],
    ["CLOUD passes through", ExecutionTarget.CLOUD, globalConfig(), ExecutionTarget.CLOUD],
    [
      "UNSPECIFIED resolves to LOCAL when default is local",
      ExecutionTarget.UNSPECIFIED,
      sessionConfig(),
      ExecutionTarget.LOCAL,
    ],
    [
      "UNSPECIFIED resolves to CLOUD when default is cloud",
      ExecutionTarget.UNSPECIFIED,
      cloudConfig(),
      ExecutionTarget.CLOUD,
    ],
  ] as const)("%s", (_name, target, config, want) => {
    expect(config.resolveExecutionTarget(target)).toBe(want);
  });
});
