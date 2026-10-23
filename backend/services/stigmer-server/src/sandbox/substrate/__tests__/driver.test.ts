/**
 * Pins the substrate driver's ensure state machine and lifecycle over a
 * fake Substrate (driver.ts), with no cluster and no real time:
 *
 *   - absent → the template prepared and awaited, the actor created, its
 *     egress policy written, resumed, attached by one push carrying the
 *     queue and exactly the secrets (never a plain setting);
 *   - the ensure's log line names the path it took from the first settled
 *     state it found (created, suspended, paused, running, crashed), never
 *     the arm it ended in, so a created sandbox is not counted as a wake
 *     from storage; a state in transition names nothing;
 *   - suspended → moved to the current template only when that template is
 *     ready, its policy repaired when missing, resumed, pushed;
 *   - paused → resumed on its own template, however long it slept and
 *     whenever it paused, never suspended first: every wake is a fresh
 *     runner (Substrate 0.5 keeps no memory, template.ts);
 *   - running → pushed only; crashed → reverted first; deleting → refused,
 *     and so is a state the driver has no word for;
 *   - ABORTED → re-read, whether contention or a crash; no free worker →
 *     thrown at once;
 *   - a running runner refusing rotated secrets keeps running;
 *   - a runner this process started that refuses a push as already
 *     attached elsewhere is suspended, and the ensure fails: at a wake from
 *     storage or from a pause, and at a later ensure when the waking one
 *     was cut short;
 *   - a waiter refusal throws with its code; a mismatched queue throws
 *     before any call;
 *   - one actor's operations never interleave;
 *   - deprovision, probe, reattach (a running sandbox only), and template
 *     retirement;
 *   - the lifecycle a composition's own sweep calls: a guarded pause asks
 *     before the call from a fresh read and wakes the sandbox again when
 *     the sweep says it is no longer idle afterwards (a fresh runner, which
 *     the turn's own ensure pushes to), a guarded suspend asks before; `maintain`
 *     repeats a stuck delete, writes no egress policy (an awake sandbox's
 *     is its next ensure's), moves only a sleeping sandbox
 *     off an older template, then retires, skipping a sandbox whose upkeep fails and stopping before
 *     retirement when asked; `deleteByName` deletes only a name this driver
 *     gives (a leftover workflow-scope `sbx-wfx-` sandbox is refused before
 *     any gateway call, left for an operator), and with a guard asks it inside the actor's queue from a
 *     fresh read, so a sandbox a turn woke while the delete waited is
 *     skipped, never deleted; `prepare` readies the template and never
 *     rejects;
 *   - a session's Environment: the driver can limit networking only while
 *     HTTPS egress is `all` and installs packages either way; an ensure
 *     with a limited Environment writes a policy without the HTTPS
 *     wildcard and with its hosts; a running sandbox's next ensure with the
 *     same facts writes no policy, and one with a changed host list
 *     replaces it at that ensure; a wake from storage always reconciles;
 *     the attach push carries the runner's half (network and packages,
 *     never the hosts), and a push without an Environment carries none.
 */
import { describe, expect, it } from "vitest";

import { createLogger, type LogEntry } from "../../../boot/logger.js";
import { sandboxBaseName } from "../../naming.js";
import { runnerEnvironmentOf } from "../../environment.js";
import type {
  EnvironmentFacts,
  SandboxDriverConfig,
  SandboxFacts,
} from "../../provisioner.js";
import { FakeSubstrate, fakeRouter } from "../__test-utils__/fake-gateway.js";
import type { SubstrateDriverSettings } from "../config.js";
import {
  newSubstrateSandboxDriverOverGateway,
  validateSubstrateDriverConfig,
} from "../driver.js";
import type { EgressRule } from "../gen/ateapipb/ateapi_pb.js";
import {
  SubstrateAbortedError,
  SubstrateNoWorkerError,
  type SubstrateSandboxState,
} from "../gateway.js";
import { MAX_IN_PLACE_PAUSE_SECONDS } from "../limits.js";

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
  runnerImage: `localhost:5001/runner@sha256:${"a".repeat(64)}`,
  runnerCommand: "unused",
  kubernetesNamespace: "unused",
  runnerEnv: { ANTHROPIC_BASE_URL: "http://fake-model.example:18555" },
  runnerSecretEnv: { ANTHROPIC_API_KEY: "sk-test" },
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
  storageLocation: "gs://ate-snapshots/stigmer",
  workerSelector: { workload: "stigmer" },
  sandboxConfigName: "gvisor-default",
  httpsEgress: "all",
  extraHttpEgress: [],
  platformHttpsHosts: [],
  pauseAfterSeconds: 300,
  suspendAfterSeconds: 1800,
  sweepIntervalSeconds: 60,
};

const SESSION = "ses_01abc";
const ACTOR = sandboxBaseName("session", SESSION);
const facts: SandboxFacts = {
  taskQueue: `session:${SESSION}`,
  stigmerToken: "tok-1",
  callerClass: "user",
};

