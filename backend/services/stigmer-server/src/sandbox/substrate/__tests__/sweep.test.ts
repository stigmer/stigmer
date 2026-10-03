/**
 * Pins the open-source idle sweep (sweep.ts) over a fake Substrate and a
 * fake session reader, with no real time:
 *
 *   - an idle running session sandbox is paused, an idle paused one
 *     suspended, a busy one left running; workflow and connect sandboxes
 *     are never touched;
 *   - a turn that arrives while the pause is in flight resumes the
 *     sandbox at once;
 *   - each action is re-decided from fresh reads inside the actor's queue;
 *   - a sandbox this process never ensured is named by a scan of every
 *     session; one no later scan names is an orphan, suspended and never
 *     deleted; one created since the last scan is left alone, and scans
 *     are rate-limited;
 *   - a sandbox left DELETING is deleted again; a suspended one on an older
 *     template is moved; unused templates are retired;
 *   - start runs a pass at once and stop waits for it.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { sandboxBaseName } from "../../naming.js";
import type {
  SandboxDriverConfig,
  SessionActivity,
  SessionActivityReader,
} from "../../provisioner.js";
import { FakeSubstrate, fakeRouter } from "../__test-utils__/fake-gateway.js";
import type { SubstrateDriverSettings } from "../config.js";
import { newSubstrateSandboxDriverOverGateway } from "../driver.js";
import { ActorState } from "../gen/ateapipb/ateapi_pb.js";
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
  temporalAddress: "temporal.stigmer.svc:7233",
  temporalNamespace: "default",
  temporalConnectionEnv: {},
  runnerImage: `r@sha256:${"a".repeat(64)}`,
  runnerCommand: "",
  kubernetesNamespace: "",
  runnerEnv: {},
  runnerSecretEnv: {},
};

const settings: SubstrateDriverSettings = {
  apiEndpoint: "https://api.ate-system.svc:443",
  apiServerName: "",
  apiCaFile: "",
  apiTokenFile: "/unused",
  routerUrl: "http://router.example:18200",
  atespace: "stigmer",
  storageLocation: "gs://b/p",
  workerSelector: { workload: "stigmer" },
  sandboxConfigName: "gvisor-default",
  httpsEgress: "none",
  extraHttpEgress: [],
  pauseAfterSeconds: 300,
  suspendAfterSeconds: 1800,
  sweepIntervalSeconds: 60,
};

const MIN = 60_000;

class FakeSessions implements SessionActivityReader {
  readonly activities = new Map<string, SessionActivity>();
  readonly ids: string[] = [];
  scans = 0;
  /** Called on every activity read; may change what later reads return. */
  onRead: (sessionId: string, read: number) => void = () => {};
  private reads = 0;

  async activity(sessionId: string): Promise<SessionActivity> {
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

function harness() {
  let t = Date.parse("2026-10-03T12:00:00Z");
  const now = () => t;
  const substrate = new FakeSubstrate(now);
  const sessions = new FakeSessions();
  const driver = newSubstrateSandboxDriverOverGateway({
    config,
    settings,
    logger: silentLogger,
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
    logger: silentLogger,
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
  state: ActorState,
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
  it("pauses an idle running sandbox, suspends an idle paused one, leaves a busy one", async () => {
    const h = harness();
    const idle = known(h, "ses_idle", ActorState.RUNNING, 6 * MIN);
    const asleep = known(h, "ses_asleep", ActorState.PAUSED, 31 * MIN);
    const busy = known(h, "ses_busy", ActorState.RUNNING, 120 * MIN, true);
    const fresh = known(h, "ses_fresh", ActorState.RUNNING, 1 * MIN);
    await h.pass();
    expect(h.substrate.actors.get(idle)?.state).toBe(ActorState.PAUSED);
    expect(h.substrate.actors.get(asleep)?.state).toBe(ActorState.SUSPENDED);
    expect(h.substrate.actors.get(busy)?.state).toBe(ActorState.RUNNING);
    expect(h.substrate.actors.get(fresh)?.state).toBe(ActorState.RUNNING);
  });

  it("never touches workflow or connect sandboxes", async () => {
    const h = harness();
    const wfx = sandboxBaseName("workflow", "wex_1");
    const mcp = sandboxBaseName("connect", "mcx_1");
    h.substrate.put({
      name: wfx,
      state: ActorState.RUNNING,
      template: "t",
      createTime: new Date(h.t() - 600 * MIN),
    });
    h.substrate.put({
      name: mcp,
      state: ActorState.PAUSED,
      template: "t",
      createTime: new Date(h.t() - 600 * MIN),
    });
    await h.pass();
    expect(h.substrate.actors.get(wfx)?.state).toBe(ActorState.RUNNING);
    expect(h.substrate.actors.get(mcp)?.state).toBe(ActorState.PAUSED);
    expect(
      h.substrate.calls.filter(
        (c) => c.startsWith("pauseActor") || c.startsWith("suspendActor"),
      ),
    ).toEqual([]);
  });

  it("resumes at once when a turn arrived while the pause was in flight", async () => {
    const h = harness();
    const name = known(h, "ses_a", ActorState.RUNNING, 6 * MIN);
    // Reads: the pass's decision, the re-decision in the queue, then the
    // check after the pause, which sees the new turn.
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
      `pauseActor ${name}`,
      `resumeActor ${name}`,
    ]);
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.RUNNING);
  });

  it("acts only on a fresh re-decision: a turn that began before the queue is left alone", async () => {
    const h = harness();
    const name = known(h, "ses_a", ActorState.RUNNING, 6 * MIN);
    h.sessions.onRead = (_id, read) => {
      if (read === 2)
        h.sessions.activities.set("ses_a", {
          busy: true,
          lastActiveAt: new Date(h.t()),
        });
    };
    await h.pass();
    expect(h.substrate.calls).not.toContain(`pauseActor ${name}`);
  });

  it("an ensure in this process restarts the idle clock", async () => {
    const h = harness();
    const name = known(h, "ses_a", ActorState.RUNNING, 6 * MIN);
    await h.driver.provisioner.ensureSessionSandbox("ses_a", {
      taskQueue: "session:ses_a",
      stigmerToken: "",
      callerClass: "user",
    });
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.RUNNING);
  });
});

