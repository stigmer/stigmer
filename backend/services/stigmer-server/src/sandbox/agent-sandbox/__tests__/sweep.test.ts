/**
 * Pins the agent-sandbox idle sweep over the in-memory cluster and a fake
 * session reader, no cluster:
 *
 *   - it lists this server's session Sandboxes by label, so workflow and
 *     connect Sandboxes are never touched;
 *   - a Running Sandbox whose session has been idle for the window is
 *     suspended (its pod goes, nothing is deleted), and one inside the
 *     window, busy, Suspended or being deleted is not;
 *   - the idle clock starts at the latest of the session's last activity,
 *     this process's last ensure and the Sandbox's creation;
 *   - each suspend is decided from the cheap read, then again inside the
 *     driver's queue from a full read, so a turn the cheap read lags
 *     behind keeps its pod;
 *   - a Sandbox whose session has no executions, and one of ours that names
 *     no session, are suspended and logged as errors, never deleted; one
 *     whose session label does not match its name is left alone and logged;
 *   - a Sandbox another replica made, never ensured here, keeps its pod for
 *     the window from its creation;
 *   - a Sandbox the pass fails on is skipped and logged, and the pass goes
 *     on; a stopping sweep ends a pass between Sandboxes;
 *   - started, the sweep runs a pass at once, logs a pass that fails, starts
 *     no pass while one runs, and none once stopped.
 */
import { describe, expect, it, vi } from "vitest";

import type { Logger, LogFields } from "../../../boot/logger.js";
import type {
  SandboxDriverConfig,
  SessionActivity,
  SessionActivityReader,
} from "../../provisioner.js";
import { FakeAgentSandboxCluster } from "../__test-utils__/fake-gateway.js";
import type { AgentSandboxDriverSettings } from "../config.js";
import { newAgentSandboxDriverOverGateway } from "../driver.js";
import { buildAgentSandbox } from "../manifest.js";
import {
  runAgentSandboxSweepPass,
  startAgentSandboxSweep,
  SESSION_SANDBOX_SELECTOR,
} from "../sweep.js";
import { sandboxBaseName } from "../../naming.js";

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer-server.stigmer.svc:7234",
  mcpPublicEndpoint: "",
  temporalAddress: "temporal.stigmer.svc:7233",
  temporalNamespace: "stigmer",
  temporalConnectionEnv: {},
  runnerImage: "ghcr.io/stigmer/runner:v3.42.0",
  runnerCommand: "stigmer-runner",
  kubernetesNamespace: "stigmer-sandboxes",
  runnerEnv: {},
  runnerSecretEnv: {},
  serverRelease: "",
};

const settings: AgentSandboxDriverSettings = {
  suspendAfterSeconds: 330,
  sweepIntervalSeconds: 30,
};

const MIN = 60_000;
const T0 = Date.parse("2026-10-04T12:00:00Z");

class FakeSessions implements SessionActivityReader {
  readonly activities = new Map<string, SessionActivity>();
  /** What the cheap read answers while it lags behind the full one. */
  readonly lagging = new Map<string, SessionActivity>();
  readonly kinds: Array<"recent" | "full"> = [];

  async activity(sessionId: string): Promise<SessionActivity> {
    this.kinds.push("full");
    return this.read(sessionId);
  }

  async recentActivity(sessionId: string): Promise<SessionActivity> {
    this.kinds.push("recent");
    return this.lagging.get(sessionId) ?? this.read(sessionId);
  }

  private read(sessionId: string): SessionActivity {
    return (
      this.activities.get(sessionId) ?? { busy: false, lastActiveAt: undefined }
    );
  }

  async *sessionIds(): AsyncIterable<string> {
    yield* this.activities.keys();
  }
}

