/**
 * Pins the open-source idle sweep (sweep.ts) over a fake Substrate and a
 * fake session reader, with no real time:
 *
 *   - an idle running session sandbox is suspended, a sleeping one left
 *     asleep, a busy one left running; connect sandboxes are never
 *     touched;
 *   - a turn that arrives while the suspend is in flight resumes the
 *     sandbox at once;
 *   - each action is re-decided from fresh reads inside the actor's queue;
 *   - the pass decides from the reader's cheap read and every act from
 *     its full read, so a cheap read that lags a recovered run costs a
 *     refused act, and the next pass decides from the healed read;
 *   - a sandbox this process never ensured is named by a scan of every
 *     session; one no later scan names is an orphan, suspended and never
 *     deleted; one created since the last scan (leaning by the clock-skew
 *     allowance) is left alone, and scans are rate-limited;
 *   - a sandbox left DELETING is deleted again; a suspended one on an older
 *     template is moved; unused templates are retired; the sandboxes upkeep
 *     failed on are summed in one warning per pass, a count and a capped
 *     sample with each one's state, since when and a cut error;
 *   - start runs a pass at once; a stopping sweep ends its pass after the
 *     sandbox in hand;
 *   - on a draining worker a sandbox is stored (suspended durably) as soon
 *     as its session is not busy, inside its idle window; a busy one runs
 *     on until the drain deadline and is then stored, never thawed for the
 *     turn it ended, while an idle store a turn races is thawed; a sandbox
 *     that left the draining worker before the act (stored and woken by a
 *     new turn) is not stored again; one on an active
 *     worker follows the ladder, suspended asynchronously; an orphan on a
 *     draining worker is stored; a worker read that fails is one warning
 *     and the ladder runs as before.
 */
import { describe, expect, it, vi } from "vitest";

import { createLogger, type LogEntry } from "../../../boot/logger.js";
import { sandboxBaseName } from "../../naming.js";
import type {
  SandboxDriverConfig,
  SessionActivity,
  SessionActivityReader,
} from "../../provisioner.js";
import { FakeSubstrate, fakeRouter } from "../__test-utils__/fake-gateway.js";
import type { SubstrateDriverSettings } from "../config.js";
import { newSubstrateSandboxDriverOverGateway } from "../driver.js";
import type { SubstrateSandboxState } from "../gateway.js";
import { CLOCK_SKEW_ALLOWANCE_MS, DRAIN_DEADLINE_MS } from "../limits.js";
import {
  newSweepState,
  runSweepPass,
  SCAN_INTERVAL_MS,
  startSubstrateSweep,
} from "../sweep.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const config: SandboxDriverConfig = {
  backendEndpoint: "http://stigmer.stigmer.svc:7234",
  mcpPublicEndpoint: "",
  temporalNamespace: "default",
  runnerImage: `r@sha256:${"a".repeat(64)}`,
  runnerCommand: "",
  kubernetesNamespace: "",
  runnerEnv: {},
  runnerSecretEnv: {},
  serverRelease: "",
};

const settings: SubstrateDriverSettings = {
  apiEndpoint: "https://api.ate-system.svc:443",
  apiServerName: "",
  apiCaFile: "",
  apiTokenFile: "/unused",
  routerUrl: "http://router.example:18200",
  routerCaFile: "",
  routerServerName: "",
  routerClientCertFile: "",
  atespace: "stigmer",
  workerSelector: { workload: "stigmer" },
  httpsEgress: "none",
  extraHttpEgress: [],
  platformHttpsHosts: [],
  suspendAfterSeconds: 300,
  sweepIntervalSeconds: 60,
};

const MIN = 60_000;

class FakeSessions implements SessionActivityReader {
  readonly activities = new Map<string, SessionActivity>();
  /** What the cheap read answers while it lags; a full read of the session clears it, as the reader's does. */
  readonly lagging = new Map<string, SessionActivity>();
  readonly ids: string[] = [];
  /** Which read each call was, in order. */
  readonly kinds: Array<"recent" | "full"> = [];
  scans = 0;
  /** Called on every activity read; may change what later reads return. */
  onRead: (sessionId: string, read: number) => void = () => {};
  private reads = 0;