function harness(
  answer?: Parameters<typeof fakeRouter>[0],
  runnerMode?: "local" | "cloud",
  logger = silentLogger,
) {
  let t = Date.parse("2026-10-03T12:00:00Z");
  const now = () => t;
  const sleep = async (ms: number) => {
    t += ms;
  };
  const substrate = new FakeSubstrate(now);
  const router = fakeRouter(answer);
  const driver = newSubstrateSandboxDriverOverGateway({
    config,
    settings,
    logger,
    gateway: substrate,
    ...(runnerMode === undefined ? {} : { runnerMode }),
    fetch: router.fetch,
    now,
    sleep,
  });
  return {
    substrate,
    router,
    driver,
    advance: (ms: number) => {
      t += ms;
    },
    now,
  };
}

describe("ensure, from each state", () => {
  it("absent: prepares the template, creates the actor, writes its policy, resumes it and pushes once", async () => {
    const h = harness();
    h.substrate.goldenPolls = 2;
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);

    const template = h.driver.internals.keeper.name;
    expect(template).toMatch(/^stigmer-runner-[0-9a-f]{12}$/);
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      "ensureAtespace ",
      `getTemplate ${template}`,
      `createTemplate ${template}`,
      `getTemplate ${template}`,
      `getTemplate ${template}`,
      `createActor ${ACTOR}`,
      `getActor ${ACTOR}`,
      `ensureEgressPolicy ${ACTOR}`,
      `resumeActor ${ACTOR}`,
    ]);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
    expect(h.substrate.actors.get(ACTOR)?.policy?.length).toBeGreaterThan(0);
    expect(h.router.pushes).toEqual([
      {
        actor: ACTOR,
        taskQueue: `session:${SESSION}`,
        secrets: {
          ANTHROPIC_API_KEY: "sk-test",
          STIGMER_TOKEN: "tok-1",
        },
      },
    ]);
  });

  it("pushes no token when none was minted", async () => {
    const h = harness();
    await h.driver.provisioner.ensureSessionSandbox(SESSION, {
      ...facts,
      stigmerToken: "",
    });
    expect(h.router.pushes[0]?.secrets).not.toHaveProperty("STIGMER_TOKEN");
  });

  it("RUNNING: pushes only, so the waiter keeps its runner and takes the fresh token", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "running",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    // Its egress policy is reconciled once in this process, then only pushes.
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      `ensureEgressPolicy ${ACTOR}`,
    ]);
    expect(h.router.pushes).toHaveLength(1);
  });

  it("SUSPENDED on an older template: wakes on it at once while the current template is not ready", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.calls).not.toContain(`moveActor ${ACTOR}`);
    expect(h.substrate.calls.some((c) => c.startsWith("createTemplate"))).toBe(
      false,
    );
    expect(h.substrate.actors.get(ACTOR)?.template).toBe("stigmer-runner-old");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
  });

  it("SUSPENDED on an older template: moves to the current one once it is ready", async () => {
    const h = harness();
    await h.driver.internals.keeper.ready();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.actors.get(ACTOR)?.template).toBe(
      h.driver.internals.keeper.name,
    );
    const calls = h.substrate.calls;
    expect(calls.indexOf(`moveActor ${ACTOR}`)).toBeLessThan(
      calls.indexOf(`resumeActor ${ACTOR}`),
    );
  });

  it("SUSPENDED: keeps its own template when Substrate refuses the move", async () => {
    const h = harness();
    await h.driver.internals.keeper.ready();
    h.substrate.refuseMoves = true;
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.actors.get(ACTOR)?.template).toBe("stigmer-runner-old");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
  });

  it("SUSPENDED without a policy (its creator died before writing it): the policy is written before the wake", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
      policy: undefined,
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.actors.get(ACTOR)?.policy?.length).toBeGreaterThan(0);
    const calls = h.substrate.calls;
    expect(calls.indexOf(`ensureEgressPolicy ${ACTOR}`)).toBeLessThan(
      calls.indexOf(`resumeActor ${ACTOR}`),
    );
  });

  it("paused: wakes on its own template and node, never suspended first, however long and whenever it paused", async () => {
    for (const asleep of [1_000, MAX_IN_PLACE_PAUSE_SECONDS * 1000 + 1]) {
      const h = harness();
      // The current template is ready, so a suspended actor would move.
      await h.driver.lifecycle.prepare();
      // Paused before this server process started.
      h.substrate.put({
        name: ACTOR,
        state: "paused",
        template: "stigmer-runner-old",
        updateTime: new Date(h.now() - 1_000),
      });
      h.advance(asleep);
      h.substrate.calls.length = 0;
      await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
      expect(h.substrate.calls).toEqual([
        `getActor ${ACTOR}`,
        `ensureEgressPolicy ${ACTOR}`,
        `resumeActor ${ACTOR}`,
      ]);
      expect(h.substrate.actors.get(ACTOR)?.template).toBe(
        "stigmer-runner-old",
      );
      expect(h.router.pushes).toHaveLength(1);
    }
  });

  it("CRASHED: reverts, then wakes from where that leaves it", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "crashed",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.calls.slice(0, 3)).toEqual([
      `getActor ${ACTOR}`,
      `revertActor ${ACTOR}`,
      `getActor ${ACTOR}`,
    ]);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
  });

  it("in transition: waits for it to settle", async () => {
    const h = harness();
    const actor = h.substrate.put({
      name: ACTOR,
      state: "suspending",
      template: "stigmer-runner-old",
    });
    let polls = 0;
    const getActor = h.substrate.getActor.bind(h.substrate);
    h.substrate.getActor = async (name) => {
      polls += 1;
      if (polls === 3) actor.state = "suspended";
      return getActor(name);
    };
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
  });

  it("in transition for longer than the settle wait: fails, naming the state", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspending",
      template: "stigmer-runner-old",
    });
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/stayed suspending for 60 s/);
  });

  it("DELETING: refuses", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "deleting",
      template: "stigmer-runner-old",
    });
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/being deleted/);
  });

  it("a state the driver has no word for: refuses, naming it", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "hibernating" as SubstrateSandboxState,
      template: "t",
    });
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/is in an unknown state hibernating/);
  });
});