interface Entry {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(): Logger & { entries: Entry[] } {
  const entries: Entry[] = [];
  const at =
    (level: Entry["level"]) =>
    (message: string, fields?: LogFields): void => {
      entries.push({ level, message, fields });
    };
  return {
    entries,
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
}

function harness() {
  let t = T0;
  const now = () => t;
  const cluster = new FakeAgentSandboxCluster();
  cluster.clock = () => new Date(t);
  const driver = newAgentSandboxDriverOverGateway({
    gateway: cluster,
    config,
    logger: { info: () => {} },
    sleep: async () => {},
    now,
  });
  const sessions = new FakeSessions();
  const logger = recordingLogger();
  const pass = () =>
    runAgentSandboxSweepPass({
      driver: driver.internals,
      settings,
      sessions,
      logger,
      now,
    });
  return {
    cluster,
    driver,
    sessions,
    logger,
    pass,
    advance: (ms: number) => {
      t += ms;
    },
    now,
  };
}

const env = (taskQueue: string) => ({
  taskQueue,
  stigmerToken: "tok",
  callerClass: "user",
});

function modeOf(
  cluster: FakeAgentSandboxCluster,
  sessionId: string,
): string | undefined {
  return cluster.sandboxes.get(sandboxBaseName("session", sessionId))
    ?.operatingMode;
}

describe("the idle sweep", () => {
  it("lists this server's session Sandboxes by label", async () => {
    const h = harness();
    await h.pass();
    expect(h.cluster.calls).toEqual([`list:${SESSION_SANDBOX_SELECTOR}`]);
    expect(SESSION_SANDBOX_SELECTOR).toBe(
      "stigmer.ai/managed-by=stigmer-server,stigmer.ai/scope=session",
    );
  });

  it("suspends a session idle for the window, and deletes nothing", async () => {
    const h = harness();
    await h.driver.provisioner.ensureSessionSandbox(
      "ses_1",
      env("session:ses_1"),
    );
    h.sessions.activities.set("ses_1", {
      busy: false,
      lastActiveAt: new Date(T0),
    });
    h.advance(5.5 * MIN);
    await h.pass();
    expect(modeOf(h.cluster, "ses_1")).toBe("Suspended");
    expect(h.cluster.sandboxes.size).toBe(1);
    expect(h.cluster.calls.filter((call) => call.startsWith("delete"))).toEqual(
      [],
    );
    expect(h.sessions.kinds).toEqual(["recent", "full"]);
    expect(h.logger.entries).toContainEqual({
      level: "info",
      message: "agent-sandbox sandbox suspended (idle)",
      fields: {
        sandbox: sandboxBaseName("session", "ses_1"),
        sessionId: "ses_1",
      },
    });
  });

  it("leaves a session inside the window, a busy one, and one this process ensured lately", async () => {
    const h = harness();
    for (const id of ["ses_fresh", "ses_busy", "ses_ensured"]) {
      await h.driver.provisioner.ensureSessionSandbox(id, env(`session:${id}`));
    }
    h.sessions.activities.set("ses_fresh", {
      busy: false,
      lastActiveAt: new Date(T0 + 2 * MIN),
    });
    h.sessions.activities.set("ses_busy", {
      busy: true,
      lastActiveAt: new Date(T0),
    });
    h.sessions.activities.set("ses_ensured", {
      busy: false,
      lastActiveAt: new Date(T0),
    });
    h.advance(5 * MIN);
    await h.driver.provisioner.ensureSessionSandbox(
      "ses_ensured",
      env("session:ses_ensured"),
    );
    h.advance(MIN);
    await h.pass();
    for (const id of ["ses_fresh", "ses_busy", "ses_ensured"]) {
      expect(modeOf(h.cluster, id), id).toBe("Running");
    }
  });

  it("keeps the pod of a turn the cheap read lags behind, because the full read sees it", async () => {
    const h = harness();
    await h.driver.provisioner.ensureSessionSandbox(
      "ses_1",
      env("session:ses_1"),
    );
    h.sessions.lagging.set("ses_1", {
      busy: false,
      lastActiveAt: new Date(T0),
    });
    h.sessions.activities.set("ses_1", {
      busy: true,
      lastActiveAt: new Date(T0 + 6 * MIN),
    });
    h.advance(6 * MIN);
    await h.pass();
    expect(h.sessions.kinds).toEqual(["recent", "full"]);
    expect(modeOf(h.cluster, "ses_1")).toBe("Running");
  });

  it("never touches a Suspended, a deleted, a workflow or a connect Sandbox", async () => {
    const h = harness();
    h.cluster.seed(
      buildAgentSandbox(
        "session",
        "ses_asleep",
        env("session:ses_asleep"),
        config,
      ),
      "Suspended",
    );
    h.cluster.seed(
      buildAgentSandbox(
        "session",
        "ses_going",
        env("session:ses_going"),
        config,
      ),
      "Running",
    ).deletingReads = 5;
    h.cluster.seed(
      buildAgentSandbox("workflow", "wex_1", env("wfexec:wex_1"), config),
      "Running",
    );
    h.cluster.seed(
      buildAgentSandbox("connect", "mcp_1", env("mcpconnect:mcp_1"), config),
      "Running",
    );
    h.advance(60 * MIN);
    await h.pass();
    expect(h.sessions.kinds).toEqual([]);
    expect(h.cluster.calls.filter((call) => call.startsWith("patch"))).toEqual(
      [],
    );
  });

  it("suspends a Sandbox whose session has no executions, logging it, and never deletes it", async () => {
    const h = harness();
    h.cluster.seed(
      buildAgentSandbox("session", "ses_gone", env("session:ses_gone"), config),
      "Running",
    );
    h.advance(5.5 * MIN);
    await h.pass();
    expect(modeOf(h.cluster, "ses_gone")).toBe("Suspended");
    expect(h.cluster.calls.filter((call) => call.startsWith("delete"))).toEqual(
      [],
    );
    expect(h.logger.entries).toContainEqual({
      level: "error",
      message:
        "agent-sandbox sandbox's session has no executions; suspended it (its workspace is kept)",
      fields: {
        sandbox: sandboxBaseName("session", "ses_gone"),
        sessionId: "ses_gone",
      },
    });
  });

  it("suspends one of ours that names no session, logging it", async () => {
    const h = harness();
    const built = buildAgentSandbox(
      "session",
      "ses_x",
      env("session:ses_x"),
      config,
    );
    const { ["stigmer.ai/sandbox-id"]: _dropped, ...labels } =
      built.metadata.labels;
    h.cluster.seed(
      { ...built, metadata: { ...built.metadata, labels } },
      "Running",
    );
    await h.pass();
    expect(modeOf(h.cluster, "ses_x")).toBe("Suspended");
    expect(h.sessions.kinds).toEqual([]);
    expect(h.logger.entries).toContainEqual({
      level: "error",
      message:
        "agent-sandbox sandbox names no session; suspended it (its workspace is kept)",
      fields: { sandbox: sandboxBaseName("session", "ses_x") },
    });
  });

  it("starts the idle clock at the Sandbox's creation, for one another replica made", async () => {
    const h = harness();
    h.cluster.seed(
      buildAgentSandbox("session", "ses_new", env("session:ses_new"), config),
      "Running",
    );
    h.advance(MIN);
    await h.pass();
    expect(modeOf(h.cluster, "ses_new")).toBe("Running");
    h.advance(4.5 * MIN);
    await h.pass();
    expect(modeOf(h.cluster, "ses_new")).toBe("Suspended");
  });

  it("leaves alone, and logs, a Sandbox whose session label does not match its name", async () => {
    const h = harness();
    const built = buildAgentSandbox(
      "session",
      "ses_busy",
      env("session:ses_busy"),
      config,
    );
    h.cluster.seed(
      {
        ...built,
        metadata: {
          ...built.metadata,
          labels: {
            ...built.metadata.labels,
            "stigmer.ai/sandbox-id": "ses_idle",
          },
        },
      },
      "Running",
    );
    h.advance(60 * MIN);
    await h.pass();
    expect(modeOf(h.cluster, "ses_busy")).toBe("Running");
    expect(h.sessions.kinds).toEqual([]);
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      message:
        "agent-sandbox sandbox's session label does not match its name; left it alone",
      fields: {
        sandbox: sandboxBaseName("session", "ses_busy"),
        sessionId: "ses_idle",
      },
    });
  });