  async activity(sessionId: string): Promise<SessionActivity> {
    this.kinds.push("full");
    this.lagging.delete(sessionId);
    return this.read(sessionId);
  }

  async recentActivity(sessionId: string): Promise<SessionActivity> {
    this.kinds.push("recent");
    return this.lagging.get(sessionId) ?? this.read(sessionId);
  }

  private read(sessionId: string): SessionActivity {
    this.reads += 1;
    this.onRead(sessionId, this.reads);
    return (
      this.activities.get(sessionId) ?? { busy: false, lastActiveAt: undefined }
    );
  }

  async *sessionIds(): AsyncIterable<string> {
    this.scans += 1;
    yield* this.ids;
  }
}

function harness(logger = silentLogger) {
  let t = Date.parse("2026-10-03T12:00:00Z");
  const now = () => t;
  const substrate = new FakeSubstrate(now);
  const sessions = new FakeSessions();
  const driver = newSubstrateSandboxDriverOverGateway({
    config,
    settings,
    logger,
    gateway: substrate,
    fetch: fakeRouter().fetch,
    now,
    sleep: async (ms) => {
      t += ms;
    },
  });
  const options = {
    driver: driver.internals,
    lifecycle: driver.lifecycle,
    sessions,
    logger,
    now,
  };
  const state = newSweepState();
  return {
    t: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    substrate,
    sessions,
    driver,
    state,
    pass: () => runSweepPass(state, options),
    options,
  };
}

/** A session actor this process has ensured, idle since `idleMs` ago. */
function known(
  h: ReturnType<typeof harness>,
  sessionId: string,
  state: SubstrateSandboxState,
  idleMs: number,
  busy = false,
) {
  const name = sandboxBaseName("session", sessionId);
  h.substrate.put({
    name,
    state,
    template: "t",
    createTime: new Date(h.t() - idleMs),
  });
  h.driver.internals.sessionByActor.set(name, sessionId);
  h.sessions.ids.push(sessionId);
  h.sessions.activities.set(sessionId, {
    busy,
    lastActiveAt: new Date(h.t() - idleMs),
  });
  return name;
}

describe("the ladder", () => {
  it("suspends an idle running sandbox, leaves a sleeping one and a busy one", async () => {
    const h = harness();
    const idle = known(h, "ses_idle", "running", 6 * MIN);
    const asleep = known(h, "ses_asleep", "suspended", 31 * MIN);
    const busy = known(h, "ses_busy", "running", 120 * MIN, true);
    const fresh = known(h, "ses_fresh", "running", 1 * MIN);
    await h.pass();
    expect(h.substrate.actors.get(idle)?.state).toBe("suspended");
    expect(h.substrate.actors.get(asleep)?.state).toBe("suspended");
    expect(h.substrate.calls).not.toContain(`suspendActor ${asleep}`);
    expect(h.substrate.actors.get(busy)?.state).toBe("running");
    expect(h.substrate.actors.get(fresh)?.state).toBe("running");
  });

  it("never touches connect sandboxes", async () => {
    const h = harness();
    const running = sandboxBaseName("connect", "mcx_2");
    const mcp = sandboxBaseName("connect", "mcx_1");
    h.substrate.put({
      name: running,
      state: "running",
      template: "t",
      createTime: new Date(h.t() - 600 * MIN),
    });
    h.substrate.put({
      name: mcp,
      state: "suspended",
      template: "t",
      createTime: new Date(h.t() - 600 * MIN),
    });
    await h.pass();
    expect(h.substrate.actors.get(running)?.state).toBe("running");
    expect(h.substrate.actors.get(mcp)?.state).toBe("suspended");
    expect(
      h.substrate.calls.filter((c) => c.startsWith("suspendActor")),
    ).toEqual([]);
  });

  it("resumes at once when a turn arrived while the suspend was in flight", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 6 * MIN);
    // Reads: the pass's decision, the re-decision in the queue, then the
    // check after the suspend, which sees the new turn.
    h.sessions.onRead = (_id, read) => {
      if (read === 3)
        h.sessions.activities.set("ses_a", {
          busy: true,
          lastActiveAt: new Date(h.t()),
        });
    };
    await h.pass();
    expect(h.substrate.calls.filter((c) => c.endsWith(name))).toEqual([
      `getActor ${name}`,
      `suspendActor ${name}`,
      `resumeActor ${name}`,
    ]);
    expect(h.substrate.actors.get(name)?.state).toBe("running");
  });

  it("acts only on a fresh re-decision: a turn that began before the queue is left alone", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 6 * MIN);
    h.sessions.onRead = (_id, read) => {
      if (read === 2)
        h.sessions.activities.set("ses_a", {
          busy: true,
          lastActiveAt: new Date(h.t()),
        });
    };
    await h.pass();
    expect(h.substrate.calls).not.toContain(`suspendActor ${name}`);
  });

  it("decides from the cheap read and acts only on full reads", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 6 * MIN);
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
    // The pass's decision, the re-decision in the queue, the check after
    // the suspend.
    expect(h.sessions.kinds).toEqual(["recent", "full", "full"]);
  });

  it("a cheap read that lags a recovered run costs one refused act; the next pass reads the healed answer", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 60 * MIN, true);
    h.sessions.lagging.set("ses_a", {
      busy: false,
      lastActiveAt: new Date(h.t() - 60 * MIN),
    });
    await h.pass();
    expect(h.substrate.calls).not.toContain(`suspendActor ${name}`);
    expect(h.sessions.kinds).toEqual(["recent", "full"]);

    h.sessions.kinds.length = 0;
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("running");
    expect(h.sessions.kinds).toEqual(["recent"]);
  });

  it("an ensure in this process restarts the idle clock", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 6 * MIN);
    await h.driver.provisioner.ensureSessionSandbox("ses_a", {
      taskQueue: "session:ses_a",
      stigmerToken: "",
      callerClass: "user",
      executionId: "aex_test",
    });
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("running");
  });
});