describe("failures", () => {
  it("ABORTED from contention: re-reads and carries on", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    h.substrate.fail(
      "resumeActor",
      new SubstrateAbortedError("another operation is in progress"),
    );
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(
      h.substrate.calls.filter((c) => c === `resumeActor ${ACTOR}`),
    ).toHaveLength(2);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
  });

  it("ABORTED from a crash during the resume: re-reads, reverts, wakes", async () => {
    const h = harness();
    const actor = h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    h.substrate.fail("resumeActor", () => {
      actor.state = "crashed";
      return new SubstrateAbortedError(`actor ${ACTOR} crashed`);
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.calls).toContain(`revertActor ${ACTOR}`);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
  });

  it("no free worker: throws at once, naming it", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    h.substrate.fail(
      "resumeActor",
      new SubstrateNoWorkerError("no free workers available"),
    );
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/no free Substrate worker/);
    expect(
      h.substrate.calls.filter((c) => c === `resumeActor ${ACTOR}`),
    ).toHaveLength(1);
  });

  it("an actor that never settles fails loudly", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    for (let i = 0; i < 20; i += 1) {
      h.substrate.fail("resumeActor", new SubstrateAbortedError("busy"));
    }
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/did not settle/);
  });

  it("a template another server retired: prepared again once, then the actor is created", async () => {
    const h = harness();
    await h.driver.internals.keeper.ready();
    h.substrate.templates.clear();
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(
      h.substrate.calls.filter((c) => c.startsWith("createTemplate")),
    ).toHaveLength(2);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
  });

  it("a create that fails again after the template was prepared again: thrown", async () => {
    const h = harness();
    h.substrate.fail("createActor", new Error("boom one"));
    h.substrate.fail("createActor", new Error("boom two"));
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/boom two/);
  });

  it("a waiter refusal throws with its status and code", async () => {
    const h = harness(() => ({
      status: 403,
      body: { code: "binding", error: "this sandbox does not serve it" },
    }));
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/refused its attach push \(403 binding\)/);
  });

  it("a queue that is not the scope's and id's: throws before touching Substrate", async () => {
    const h = harness();
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, {
        ...facts,
        taskQueue: "session:ses_other",
      }),
    ).rejects.toThrow(/serves session:ses_01abc/);
    expect(h.substrate.calls).toEqual([]);
  });
});

describe("rotated secrets", () => {
  it("a running runner refusing them keeps running, and the turn goes on", async () => {
    const h = harness(() => ({
      status: 409,
      body: { code: "secrets_changed", error: "ANTHROPIC_API_KEY differs" },
    }));
    h.substrate.put({
      name: ACTOR,
      state: "running",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.router.pushes).toHaveLength(1);
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      `ensureEgressPolicy ${ACTOR}`,
    ]);
  });
});

describe("the ensure's log line names the path it took", () => {
  /** A harness whose logger keeps every "ensured" line's fields. */
  function logged() {
    const ensured: LogEntry[] = [];
    const logger = createLogger({
      level: "info",
      pretty: false,
      write: () => {},
      sink: (entry) => {
        if (entry.message === "Substrate sandbox ensured") ensured.push(entry);
      },
    });
    return { h: harness(undefined, undefined, logger), ensured };
  }

  async function armOf(
    h: ReturnType<typeof harness>,
    ensured: LogEntry[],
  ): Promise<unknown> {
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(ensured).toHaveLength(1);
    return ensured[0]?.fields?.["arm"];
  }

  it("created: an absent sandbox created and woken is not counted as a wake from storage", async () => {
    const { h, ensured } = logged();
    expect(await armOf(h, ensured)).toBe("created");
  });

  it("an absent sandbox another server created meanwhile is named by the state found next, not created", async () => {
    const { h, ensured } = logged();
    const create = h.substrate.createActor.bind(h.substrate);
    h.substrate.createActor = async (name, template) => {
      h.substrate.put({ name, state: "running", template });
      return create(name, template);
    };
    expect(await armOf(h, ensured)).toBe("running");
  });

  it("suspended: woken from storage", async () => {
    const { h, ensured } = logged();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "t",
    });
    expect(await armOf(h, ensured)).toBe("suspended");
  });

  it("paused: woken on its node", async () => {
    const { h, ensured } = logged();
    h.substrate.put({ name: ACTOR, state: "paused", template: "t" });
    h.advance(MAX_IN_PLACE_PAUSE_SECONDS * 1000 + 1);
    expect(await armOf(h, ensured)).toBe("paused");
  });

  it("running: already awake, pushed only", async () => {
    const { h, ensured } = logged();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    expect(await armOf(h, ensured)).toBe("running");
  });

  it("crashed: reverted, then brought up", async () => {
    const { h, ensured } = logged();
    h.substrate.put({ name: ACTOR, state: "crashed", template: "t" });
    expect(await armOf(h, ensured)).toBe("crashed");
  });

  it("a state in transition names nothing: the path is the settled state it acts on", async () => {
    const { h, ensured } = logged();
    const actor = h.substrate.put({
      name: ACTOR,
      state: "suspending",
      template: "t",
    });
    let polls = 0;
    const getActor = h.substrate.getActor.bind(h.substrate);
    h.substrate.getActor = async (name) => {
      polls += 1;
      if (polls === 2) actor.state = "suspended";
      return getActor(name);
    };
    expect(await armOf(h, ensured)).toBe("suspended");
  });
});