describe("sandboxes this process never ensured", () => {
  it("are named by a scan of every session, then follow the ladder", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_old");
    h.substrate.put({
      name,
      state: ActorState.RUNNING,
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
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.PAUSED);
  });

  it("an orphan is suspended and kept, never deleted", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_gone");
    h.substrate.put({
      name,
      state: ActorState.RUNNING,
      template: "t",
      createTime: new Date(h.t() - 60 * MIN),
    });
    await h.pass();
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.SUSPENDED);
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
      state: ActorState.RUNNING,
      template: "t",
      createTime: new Date(h.t()),
    });
    await h.pass();
    expect(h.sessions.scans).toBe(1);
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.RUNNING);
    h.advance(MIN);
    await h.pass();
    expect(h.sessions.scans).toBe(1);
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.RUNNING);
    // The next scan, begun after it was created, does not name it: an orphan.
    h.advance(SCAN_INTERVAL_MS);
    await h.pass();
    expect(h.sessions.scans).toBe(2);
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.SUSPENDED);
  });

  it("a session created through another replica is named by the next scan and kept running while busy", async () => {
    const h = harness();
    const name = sandboxBaseName("session", "ses_elsewhere");
    h.substrate.put({
      name,
      state: ActorState.RUNNING,
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
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.RUNNING);
  });
});

describe("housekeeping", () => {
  it("deletes a sandbox left DELETING again", async () => {
    const h = harness();
    const name = sandboxBaseName("workflow", "wex_1");
    h.substrate.put({ name, state: ActorState.DELETING, template: "t" });
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
      state: ActorState.SUSPENDED,
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

  it("start runs a pass at once and prepares the template; stop waits for the pass", async () => {
    const h = harness();
    const name = known(h, "ses_a", ActorState.RUNNING, 6 * MIN);
    const handle = startSubstrateSweep(h.options);
    await handle.stop();
    expect(h.substrate.actors.get(name)?.state).toBe(ActorState.PAUSED);
    expect(h.substrate.calls.some((c) => c.startsWith("createTemplate"))).toBe(
      true,
    );
  });
});
