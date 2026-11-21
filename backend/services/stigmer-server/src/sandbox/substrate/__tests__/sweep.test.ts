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
 *     and the ladder runs as before;
 *   - a sandbox awake on an older template (started under another
 *     configuration) is suspended at the next pass whatever its idle
 *     window, logged with both templates, moved at the pass after and woken
 *     under the current policy; a busy one finishes its turn first; one a
 *     turn moved to the current template before the act is left alone
 *     (stigmer#2984);
 *   - a routine's fire is suspended as soon as its run is not working,
 *     inside its idle window, and logged apart; its working run is left
 *     alone;
 *   - the sweep reports whether a new session can start (the template's
 *     golden snapshot is published), as it changes, and prepares the
 *     template again on each pass until it is;
 *   - making room for a waiting run puts one sandbox to sleep per ask from
 *     the last pass's listing: the longest idle, never the waiting
 *     session's own, a busy one, one it cannot map or one on a leaving
 *     worker, plain idle before parked; one that moved worker, slept or
 *     became busy since the listing, or whose worker began leaving since
 *     (read again inside the queue; a read that fails refuses), is skipped
 *     for the next, one a turn
 *     reached mid-suspend is thawed and the next put to sleep; a listing
 *     that offers nothing (none yet, or every awake sandbox newer than it)
 *     is read again from Substrate once per ask, and a fresh read that
 *     cannot see which workers are leaving makes no room; false with
 *     nothing idle, and once the sweep stops.
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
  makeRoom,
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
  artifactLane: false,
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
  cpuMillicores: 2000,
  memoryMib: 2048,
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
      this.activities.get(sessionId) ?? { parked: false, routineFire: false, busy: false, lastActiveAt: undefined }
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
    /** The template this server's sandboxes are created on. */
    current: driver.lifecycle.currentTemplate(),
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
  template = h.current,
) {
  const name = sandboxBaseName("session", sessionId);
  h.substrate.put({
    name,
    state,
    template,
    createTime: new Date(h.t() - idleMs),
  });
  h.driver.internals.sessionByActor.set(name, sessionId);
  h.sessions.ids.push(sessionId);
  h.sessions.activities.set(sessionId, {
    parked: false,
    routineFire: false,
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
      template: h.current,
      createTime: new Date(h.t() - 600 * MIN),
    });
    h.substrate.put({
      name: mcp,
      state: "suspended",
      template: h.current,
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
          parked: false,
          routineFire: false,
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
          parked: false,
          routineFire: false,
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
      parked: false,
      routineFire: false,
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
      template: h.current,
      createTime: new Date(h.t() - 60 * MIN),
    });
    h.sessions.ids.push("ses_old");
    h.sessions.activities.set("ses_old", {
      parked: false,
      routineFire: false,
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
      template: h.current,
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
      template: h.current,
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
      template: h.current,
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
      template: h.current,
      createTime: new Date(h.t()),
    });
    h.sessions.ids.push("ses_elsewhere");
    h.sessions.activities.set("ses_elsewhere", {
      parked: false,
      routineFire: false,
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
      template: h.current,
      policy: [],
    });
    const asleep = sandboxBaseName("session", "ses_s");
    h.substrate.put({
      name: asleep,
      state: "suspended",
      template: h.current,
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
    h.substrate.put({ name, state: "deleting", template: h.current });
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
          template: h.current,
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
      template: h.current,
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

  it("start reports whether sessions can start, and prepares again on the next pass after a failure", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const keeper = h.driver.internals.keeper;
      h.substrate.fail("ensureAtespace", new Error("no Substrate yet"));
      const reported: boolean[] = [];
      const handle = startSubstrateSweep({
        ...h.options,
        reportReady: (ready) => reported.push(ready),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(reported).toEqual([false]);
      expect(keeper.readyNow()).toBe(false);

      await vi.advanceTimersByTimeAsync(settings.sweepIntervalSeconds * 1000);
      expect(keeper.readyNow()).toBe(true);
      expect(reported).toEqual([false, true]);

      // Another server retired the template: not ready again until re-prepared.
      keeper.invalidate();
      expect(reported).toEqual([false, true, false]);
      await handle.stop();
      await keeper.ready();
      expect(reported).toEqual([false, true, false]);
    } finally {
      vi.useRealTimers();
    }
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
        "Substrate template preparation failed; the next sweep pass or sandbox ensure retries it",
      );
      expect(errors).toContain("Substrate idle sweep pass failed");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a sandbox started under an older configuration (stigmer#2984)", () => {
  const OLD = "stigmer-runner-aaaaaaaaaaaa";

  async function older(h: ReturnType<typeof harness>) {
    await h.driver.internals.keeper.ready();
    h.substrate.putTemplate(OLD, { createTime: new Date(h.t() - 60 * MIN) });
  }

  it("is suspended at the next pass inside its idle window, moved at the one after, and woken under the current policy", async () => {
    const logged: LogEntry[] = [];
    const h = harness(
      createLogger({
        level: "info",
        pretty: false,
        write: () => {},
        sink: (entry) => logged.push(entry),
      }),
    );
    await older(h);
    const name = known(h, "ses_a", "running", 1 * MIN, false, OLD);

    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
    expect(h.substrate.suspensions).toEqual([{ name, durable: false }]);
    const line = logged.find((entry) =>
      entry.message.startsWith(
        "Substrate sandbox suspended: it ran under an older configuration",
      ),
    );
    expect(line?.fields).toMatchObject({
      actor: name,
      sessionId: "ses_a",
      template: OLD,
      current: h.current,
    });

    await h.pass();
    expect(h.substrate.actors.get(name)?.template).toBe(h.current);

    h.substrate.calls.length = 0;
    await h.driver.provisioner.ensureSessionSandbox("ses_a", {
      taskQueue: "session:ses_a",
      stigmerToken: "",
      callerClass: "user",
      executionId: "aex_test",
    });
    expect(h.substrate.actors.get(name)?.state).toBe("running");
    expect(h.substrate.calls).toContain(`ensureEgressPolicy ${name}`);
  });

  it("finishes a turn in flight first, and is suspended at the pass after it ends", async () => {
    const h = harness();
    await older(h);
    const name = known(h, "ses_a", "running", 0, true, OLD);
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("running");
    expect(h.substrate.calls).not.toContain(`suspendActor ${name}`);

    h.sessions.activities.set("ses_a", {
      parked: false,
      routineFire: false,
      busy: false,
      lastActiveAt: new Date(h.t()),
    });
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("suspended");
  });

  it("is left alone when a turn moved it to the current template before the act", async () => {
    const h = harness();
    await older(h);
    const name = known(h, "ses_a", "running", 1 * MIN, false, OLD);
    // The pass decides from its listing (read 1); a turn moves the sandbox
    // before the act's fresh read in the queue.
    h.sessions.onRead = (_id, read) => {
      const actor = h.substrate.actors.get(name);
      if (read === 1 && actor !== undefined) actor.template = h.current;
    };
    await h.pass();
    expect(h.substrate.calls).not.toContain(`suspendActor ${name}`);
    expect(h.substrate.actors.get(name)?.state).toBe("running");
  });

  it("leaves one on the current template to its idle window", async () => {
    const h = harness();
    const name = known(h, "ses_a", "running", 1 * MIN);
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe("running");
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
          parked: false,
          routineFire: false,
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
      template: h.current,
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

describe("a routine's fire", () => {
  it("is suspended as soon as its run is not working, inside its idle window, and logged apart", async () => {
    const infos: LogEntry[] = [];
    const h = harness(
      createLogger({
        level: "info",
        pretty: false,
        write: () => {},
        sink: (entry) => infos.push(entry),
      }),
    );
    const fired = known(h, "ses_fired", "running", 0);
    const working = known(h, "ses_working_fire", "running", 0, true);
    const person = known(h, "ses_person", "running", 0);
    for (const id of ["ses_fired", "ses_working_fire"]) {
      const activity = h.sessions.activities.get(id);
      if (activity !== undefined) h.sessions.activities.set(id, { ...activity, routineFire: true });
    }
    await h.pass();
    expect(h.substrate.actors.get(fired)?.state).toBe("suspended");
    expect(h.substrate.actors.get(working)?.state).toBe("running");
    expect(h.substrate.actors.get(person)?.state).toBe("running");
    expect(infos.map((entry) => entry.message)).toContain(
      "Substrate sandbox suspended: its routine's run ended, so it holds no seat for the idle window",
    );
  });
});

describe("making room for a waiting run", () => {
  function onWorker(h: ReturnType<typeof harness>, name: string, worker: string) {
    const actor = h.substrate.actors.get(name);
    if (actor === undefined) throw new Error(`no actor ${name}`);
    actor.worker = worker;
  }

  function parked(h: ReturnType<typeof harness>, sessionId: string) {
    const activity = h.sessions.activities.get(sessionId);
    if (activity !== undefined) h.sessions.activities.set(sessionId, { ...activity, parked: true });
  }

  /** Three sandboxes inside their idle window, listed by a pass that sleeps none. */
  async function full(h: ReturnType<typeof harness>) {
    const names = {
      a: known(h, "ses_a", "running", 1 * MIN),
      b: known(h, "ses_b", "running", 4 * MIN),
      c: known(h, "ses_c", "running", 2 * MIN),
    };
    for (const name of Object.values(names)) onWorker(h, name, "w-1");
    await h.pass();
    expect(h.substrate.suspensions).toEqual([]);
    return names;
  }

  it("puts the longest-idle sandbox to sleep, one per ask, logging it with the waiting session", async () => {
    const infos: LogEntry[] = [];
    const h = harness(
      createLogger({
        level: "info",
        pretty: false,
        write: () => {},
        sink: (entry) => infos.push(entry),
      }),
    );
    const { a, b, c } = await full(h);
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions).toEqual([{ name: b, durable: false }]);
    expect(h.substrate.actors.get(a)?.state).toBe("running");
    expect(h.substrate.actors.get(c)?.state).toBe("running");
    const line = infos.find((entry) => entry.message.startsWith("Put the longest-idle sandbox to sleep"));
    expect(line?.fields).toEqual({
      actor: b,
      sessionId: "ses_b",
      idleSeconds: 240,
      parked: false,
      forSessionId: "ses_waiting",
    });
  });

  it("never the waiting session's own sandbox, a busy one, one it cannot map, or one on a leaving worker", async () => {
    const h = harness();
    const own = known(h, "ses_waiting", "running", 50 * MIN);
    const busy = known(h, "ses_busy", "running", 40 * MIN, true);
    const unmapped = known(h, "ses_unmapped", "running", 3 * MIN);
    const leaving = known(h, "ses_leaving", "running", 4 * MIN);
    const idle = known(h, "ses_idle", "running", 1 * MIN);
    // Inside the window for the pass: only the busy and own ones are older,
    // and the own one is a pending run (busy) as a waiting run's is.
    const ownActivity = h.sessions.activities.get("ses_waiting");
    if (ownActivity !== undefined) h.sessions.activities.set("ses_waiting", { ...ownActivity, busy: true });
    await h.pass();
    if (ownActivity !== undefined) h.sessions.activities.set("ses_waiting", ownActivity);
    h.driver.internals.sessionByActor.delete(unmapped);
    const listing = h.state.listing;
    if (listing === undefined) throw new Error("no listing");
    h.state.listing = {
      awake: listing.awake,
      draining: new Map([[leaving, { worker: undefined, since: new Date(h.t()) }]]),
    };
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions).toEqual([{ name: idle, durable: false }]);
    for (const name of [own, busy, unmapped, leaving]) {
      expect(h.substrate.actors.get(name)?.state).toBe("running");
    }
  });

  it("puts a plain idle sandbox to sleep before one parked on a person's answer, and the parked one when nothing else can", async () => {
    const h = harness();
    const waitingOnPerson = known(h, "ses_parked", "running", 4 * MIN);
    const idle = known(h, "ses_idle", "running", 1 * MIN);
    parked(h, "ses_parked");
    await h.pass();
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions).toEqual([{ name: idle, durable: false }]);
    await h.pass();
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions.map((s) => s.name)).toEqual([idle, waitingOnPerson]);
  });

  it("skips one that moved worker or went to sleep since the listing, and tries the next", async () => {
    const h = harness();
    const { a, b, c } = await full(h);
    onWorker(h, b, "w-2");
    const asleep = h.substrate.actors.get(c);
    if (asleep !== undefined) asleep.state = "suspended";
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions).toEqual([{ name: a, durable: false }]);
  });

  it("skips one whose worker began leaving since the listing, read fresh inside the queue", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "active");
    h.substrate.workers.set("w-2", "active");
    const { a, b, c } = await full(h);
    onWorker(h, b, "w-2");
    await h.pass();
    h.substrate.workers.set("w-2", "draining");
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions).toEqual([{ name: c, durable: false }]);
    expect(h.substrate.actors.get(b)?.state).toBe("running");
    expect(h.substrate.actors.get(a)?.state).toBe("running");
  });

  it("makes no room when the guard cannot read which workers are leaving", async () => {
    const h = harness();
    await full(h);
    // Every read fails: the guard's for each of the three, then the fresh listing's.
    for (let i = 0; i < 4; i += 1) h.substrate.fail("listWorkers", new Error("unavailable"));
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(false);
    expect(h.substrate.suspensions).toEqual([]);
  });

  it("skips one whose session became busy since the listing, read fresh inside the queue", async () => {
    const h = harness();
    const { a, b } = await full(h);
    h.sessions.onRead = (id) => {
      const activity = h.sessions.activities.get(id);
      if (id === "ses_b" && activity !== undefined && h.sessions.kinds.at(-1) === "full") {
        h.sessions.activities.set(id, { ...activity, busy: true });
      }
    };
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.calls).not.toContain(`suspendActor ${b}`);
    expect(h.substrate.suspensions.map((s) => s.name)).toEqual([sandboxBaseName("session", "ses_c")]);
    expect(h.substrate.actors.get(a)?.state).toBe("running");
  });

  it("thaws one a turn reached while it suspended, and puts the next to sleep", async () => {
    const h = harness();
    const { b, c } = await full(h);
    let fullReadsOfB = 0;
    h.sessions.onRead = (id) => {
      if (id !== "ses_b" || h.sessions.kinds.at(-1) !== "full") return;
      fullReadsOfB += 1;
      // The guard's read, then the check after the suspend, which sees the turn.
      const activity = h.sessions.activities.get(id);
      if (fullReadsOfB === 2 && activity !== undefined) h.sessions.activities.set(id, { ...activity, busy: true });
    };
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.calls.filter((call) => call.endsWith(b))).toEqual([
      `getActor ${b}`,
      `suspendActor ${b}`,
      `resumeActor ${b}`,
    ]);
    expect(h.substrate.actors.get(b)?.state).toBe("running");
    expect(h.substrate.actors.get(c)?.state).toBe("suspended");
  });

  it("before the first pass, lists Substrate itself and makes room, never on a leaving worker", async () => {
    const h = harness();
    h.substrate.workers.set("w-1", "draining");
    h.substrate.workers.set("w-2", "active");
    const leaving = known(h, "ses_leaving", "running", 4 * MIN);
    const idle = known(h, "ses_a", "running", 1 * MIN);
    onWorker(h, leaving, "w-1");
    onWorker(h, idle, "w-2");
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions).toEqual([{ name: idle, durable: false }]);
    expect(h.substrate.actors.get(leaving)?.state).toBe("running");
  });

  it("when every awake sandbox started since the last listing, lists once more and makes room", async () => {
    const h = harness();
    await h.pass();
    expect(h.state.listing?.awake).toEqual([]);
    const idle = known(h, "ses_new", "running", 0);
    const listed = h.substrate.calls.filter((call) => call.startsWith("listActors")).length;
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.suspensions).toEqual([{ name: idle, durable: false }]);
    expect(h.substrate.calls.filter((call) => call.startsWith("listActors")).length - listed).toBe(1);
  });

  it("answers false when nothing awake is idle, and lists only once more per ask", async () => {
    const h = harness();
    const busy = known(h, "ses_b", "running", 1 * MIN, true);
    await h.pass();
    const listed = h.substrate.calls.filter((call) => call.startsWith("listActors")).length;
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(false);
    expect(h.substrate.calls.filter((call) => call.startsWith("listActors")).length - listed).toBe(1);
    expect(h.substrate.suspensions).toEqual([]);
    expect(h.substrate.actors.get(busy)?.state).toBe("running");
  });

  it("makes no room when its fresh listing cannot read which workers are leaving", async () => {
    const warned: LogEntry[] = [];
    const h = harness(
      createLogger({ level: "warn", pretty: false, write: () => {}, sink: (entry) => warned.push(entry) }),
    );
    known(h, "ses_a", "running", 1 * MIN);
    h.substrate.fail("listWorkers", new Error("unavailable"));
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(false);
    expect(h.substrate.suspensions).toEqual([]);
    expect(warned.map((entry) => entry.message)).toEqual([
      "Could not read which workers are leaving; made no room for a waiting run",
    ]);
  });

  it("skips a sandbox whose session cannot be read, with a warning, and takes the next", async () => {
    const warned: LogEntry[] = [];
    const h = harness(
      createLogger({ level: "warn", pretty: false, write: () => {}, sink: (entry) => warned.push(entry) }),
    );
    const { a, b } = await full(h);
    const read = h.sessions.recentActivity.bind(h.sessions);
    h.sessions.recentActivity = async (id) => {
      if (id === "ses_b") throw new Error("store unavailable");
      return read(id);
    };
    expect(await makeRoom(h.state, h.options, "ses_waiting")).toBe(true);
    expect(h.substrate.actors.get(b)?.state).toBe("running");
    expect(h.substrate.suspensions.map((s) => s.name)).toEqual([sandboxBaseName("session", "ses_c")]);
    expect(h.substrate.actors.get(a)?.state).toBe("running");
    expect(warned.map((entry) => [entry.message, entry.fields?.error])).toEqual([
      ["Making room for a waiting run skipped a sandbox", "store unavailable"],
    ]);
  });

  it("puts nothing to sleep once the sweep is stopping", async () => {
    const h = harness();
    await full(h);
    expect(await makeRoom(h.state, { ...h.options, stopping: () => true }, "ses_waiting")).toBe(false);
    expect(h.substrate.suspensions).toEqual([]);
  });

  it("is the started sweep's, and answers false once it stops", async () => {
    const h = harness();
    known(h, "ses_a", "running", 1 * MIN);
    const sweep = startSubstrateSweep(h.options);
    await vi.waitFor(() => expect(h.sessions.kinds.length).toBeGreaterThan(0));
    await vi.waitFor(async () => expect(await sweep.makeRoom("ses_waiting")).toBe(true));
    await sweep.stop();
    known(h, "ses_b", "running", 1 * MIN);
    expect(await sweep.makeRoom("ses_waiting")).toBe(false);
  });
});