describe("one actor's operations never interleave", () => {
  it("a second ensure reads the actor only after the first has pushed", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pushes = 0;
    const h = harness(() => ({ status: 200, body: { started: true } }));
    h.substrate.put({
      name: ACTOR,
      state: "running",
      template: "stigmer-runner-old",
    });
    const fetchFirst = h.router.fetch;
    // A driver whose first push waits until released.
    const slow = newSubstrateSandboxDriverOverGateway({
      config,
      settings,
      logger: silentLogger,
      gateway: h.substrate,
      fetch: (async (...args: Parameters<typeof fetch>) => {
        pushes += 1;
        if (pushes === 1) await held;
        return fetchFirst(...args);
      }) as typeof fetch,
    });
    const first = slow.provisioner.ensureSessionSandbox(SESSION, facts);
    const second = slow.provisioner.ensureSessionSandbox(SESSION, facts);
    await new Promise((r) => setImmediate(r));
    expect(
      h.substrate.calls.filter((c) => c === `getActor ${ACTOR}`),
    ).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(
      h.substrate.calls.filter((c) => c === `getActor ${ACTOR}`),
    ).toHaveLength(2);
  });
});

describe("deprovision, probe, lifecycle", () => {
  it("deprovision deletes in any state; an absent actor is success", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    await h.driver.provisioner.deprovisionSessionSandbox(SESSION);
    await h.driver.provisioner.deprovisionSessionSandbox(SESSION);
    expect(h.substrate.actors.has(ACTOR)).toBe(false);
  });

  it("probe maps Substrate's states onto absent, running and stopped", async () => {
    const h = harness();
    expect(await h.driver.provisioner.probe("session", SESSION)).toBe("absent");
    const actor = h.substrate.put({
      name: ACTOR,
      state: "running",
      template: "t",
    });
    expect(await h.driver.provisioner.probe("session", SESSION)).toBe(
      "running",
    );
    actor.state = "resuming";
    expect(await h.driver.provisioner.probe("session", SESSION)).toBe(
      "running",
    );
    for (const state of ["paused", "suspended", "crashed"] as const) {
      actor.state = state;
      expect(await h.driver.provisioner.probe("session", SESSION)).toBe(
        "stopped",
      );
    }
  });

  it("a connect sandbox follows the same machine under its own name", async () => {
    const h = harness();
    expect(
      await h.driver.provisioner.createConnectSandbox("mcx_1", {
        ...facts,
        taskQueue: "mcpconnect:mcx_1",
      }),
    ).toBe("mcx_1");
    expect(h.substrate.actors.has(sandboxBaseName("connect", "mcx_1"))).toBe(
      true,
    );
    await h.driver.provisioner.deprovisionConnectSandbox("mcx_1");
    expect(h.substrate.actors.size).toBe(0);
  });

  it("lifecycle.resume is the ensure", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "paused", template: "t" });
    await h.driver.lifecycle.resume("session", SESSION, facts);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
    expect(h.router.pushes).toHaveLength(1);
  });

  it("reattach pushes to a running sandbox and touches no lifecycle", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    expect(
      await h.driver.lifecycle.reattach("session", SESSION, facts),
    ).toEqual({
      pushed: true,
      result: { ok: true, started: true },
    });
    expect(h.substrate.calls).toEqual([`getActor ${ACTOR}`]);
  });

  it("reattach leaves a sandbox that is not running alone, so the router never wakes it", async () => {
    const h = harness();
    expect(
      await h.driver.lifecycle.reattach("session", SESSION, facts),
    ).toEqual({
      pushed: false,
      state: "absent",
    });
    h.substrate.put({ name: ACTOR, state: "paused", template: "t" });
    expect(
      await h.driver.lifecycle.reattach("session", SESSION, facts),
    ).toEqual({
      pushed: false,
      state: "paused",
    });
    expect(h.router.pushes).toEqual([]);
  });

  it("reattach suspends a runner this process started that another push attached", async () => {
    let reply: { status: number; body: Record<string, unknown> } = {
      status: 200,
      body: { started: true },
    };
    const h = harness(() => reply);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    reply = { status: 409, body: { code: "other_queue", error: "taken" } };
    await expect(
      h.driver.lifecycle.reattach("session", SESSION, facts),
    ).rejects.toThrow(/attached by another push before this one/);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("suspended");
  });

  it("pause, suspend, list and delete act on the named actor", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    await h.driver.lifecycle.pause("session", SESSION);
    expect((await h.driver.lifecycle.list())[0]).toMatchObject({
      name: ACTOR,
      state: "paused",
      template: "t",
    });
    await h.driver.lifecycle.suspend("session", SESSION);
    expect((await h.driver.lifecycle.list())[0]?.state).toBe("suspended");
    await h.driver.lifecycle.delete("session", SESSION);
    expect(await h.driver.lifecycle.list()).toEqual([]);
  });

  it("retires only this server's old templates that no actor uses", async () => {
    const h = harness();
    await h.driver.internals.keeper.ready();
    const current = h.driver.internals.keeper.name;
    // The current template is past the grace too: it is kept for being current.
    h.advance(20 * 60_000);
    h.substrate.putTemplate("stigmer-runner-aaaaaaaaaaaa", {
      createTime: new Date(h.now() - 60 * 60_000),
    });
    h.substrate.putTemplate("stigmer-runner-bbbbbbbbbbbb", {
      createTime: new Date(h.now() - 60 * 60_000),
    });
    h.substrate.putTemplate("stigmer-runner-cccccccccccc", {
      createTime: new Date(h.now() - 60_000),
    });
    h.substrate.putTemplate("someone-elses", {
      createTime: new Date(h.now() - 60 * 60_000),
    });
    h.substrate.put({
      name: "sbx-ses-000000000000",
      state: "suspended",
      template: "stigmer-runner-bbbbbbbbbbbb",
    });
    expect(await h.driver.lifecycle.retireTemplates()).toBe(1);
    expect([...h.substrate.templates.keys()].sort()).toEqual(
      [
        current,
        "someone-elses",
        "stigmer-runner-bbbbbbbbbbbb",
        "stigmer-runner-cccccccccccc",
      ].sort(),
    );
  });
});