  it("skips a Sandbox it fails on, logging it, and goes on with the rest", async () => {
    const h = harness();
    for (const id of ["ses_a", "ses_b"]) {
      await h.driver.provisioner.ensureSessionSandbox(id, env(`session:${id}`));
      h.sessions.activities.set(id, {
        busy: false,
        lastActiveAt: new Date(T0),
      });
    }
    const failing = sandboxBaseName("session", "ses_a");
    const getSandbox = h.cluster.getSandbox.bind(h.cluster);
    h.cluster.getSandbox = async (name) => {
      if (name === failing) throw new Error("the API server refused");
      return getSandbox(name);
    };
    h.advance(6 * MIN);
    await h.pass();
    expect(modeOf(h.cluster, "ses_a")).toBe("Running");
    expect(modeOf(h.cluster, "ses_b")).toBe("Suspended");
    expect(h.logger.entries).toContainEqual({
      level: "warn",
      message: "agent-sandbox idle sweep skipped a sandbox",
      fields: { sandbox: failing, error: "the API server refused" },
    });
  });

  it("ends a pass between Sandboxes once it is stopping", async () => {
    const h = harness();
    for (const id of ["ses_a", "ses_b"]) {
      await h.driver.provisioner.ensureSessionSandbox(id, env(`session:${id}`));
    }
    h.advance(6 * MIN);
    await runAgentSandboxSweepPass({
      driver: h.driver.internals,
      settings,
      sessions: h.sessions,
      logger: h.logger,
      now: h.now,
      stopping: () => true,
    });
    expect(h.sessions.kinds).toEqual([]);
  });
});