describe("sandboxes this process never ensured", () => {
  it("are named by a scan of every session, then follow the ladder", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_old");
    h.substrate.put({
      name,
      state: "running",
      template: "t",
      createTime: new Date(h.t() - 60 * MIN),
    });
    h.sessions.ids.push("ses_old");
    h.sessions.activities.set("ses_old", {
      busy: false,
      lastActiveAt: new Date(h.t() - 60 * MIN),
    });
    await h.pass();
    expect(h.sessions.scans).toBe(1);
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
  });

  it("an orphan is suspended and kept, never deleted", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_gone");
    h.substrate.put({
      name,
      state: "running",
      template: "t",
      createTime: new Date(h.t() - 60 * MIN),
    });
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
    expect(h.substrate.calls).not.toContain(`deleteActor ${name}`);
  });

  it("one created since the last scan is left alone until a scan that began after it; scans are rate-limited", async () => {
    const h = harness();
    await h.pass();
    expect(h.sessions.scans).toBe(0);
    // An unnamed sandbox appears; no scan has begun after its creation yet.
    const name = sandboxBaseName("session", "ses_gone");
    h.substrate.put({
      name,
      state: "running",
      template: "t",
      createTime: new Date(h.t()),
    });
    await h.pass();
    expect(h.sessions.scans).toBe(1);
    expect(h.substrate.actors.get(name)?.state).toBe("running");
    h.advance(MIN);
    await h.pass();
    expect(h.sessions.scans).toBe(1);
    expect(h.substrate.actors.get(name)?.state).toBe("running");
    // The next scan, begun after it was created, does not name it: an orphan.
    h.advance(SCAN_INTERVAL_MS);
    await h.pass();
    expect(h.sessions.scans).toBe(2);
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
  });

  it("one created within the clock-skew allowance before a scan began is not taken for an orphan by it", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_new");
    h.substrate.put({
      name,
      state: "running",
      template: "t",
      createTime: new Date(h.t() - CLOCK_SKEW_ALLOWANCE_MS + 1_000),
    });
    await h.pass();
    expect(h.sessions.scans).toBe(1);
    expect(h.substrate.actors.get(name)?.state).toBe("running");
  });

  it("a session created through another replica is named by the next scan and kept running while busy", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_elsewhere");
    h.substrate.put({
      name,
      state: "running",
      template: "t",
      createTime: new Date(h.t()),
    });
    h.sessions.ids.push("ses_elsewhere");
    h.sessions.activities.set("ses_elsewhere", {
      busy: true,
      lastActiveAt: new Date(h.t() - 60 * MIN),
    });
    await h.pass();
    expect(h.driver.internals.sessionByActor.get(name)).toBe("ses_elsewhere");
    expect(h.substrate.actors.get(name)?.state).toBe("running");
  });
});