describe("a waiter another push reached first", () => {
  it("on a wake from storage or from a pause, a refusal of the driver's first push suspends the sandbox and fails", async () => {
    for (const [code, asleep] of [
      ["secrets_changed", "suspended"],
      ["token_mismatch", "suspended"],
      ["other_queue", "suspended"],
      ["secrets_changed", "paused"],
    ] as const) {
      const h = harness(() => ({
        status: 409,
        body: { code, error: "taken" },
      }));
      h.substrate.put({
        name: ACTOR,
        state: asleep,
        template: "stigmer-runner-old",
      });
      await expect(
        h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
      ).rejects.toThrow(
        new RegExp(`attached by another push before this one \\(${code}\\)`),
      );
      expect(h.substrate.actors.get(ACTOR)?.state).toBe("suspended");
    }
  });
});

describe("a runner this process started, attached elsewhere after a cut-short wake", () => {
  it("is suspended when a later ensure finds it running or paused, and the ensure fails", async () => {
    for (const later of ["running", "paused"]) {
      let reply: { status: number; body: Record<string, unknown> } = {
        status: 400,
        body: { code: "malformed", error: "bad body" },
      };
      const h = harness(() => reply);
      h.substrate.put({
        name: ACTOR,
        state: "suspended",
        template: "stigmer-runner-old",
      });
      // The waking ensure is cut short after its resume: its push fails.
      await expect(
        h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
      ).rejects.toThrow(/refused its attach push \(400 malformed\)/);
      if (later === "paused") {
        await h.driver.lifecycle.pause("session", SESSION);
      }
      // A push from elsewhere then won the waiter.
      reply = {
        status: 409,
        body: { code: "secrets_changed", error: "differs" },
      };
      await expect(
        h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
      ).rejects.toThrow(/attached by another push before this one/);
      expect(h.substrate.actors.get(ACTOR)?.state).toBe("suspended");
    }
  });
});

describe("the runner's mode", () => {
  /** MODE in the template the driver created for its first sandbox. */
  async function modeOfCreatedTemplate(
    runnerMode?: "local" | "cloud",
  ): Promise<string | undefined> {
    const h = harness(undefined, runnerMode);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    const [template] = [...h.substrate.templates.values()];
    return template?.spec.containers[0]?.env.find((e) => e.name === "MODE")
      ?.value;
  }

  it("reaches the template a composition's driver creates", async () => {
    expect(await modeOfCreatedTemplate("cloud")).toBe("cloud");
  });

  it("is open source's own, local, when not given", async () => {
    expect(await modeOfCreatedTemplate()).toBe("local");
  });
});