describe("the started sweep", () => {
  it("runs a pass at once, before its first interval", async () => {
    const h = harness();
    await h.driver.provisioner.ensureSessionSandbox(
      "ses_1",
      env("session:ses_1"),
    );
    h.advance(6 * MIN);
    const handle = startAgentSandboxSweep({
      driver: h.driver.internals,
      settings,
      sessions: h.sessions,
      logger: h.logger,
      now: h.now,
    });
    await vi.waitFor(() =>
      expect(modeOf(h.cluster, "ses_1")).toBe("Suspended"),
    );
    await handle.stop();
    expect(h.cluster.calls).toContain(`list:${SESSION_SANDBOX_SELECTOR}`);
  });

  it("logs a pass that fails, and keeps the sweep alive", async () => {
    const h = harness();
    h.cluster.listSandboxes = async () => {
      throw new Error("list refused");
    };
    const handle = startAgentSandboxSweep({
      driver: h.driver.internals,
      settings,
      sessions: h.sessions,
      logger: h.logger,
      now: h.now,
    });
    await handle.stop();
    expect(h.logger.entries).toContainEqual({
      level: "error",
      message: "agent-sandbox idle sweep pass failed",
      fields: { error: "list refused" },
    });
  });

  it("starts no pass while one is running, and none once stopped", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      let release: () => void = () => {};
      let lists = 0;
      h.cluster.listSandboxes = async () => {
        lists += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [];
      };
      const handle = startAgentSandboxSweep({
        driver: h.driver.internals,
        settings,
        sessions: h.sessions,
        logger: h.logger,
        now: h.now,
      });
      await vi.advanceTimersByTimeAsync(
        settings.sweepIntervalSeconds * 1000 * 3,
      );
      expect(lists).toBe(1);
      release();
      const stopped = handle.stop();
      await vi.advanceTimersByTimeAsync(
        settings.sweepIntervalSeconds * 1000 * 3,
      );
      await stopped;
      expect(lists).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