describe("housekeeping", () => {
  it("writes no sandbox's egress policy: an awake one gets its own at its next ensure, which knows its Environment", async () => {
    const h = harness();
    const awake = sandboxBaseName("connect", "mcx_1");
    h.substrate.put({
      name: awake,
      state: "running",
      template: "t",
      policy: [],
    });
    const asleep = sandboxBaseName("session", "ses_s");
    h.substrate.put({
      name: asleep,
      state: "suspended",
      template: "t",
      policy: [],
    });
    await h.pass();
    await h.pass();
    expect(h.substrate.calls.filter((c) => c.startsWith("ensureEgressPolicy"))).toEqual([]);
    expect(h.substrate.actors.get(awake)?.policy).toEqual([]);
    expect(h.substrate.actors.get(asleep)?.policy).toEqual([]);
  });

  it("deletes a sandbox left DELETING again", async () => {
    const h = harness();
    const name = sandboxBaseName("connect", "mcx_1");
    h.substrate.put({ name, state: "deleting", template: "t" });
    await h.pass();
    expect(h.substrate.actors.has(name)).toBe(false);
  });

  it("moves a suspended sandbox on an older template once the current one is ready, and retires the old", async () => {
    const h = harness();
    await h.driver.internals.keeper.ready();
    h.substrate.putTemplate("stigmer-runner-aaaaaaaaaaaa", {
      createTime: new Date(h.t() - 60 * MIN),
    });
    const name = sandboxBaseName("session", "ses_a");
    h.substrate.put({
      name,
      state: "suspended",
      template: "stigmer-runner-aaaaaaaaaaaa",
    });
    await h.pass();
    expect(h.substrate.actors.get(name)?.template).toBe(
      h.driver.internals.keeper.name,
    );
    expect(h.substrate.templates.has("stigmer-runner-aaaaaaaaaaaa")).toBe(
      false,
    );
  });

  it("start runs a pass at once and prepares the template", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 6 * MIN);
    const handle = startSubstrateSweep(h.options);
    await vi.waitFor(() => {
      expect(h.substrate.actors.get(name)?.state).toBe("suspended");
    });
    await handle.stop();
    expect(h.substrate.calls.some((c) => c.startsWith("createTemplate"))).toBe(
      true,
    );
  });

  it("a stopping sweep finishes the sandbox in hand and ends the pass there", async () => {
    const h = harness();
    const first = known(h, "ses_a", "running", 6 * MIN);
    const second = known(h, "ses_b", "running", 6 * MIN);
    let stopping = false;
    const suspend = h.substrate.suspendActor.bind(h.substrate);
    h.substrate.suspendActor = async (name) => {
      stopping = true;
      return suspend(name);
    };
    await runSweepPass(h.state, { ...h.options, stopping: () => stopping });
    const states = [first, second].map((n) => h.substrate.actors.get(n)?.state);
    expect(states.filter((s) => s === "suspended")).toHaveLength(1);
    expect(states.filter((s) => s === "running")).toHaveLength(1);
    expect(h.substrate.calls).not.toContain("listTemplates ");
  });

  it("a sweep that stops on its last sandbox retires no template", async () => {
    const h = harness();
    const only = known(h, "ses_a", "running", 6 * MIN);
    let stopping = false;
    const suspend = h.substrate.suspendActor.bind(h.substrate);
    h.substrate.suspendActor = async (name) => {
      stopping = true;
      return suspend(name);
    };
    await runSweepPass(h.state, { ...h.options, stopping: () => stopping });
    expect(h.substrate.actors.get(only)?.state).toBe("suspended");
    expect(h.substrate.calls).not.toContain("listTemplates ");
  });
});