describe("the lifecycle a composition's own sweep calls", () => {
  const idle = { proceed: async () => true, stillIdle: async () => true };

  it("pauses and suspends unguarded as before, answering done", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    expect(await h.driver.lifecycle.pause("session", SESSION)).toBe("done");
    expect(await h.driver.lifecycle.suspend("session", SESSION)).toBe("done");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("suspended");
  });

  it("asks a pause's guard about the sandbox as it is now, and skips when it says no", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    const seen: string[] = [];
    const outcome = await h.driver.lifecycle.pause("session", SESSION, {
      proceed: async (actor) => {
        seen.push(`${actor.name} ${actor.state}`);
        return false;
      },
      stillIdle: async () => true,
    });
    expect(outcome).toBe("skipped");
    expect(seen).toEqual([`${ACTOR} running`]);
    expect(h.substrate.calls).toEqual([`getActor ${ACTOR}`]);
  });

  it("pauses when its guard proceeds and the sandbox is still idle afterwards", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    expect(await h.driver.lifecycle.pause("session", SESSION, idle)).toBe(
      "done",
    );
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("paused");
  });

  it("wakes the sandbox again when a turn arrived while the pause was in flight, leaving the push to the turn's ensure", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    const outcome = await h.driver.lifecycle.pause("session", SESSION, {
      proceed: async () => true,
      stillIdle: async () => false,
    });
    expect(outcome).toBe("thawed");
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      `pauseActor ${ACTOR}`,
      `resumeActor ${ACTOR}`,
    ]);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
    expect(h.router.pushes).toEqual([]);
  });

  it("counts the runner a woken-again pause starts as this process's: a refusal of its first push as attached elsewhere suspends it", async () => {
    const h = harness(() => ({
      status: 409,
      body: { code: "token_mismatch", error: "taken" },
    }));
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    await h.driver.lifecycle.pause("session", SESSION, {
      proceed: async () => true,
      stillIdle: async () => false,
    });
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, facts),
    ).rejects.toThrow(/attached by another push before this one/);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("suspended");
  });

  it("never asks a guard about a sandbox that is gone", async () => {
    const h = harness();
    let asked = false;
    const guard = {
      proceed: async () => {
        asked = true;
        return true;
      },
      stillIdle: async () => true,
    };
    expect(await h.driver.lifecycle.pause("session", SESSION, guard)).toBe(
      "skipped",
    );
    expect(await h.driver.lifecycle.suspend("session", SESSION, guard)).toBe(
      "skipped",
    );
    expect(asked).toBe(false);
  });

  it("suspends only when its guard proceeds", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "paused", template: "t" });
    expect(
      await h.driver.lifecycle.suspend("session", SESSION, {
        proceed: async () => false,
      }),
    ).toBe("skipped");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("paused");
    expect(
      await h.driver.lifecycle.suspend("session", SESSION, {
        proceed: async (actor) => actor.state === "paused",
      }),
    ).toBe("done");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("suspended");
  });

  it("runs one pass of upkeep over the caller's listing", async () => {
    const h = harness();
    await h.driver.lifecycle.prepare();
    const current = h.driver.internals.keeper.name;
    h.advance(20 * 60_000);
    h.substrate.putTemplate("stigmer-runner-aaaaaaaaaaaa", {
      createTime: new Date(h.now() - 60 * 60_000),
    });
    h.substrate.put({
      name: "sbx-ses-000000000001",
      state: "deleting",
      template: current,
    });
    h.substrate.put({
      name: "sbx-ses-000000000002",
      state: "suspended",
      template: "stigmer-runner-aaaaaaaaaaaa",
    });
    h.substrate.put({
      name: "sbx-ses-000000000003",
      state: "suspended",
      template: current,
    });
    h.substrate.put({
      name: "sbx-mcp-000000000004",
      state: "running",
      template: current,
      policy: [],
    });
    h.substrate.put({
      name: "sbx-ses-000000000005",
      state: "paused",
      template: current,
    });
    // Mid-transition: nothing to keep up this pass.
    h.substrate.put({
      name: "sbx-ses-000000000006",
      state: "resuming",
      template: current,
    });
    const listed = await h.driver.lifecycle.list();
    expect(await h.driver.lifecycle.maintain(listed)).toEqual({
      redeleted: 1,
      moved: 1,
      retired: 1,
    });
    expect(h.substrate.actors.has("sbx-ses-000000000001")).toBe(false);
    expect(h.substrate.actors.get("sbx-ses-000000000002")?.template).toBe(
      current,
    );
    expect(h.substrate.calls.filter((c) => c.startsWith("moveActor"))).toEqual([
      "moveActor sbx-ses-000000000002",
    ]);
    // An awake sandbox's policy is its next ensure's to write: the sweep
    // does not know its Environment, and the bare rules would widen it.
    expect(h.substrate.actors.get("sbx-mcp-000000000004")?.policy).toEqual([]);
    expect(
      h.substrate.calls.filter((c) => c.startsWith("ensureEgressPolicy")),
    ).toEqual([]);
    expect(h.substrate.templates.has("stigmer-runner-aaaaaaaaaaaa")).toBe(
      false,
    );
  });

  it("moves a sleeping sandbox only if it is still asleep when its turn in the queue comes", async () => {
    const h = harness();
    await h.driver.lifecycle.prepare();
    const sleeping = h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    const listed = await h.driver.lifecycle.list();
    sleeping.state = "running";
    expect((await h.driver.lifecycle.maintain(listed)).moved).toBe(0);
    expect(h.substrate.calls).not.toContain(`moveActor ${ACTOR}`);
  });

  it("repeats a delete only for a sandbox still deleting when its turn in the queue comes", async () => {
    const h = harness();
    const stuck = h.substrate.put({
      name: ACTOR,
      state: "deleting",
      template: "t",
    });
    const listed = await h.driver.lifecycle.list();
    stuck.state = "suspended";
    expect((await h.driver.lifecycle.maintain(listed)).redeleted).toBe(0);
    expect(h.substrate.calls).not.toContain(`deleteActor ${ACTOR}`);
  });

  it("deletes a sandbox known only by its name, and refuses a name it never gives", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: "running", template: "t" });
    expect(await h.driver.lifecycle.deleteByName(ACTOR)).toBe("done");
    expect(h.substrate.actors.has(ACTOR)).toBe(false);
    expect(await h.driver.lifecycle.deleteByName(ACTOR)).toBe("done");
    for (const foreign of [
      "golden-t",
      "sbx-anything",
      "sbx-ses-ABCDEF123456",
    ]) {
      h.substrate.put({
        name: foreign,
        state: "running",
        template: "t",
      });
      await expect(h.driver.lifecycle.deleteByName(foreign)).rejects.toThrow(
        /not a sandbox this driver names/,
      );
      expect(h.substrate.actors.has(foreign)).toBe(true);
    }
  });

  it("refuses a leftover workflow-scope sandbox by name without calling the gateway", async () => {
    const h = harness();
    const leftover = "sbx-wfx-0123456789ab";
    h.substrate.put({
      name: leftover,
      state: "suspended",
      template: "t",
    });
    await expect(h.driver.lifecycle.deleteByName(leftover)).rejects.toThrow(
      /not a sandbox this driver names/,
    );
    expect(h.substrate.calls).toEqual([]);
    expect(h.substrate.actors.has(leftover)).toBe(true);
  });

  it("asks a delete's guard inside the actor's queue, so a sandbox a turn woke meanwhile is skipped, not deleted", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    const seen: string[] = [];
    // The wake is queued first; the delete's guard must see what it left.
    const wake = h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    const outcome = h.driver.lifecycle.deleteByName(ACTOR, {
      proceed: async (actor) => {
        seen.push(`${actor.name} ${actor.state}`);
        return actor.state === "suspended";
      },
    });
    await wake;
    expect(await outcome).toBe("skipped");
    expect(seen).toEqual([`${ACTOR} running`]);
    expect(h.substrate.calls).not.toContain(`deleteActor ${ACTOR}`);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe("running");
    // A skipped delete forgets nothing this process knew of the sandbox.
    expect(h.driver.internals.lastEnsuredAt(ACTOR)).toBeDefined();
  });

  it("deletes when a delete's guard proceeds, and never asks about a sandbox that is gone", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "t",
    });
    let asked = 0;
    const guard = {
      proceed: async () => {
        asked += 1;
        return true;
      },
    };
    expect(await h.driver.lifecycle.deleteByName(ACTOR, guard)).toBe("done");
    expect(h.substrate.actors.has(ACTOR)).toBe(false);
    expect(await h.driver.lifecycle.deleteByName(ACTOR, guard)).toBe("skipped");
    expect(asked).toBe(1);
  });

  it("forgets a sandbox a guarded delete found already gone", async () => {
    const h = harness();
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.driver.internals.lastEnsuredAt(ACTOR)).toBeDefined();
    h.substrate.actors.delete(ACTOR);
    expect(
      await h.driver.lifecycle.deleteByName(ACTOR, {
        proceed: async () => true,
      }),
    ).toBe("skipped");
    expect(h.driver.internals.lastEnsuredAt(ACTOR)).toBeUndefined();
  });

  it("skips a sandbox whose upkeep fails, and stops before retiring when asked", async () => {
    const h = harness();
    h.substrate.put({
      name: "sbx-ses-000000000001",
      state: "deleting",
      template: "t",
    });
    h.substrate.put({
      name: "sbx-ses-000000000002",
      state: "deleting",
      template: "t",
    });
    h.substrate.fail("deleteActor", new Error("Substrate unavailable"));
    const listed = await h.driver.lifecycle.list();
    expect((await h.driver.lifecycle.maintain(listed)).redeleted).toBe(1);
    expect(h.substrate.actors.size).toBe(1);
    const second = await h.driver.lifecycle.list();
    const before = h.substrate.calls.length;
    let checks = 0;
    expect(
      await h.driver.lifecycle.maintain(second, {
        stopping: () => (checks += 1) > 1,
      }),
    ).toEqual({ redeleted: 1, moved: 0, retired: 0 });
    expect(h.substrate.calls.slice(before)).not.toContain("listTemplates ");
    // A shutdown before the first sandbox touches none.
    h.substrate.put({
      name: "sbx-ses-000000000003",
      state: "deleting",
      template: "t",
    });
    const untouched = h.substrate.calls.length;
    expect(
      await h.driver.lifecycle.maintain(await h.driver.lifecycle.list(), {
        stopping: () => true,
      }),
    ).toEqual({ redeleted: 0, moved: 0, retired: 0 });
    expect(h.substrate.calls.slice(untouched)).toEqual(["listActors "]);
  });

  it("prepares the template, and logs instead of rejecting when it cannot", async () => {
    const h = harness();
    h.substrate.fail("ensureAtespace", new Error("no Substrate"));
    await expect(h.driver.lifecycle.prepare()).resolves.toBeUndefined();
    expect(h.driver.internals.keeper.readyNow()).toBe(false);
    await h.driver.lifecycle.prepare();
    expect(h.driver.internals.keeper.readyNow()).toBe(true);
  });
});

describe("the egress policy of an existing sandbox", () => {
  it("is replaced by a changed configuration's rules, once per process for a running one", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "running",
      template: "stigmer-runner-old",
      policy: [],
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(h.substrate.actors.get(ACTOR)?.policy?.length).toBeGreaterThan(0);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(
      h.substrate.calls.filter((c) => c === `ensureEgressPolicy ${ACTOR}`),
    ).toHaveLength(1);
  });

  it("is reconciled on every wake from storage", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    await h.driver.lifecycle.suspend("session", SESSION);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(
      h.substrate.calls.filter((c) => c === `ensureEgressPolicy ${ACTOR}`),
    ).toHaveLength(2);
  });
});

describe("a session's Environment", () => {
  function limitedTo(...hosts: string[]): EnvironmentFacts {
    return {
      id: "env_1",
      network: {
        mode: "limited",
        hosts: hosts.map((host) => ({ host, cleartext: false })),
      },
      packages: { apt: ["ripgrep"], cargo: [], gem: [], go: [], npm: [], pip: [] },
    };
  }

  function httpsHostsOf(policy: readonly EgressRule[] | undefined): string[] {
    return (policy ?? []).flatMap((rule) => rule.https?.hostnames ?? []);
  }

  function policyWrites(h: ReturnType<typeof harness>): number {
    return h.substrate.calls.filter((c) => c === `ensureEgressPolicy ${ACTOR}`)
      .length;
  }

  it("can be limited only while HTTPS egress is on, and its packages installed either way", () => {
    expect(harness().driver.provisioner.environmentSupport).toEqual({
      limitedNetworking: true,
      packages: true,
    });
    const closed = newSubstrateSandboxDriverOverGateway({
      config,
      settings: { ...settings, httpsEgress: "none" },
      logger: silentLogger,
      gateway: new FakeSubstrate(),
    });
    expect(closed.provisioner.environmentSupport).toEqual({
      limitedNetworking: false,
      packages: true,
    });
  });

  it("limited: the policy written has no HTTPS wildcard and names its hosts", async () => {
    const h = harness();
    await h.driver.provisioner.ensureSessionSandbox(SESSION, {
      ...facts,
      environment: limitedTo("example.com", "pypi.org"),
    });
    const https = httpsHostsOf(h.substrate.actors.get(ACTOR)?.policy);
    expect(https).not.toContain("*");
    expect(https).toEqual(expect.arrayContaining(["example.com", "pypi.org"]));
  });

  it("a running sandbox's next ensure with the same facts writes no policy; a changed host list replaces it at that ensure", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: "running",
      template: "stigmer-runner-old",
    });
    const first = { ...facts, environment: limitedTo("example.com") };
    await h.driver.provisioner.ensureSessionSandbox(SESSION, first);
    expect(policyWrites(h)).toBe(1);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, first);
    expect(policyWrites(h)).toBe(1);

    await h.driver.provisioner.ensureSessionSandbox(SESSION, {
      ...facts,
      environment: limitedTo("example.org"),
    });
    expect(policyWrites(h)).toBe(2);
    const https = httpsHostsOf(h.substrate.actors.get(ACTOR)?.policy);
    expect(https).toContain("example.org");
    expect(https).not.toContain("example.com");
  });

  it("a wake from storage always reconciles, even with facts this process already wrote", async () => {
    const h = harness();
    const limited = { ...facts, environment: limitedTo("example.com") };
    h.substrate.put({
      name: ACTOR,
      state: "suspended",
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, limited);
    await h.driver.lifecycle.suspend("session", SESSION);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, limited);
    expect(policyWrites(h)).toBe(2);
  });

  it("the attach push carries the runner's half, never the hosts; a push without an Environment carries none", async () => {
    const h = harness();
    const environment = limitedTo("example.com");
    await h.driver.provisioner.ensureSessionSandbox(SESSION, {
      ...facts,
      environment,
    });
    expect(h.router.pushes[0]?.environment).toEqual(
      runnerEnvironmentOf(environment),
    );
    expect(JSON.stringify(h.router.pushes[0])).not.toContain("example.com");

    const bare = harness();
    await bare.driver.provisioner.ensureSessionSandbox(SESSION, facts);
    expect(bare.router.pushes[0]).not.toHaveProperty("environment");
  });
});