describe("failures and races", () => {
  it("one sandbox that fails is skipped; the others are still swept", async () => {
    const h = harness();
    const bad = known(h, "ses_bad", "running", 6 * MIN);
    const good = known(h, "ses_good", "running", 6 * MIN);
    const suspend = h.substrate.suspendActor.bind(h.substrate);
    h.substrate.suspendActor = async (name) => {
      if (name === bad) throw new Error("worker gone");
      return suspend(name);
    };
    await h.pass();
    expect(h.substrate.actors.get(bad)?.state).toBe("running");
    expect(h.substrate.actors.get(good)?.state).toBe("suspended");
  });

  it("upkeep's failures are one warning per pass: a count and a capped sample", async () => {
    const warned: LogEntry[] = [];
    const h = harness(
      createLogger({
        level: "warn",
        pretty: false,
        write: () => {},
        sink: (entry) => warned.push(entry),
      }),
    );
    const stuckSince = new Date(h.t() - 90 * MIN);
    const stuck = (count: number) => {
      h.substrate.actors.clear();
      for (let i = 1; i <= count; i += 1) {
        h.substrate.put({
          name: sandboxBaseName("connect", `mcx_${i}`),
          state: "deleting",
          template: "t",
          updateTime: stuckSince,
        });
        h.substrate.fail(
          "deleteActor",
          new Error(i === 1 ? "x".repeat(400) : "Substrate unavailable"),
        );
      }
    };
    const message =
      "Substrate idle sweep could not keep up sandboxes; each is tried again next pass";

    stuck(2);
    await h.pass();
    expect(warned.map((entry) => entry.message)).toEqual([message]);
    expect(warned[0]?.fields).toEqual({
      count: 2,
      sample: [
        {
          actor: sandboxBaseName("connect", "mcx_1"),
          state: "deleting",
          since: stuckSince,
          error: "x".repeat(300),
        },
        {
          actor: sandboxBaseName("connect", "mcx_2"),
          state: "deleting",
          since: stuckSince,
          error: "Substrate unavailable",
        },
      ],
    });

    warned.length = 0;
    stuck(7);
    await h.pass();
    expect(warned).toHaveLength(1);
    expect(warned[0]?.fields?.["count"]).toBe(7);
    expect(warned[0]?.fields?.["sample"]).toHaveLength(5);

    // A pass whose upkeep failed on nothing says nothing.
    warned.length = 0;
    h.substrate.actors.clear();
    await h.pass();
    expect(warned).toEqual([]);
  });

  it("a sandbox gone between the pass's read and its queue is left alone", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 6 * MIN);
    h.sessions.onRead = (_id, read) => {
      if (read === 1) h.substrate.actors.delete(name);
    };
    await h.pass();
    expect(h.substrate.calls).not.toContain(`suspendActor ${name}`);
  });

  it("an orphan named by an ensure while it waited in the queue is not suspended", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_late");
    h.substrate.put({
      name,
      state: "running",
      template: "t",
      createTime: new Date(h.t() - 60 * MIN),
    });
    // An ensure holds the actor's queue when the pass reads it as an
    // orphan; it names the session before the orphan check, queued behind
    // it, runs.
    let release: () => void = () => {};
    const ensureQueued = h.driver.internals.serialize(name, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      h.driver.internals.sessionByActor.set(name, "ses_late");
    });
    const pass = h.pass();
    await new Promise((r) => setImmediate(r));
    release();
    await Promise.all([ensureQueued, pass]);
    expect(h.substrate.calls).not.toContain(`suspendActor ${name}`);
    expect(h.substrate.actors.get(name)?.state).toBe("running");
  });

  it("start logs a template it cannot prepare and a pass that fails, and never runs two passes at once", async () => {
    vi.useFakeTimers();
    try {
      const errors: string[] = [];
      const logger = createLogger({
        level: "error",
        pretty: false,
        write: () => {},
        sink: (entry) => errors.push(entry.message),
      });
      const h = harness(logger);
      h.substrate.fail("ensureAtespace", new Error("no Substrate"));
      let release: () => void = () => {};
      let lists = 0;
      h.substrate.listActors = async () => {
        lists += 1;
        if (lists === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        throw new Error("list failed");
      };
      const handle = startSubstrateSweep({ ...h.options, logger });
      await vi.advanceTimersByTimeAsync(
        settings.sweepIntervalSeconds * 1000 * 3,
      );
      expect(lists).toBe(1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      await handle.stop();
      expect(errors).toContain(
        "Substrate template preparation failed; the next sandbox ensure retries it",
      );
      expect(errors).toContain("Substrate idle sweep pass failed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a worker leaving", () => {
  function onWorker(h: ReturnType<typeof harness>, name: string, worker: string) {
    const actor = h.substrate.actors.get(name);
    if (actor === undefined) throw new Error(`no actor ${name}`);
    actor.worker = worker;
  }

  it("stores an idle session's sandbox at once, durably, inside its idle window", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "draining");
    const name = known(h, "ses_a", "running", 1 * MIN);
    onWorker(h, name, "w-1");
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
    expect(h.substrate.suspensions).toEqual([{ name, durable: true }]);
  });

  it("lets a busy session's turn run until the drain deadline, then stores it", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "draining");
    const name = known(h, "ses_a", "running", 0, true);
    onWorker(h, name, "w-1");
    await h.pass();
    h.advance(DRAIN_DEADLINE_MS - MIN);
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("running");
    h.advance(MIN);
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
    expect(h.substrate.suspensions).toEqual([{ name, durable: true }]);
  });

  it("an idle store that a turn races is thawed at once, as a suspend is", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "draining");
    const raced = known(h, "ses_raced", "running", 1 * MIN);
    onWorker(h, raced, "w-1");
    // Reads: the pass's decision, the re-decision in the queue, then the
    // check after the store, which sees the new turn.
    h.sessions.onRead = (id, read) => {
      if (id === "ses_raced" && read === 3)
        h.sessions.activities.set("ses_raced", {
          busy: true,
          lastActiveAt: new Date(h.t()),
        });
    };
    await h.pass();
    expect(h.substrate.calls.filter((c) => c.endsWith(raced))).toEqual([
      `getActor ${raced}`,
      `suspendActor ${raced}`,
      `resumeActor ${raced}`,
    ]);
    expect(h.substrate.suspensions).toEqual([{ name: raced, durable: true }]);
  });

  it("does not store a sandbox that left the draining worker before the act, even past the deadline", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "draining");
    const name = known(h, "ses_a", "running", 0, true);
    onWorker(h, name, "w-1");
    await h.pass();
    h.advance(DRAIN_DEADLINE_MS);
    // Between the pass's read and the act, the sandbox was stored and woken
    // by a new turn on a healthy worker.
    h.sessions.onRead = (id) => {
      if (id === "ses_a") onWorker(h, name, "w-2");
    };
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("running");
    expect(h.substrate.suspensions).toEqual([]);
  });

  it("leaves a sandbox on an active worker to the ladder, suspended asynchronously", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "draining");
    h.substrate.workers.set("w-2", "active");
    const fresh = known(h, "ses_fresh", "running", 1 * MIN);
    const idle = known(h, "ses_idle", "running", 6 * MIN);
    onWorker(h, fresh, "w-2");
    onWorker(h, idle, "w-2");
    await h.pass();
    expect(h.substrate.actors.get(fresh)?.state).toBe("running");
    expect(h.substrate.suspensions).toEqual([{ name: idle, durable: false }]);
  });

  it("stores an orphan on a draining worker", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "draining");
    const name = sandboxBaseName("session", "ses_gone");
    h.substrate.put({
      name,
      state: "running",
      template: "t",
      createTime: new Date(h.t() - 60 * MIN),
      worker: "w-1",
    });
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
    expect(h.substrate.suspensions).toEqual([{ name, durable: true }]);
  });

  it("a worker read that fails is one warning, and the ladder runs as before", async () => {
    const warned: LogEntry[] = [];
    const h = harness(
      createLogger({
        level: "warn",
        pretty: false,
        write: () => {},
        sink: (entry) => warned.push(entry),
      }),
    );
    h.substrate.fail("listWorkers", new Error("unavailable"));
    const idle = known(h, "ses_idle", "running", 6 * MIN);
    onWorker(h, idle, "w-1");
    await h.pass();
    expect(h.substrate.suspensions).toEqual([{ name: idle, durable: false }]);
    expect(warned.map((entry) => [entry.message, entry.fields?.error])).toEqual([
      [
        "Substrate idle sweep could not read which workers are leaving; this pass protects no sandbox from one",
        "unavailable",
      ],
    ]);
  });
});