describe("configuration the driver refuses", () => {
  it("no backend endpoint, no Temporal address, an image not pinned by digest, a secret the runner does not take, or Temporal settings that ask for TLS", () => {
    expect(() =>
      validateSubstrateDriverConfig({ ...config, backendEndpoint: "" }),
    ).toThrow(/STIGMER_SANDBOX_BACKEND_ENDPOINT/);
    expect(() =>
      validateSubstrateDriverConfig({ ...config, temporalAddress: "" }),
    ).toThrow(/STIGMER_SANDBOX_TEMPORAL_ADDRESS/);
    expect(() =>
      validateSubstrateDriverConfig({
        ...config,
        runnerImage: "ghcr.io/stigmer/runner:latest",
      }),
    ).toThrow(/pinned by digest/);
    expect(() =>
      validateSubstrateDriverConfig({
        ...config,
        runnerSecretEnv: { GITHUB_TOKEN: "ghp" },
      }),
    ).toThrow(/cannot push GITHUB_TOKEN/);
    // Every Temporal connection setting asks for TLS, which the runner's
    // lane cannot carry through Substrate's gateway (egress.ts).
    expect(() =>
      validateSubstrateDriverConfig({
        ...config,
        temporalConnectionEnv: {
          STIGMER_TEMPORAL_TLS: "true",
          STIGMER_TEMPORAL_API_KEY: "temporal-key",
        },
      }),
    ).toThrow(
      /Temporal lane in cleartext .*\(STIGMER_TEMPORAL_API_KEY, STIGMER_TEMPORAL_TLS\)/,
    );
  });
});
