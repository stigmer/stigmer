/**
 * Pins the substrate driver's ensure state machine and lifecycle over a
 * fake Substrate (driver.ts), with no cluster and no real time:
 *
 *   - absent → the template prepared and awaited, the actor created, its
 *     egress policy written, resumed, attached by one push carrying the
 *     queue and exactly the secrets (never a plain setting);
 *   - SUSPENDED → moved to the current template only when that template is
 *     ready, its policy repaired when missing, resumed, pushed;
 *   - PAUSED → resumed in place, unless paused past the in-place bound, then
 *     suspended and started fresh;
 *   - RUNNING → pushed only; CRASHED → reverted first; DELETING → refused;
 *   - ABORTED → re-read, whether contention or a crash; no free worker →
 *     thrown at once;
 *   - a pause from before this server process, or within the clock-skew
 *     allowance after its start, is started fresh, never thawed; a running
 *     runner refusing rotated secrets keeps running;
 *   - a runner this process started that refuses a push as already
 *     attached elsewhere is suspended, and the ensure fails: at the wake
 *     itself, and at a later ensure when the waking one was cut short;
 *   - a waiter refusal throws with its code; a mismatched queue throws
 *     before any call;
 *   - one actor's operations never interleave;
 *   - deprovision, probe, reattach (a running sandbox only), and template
 *     retirement;
 *   - the lifecycle a composition's own sweep calls: a guarded pause asks
 *     before the call from a fresh read and thaws when the sweep says it is
 *     no longer idle afterwards, a guarded suspend asks before; `maintain`
 *     repeats a stuck delete, makes an awake sandbox's egress current once
 *     per process for a sandbox still awake, moves only a sleeping sandbox
 *     off an older template, then retires, skipping a sandbox whose upkeep fails and stopping before
 *     retirement when asked; `deleteByName` deletes only a name this driver
 *     gives; `prepare` readies the template and never rejects.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import { sandboxBaseName } from "../../naming.js";
import type {
  SandboxDriverConfig,
  SandboxEnvironment,
} from "../../provisioner.js";
import { FakeSubstrate, fakeRouter } from "../__test-utils__/fake-gateway.js";
import type { SubstrateDriverSettings } from "../config.js";
import {
  newSubstrateSandboxDriverOverGateway,
  validateSubstrateDriverConfig,
} from "../driver.js";
import { ActorState } from "../gen/ateapipb/ateapi_pb.js";
import { SubstrateAbortedError, SubstrateNoWorkerError } from "../gateway.js";
import {
  CLOCK_SKEW_ALLOWANCE_MS,
  MAX_IN_PLACE_PAUSE_SECONDS,
} from "../limits.js";

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
};

const settings: SubstrateDriverSettings = {
  apiEndpoint: "https://api.ate-system.svc:443",
  apiServerName: "",
  apiCaFile: "",
  apiTokenFile: "/unused",
  routerUrl: "http://router.example:18200",
  atespace: "stigmer",
  storageLocation: "gs://ate-snapshots/stigmer",
  workerSelector: { workload: "stigmer" },
  sandboxConfigName: "gvisor-default",
  httpsEgress: "all",
  extraHttpEgress: [],
  pauseAfterSeconds: 300,
  suspendAfterSeconds: 1800,
  sweepIntervalSeconds: 60,
};

const SESSION = "ses_01abc";
const ACTOR = sandboxBaseName("session", SESSION);
const env: SandboxEnvironment = {
  taskQueue: `session:${SESSION}`,
  stigmerToken: "tok-1",
  callerClass: "user",
};

function harness(
  answer?: Parameters<typeof fakeRouter>[0],
  runnerMode?: "local" | "cloud",
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
    logger: silentLogger,
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
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);

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
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
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
      ...env,
      stigmerToken: "",
    });
    expect(h.router.pushes[0]?.secrets).not.toHaveProperty("STIGMER_TOKEN");
  });

  it("RUNNING: pushes only, so the waiter keeps its runner and takes the fresh token", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.RUNNING,
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
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
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.calls).not.toContain(`moveActor ${ACTOR}`);
    expect(h.substrate.calls.some((c) => c.startsWith("createTemplate"))).toBe(
      false,
    );
    expect(h.substrate.actors.get(ACTOR)?.template).toBe("stigmer-runner-old");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
  });

  it("SUSPENDED on an older template: moves to the current one once it is ready", async () => {
    const h = harness();
    await h.driver.internals.keeper.ready();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
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
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.actors.get(ACTOR)?.template).toBe("stigmer-runner-old");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
  });

  it("SUSPENDED without a policy (its creator died before writing it): the policy is written before the wake", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
      policy: undefined,
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.actors.get(ACTOR)?.policy?.length).toBeGreaterThan(0);
    const calls = h.substrate.calls;
    expect(calls.indexOf(`ensureEgressPolicy ${ACTOR}`)).toBeLessThan(
      calls.indexOf(`resumeActor ${ACTOR}`),
    );
  });

  it("PAUSED briefly: resumes in place", async () => {
    const h = harness();
    // Paused by this process, past the clock-skew allowance after its start.
    h.advance(CLOCK_SKEW_ALLOWANCE_MS);
    h.substrate.put({
      name: ACTOR,
      state: ActorState.PAUSED,
      template: "stigmer-runner-old",
    });
    h.advance(MAX_IN_PLACE_PAUSE_SECONDS * 1000 - 1);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      `ensureEgressPolicy ${ACTOR}`,
      `resumeActor ${ACTOR}`,
    ]);
  });

  it("PAUSED past the in-place bound: suspends, then starts fresh", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.PAUSED,
      template: "stigmer-runner-old",
    });
    h.advance(MAX_IN_PLACE_PAUSE_SECONDS * 1000 + 1);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      `suspendActor ${ACTOR}`,
      `getActor ${ACTOR}`,
      `ensureEgressPolicy ${ACTOR}`,
      `resumeActor ${ACTOR}`,
    ]);
  });

  it("CRASHED: reverts, then wakes from where that leaves it", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.CRASHED,
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.calls.slice(0, 3)).toEqual([
      `getActor ${ACTOR}`,
      `revertActor ${ACTOR}`,
      `getActor ${ACTOR}`,
    ]);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
  });

  it("in transition: waits for it to settle", async () => {
    const h = harness();
    const actor = h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDING,
      template: "stigmer-runner-old",
    });
    let polls = 0;
    const getActor = h.substrate.getActor.bind(h.substrate);
    h.substrate.getActor = async (name) => {
      polls += 1;
      if (polls === 3) actor.state = ActorState.SUSPENDED;
      return getActor(name);
    };
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
  });

  it("in transition for longer than the settle wait: fails, naming the state", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDING,
      template: "stigmer-runner-old",
    });
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, env),
    ).rejects.toThrow(/stayed SUSPENDING for 60 s/);
  });

  it("DELETING: refuses", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.DELETING,
      template: "stigmer-runner-old",
    });
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, env),
    ).rejects.toThrow(/being deleted/);
  });
});

describe("failures", () => {
  it("ABORTED from contention: re-reads and carries on", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    h.substrate.fail(
      "resumeActor",
      new SubstrateAbortedError("another operation is in progress"),
    );
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(
      h.substrate.calls.filter((c) => c === `resumeActor ${ACTOR}`),
    ).toHaveLength(2);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
  });

  it("ABORTED from a crash during the resume: re-reads, reverts, wakes", async () => {
    const h = harness();
    const actor = h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    h.substrate.fail("resumeActor", () => {
      actor.state = ActorState.CRASHED;
      return new SubstrateAbortedError(`actor ${ACTOR} crashed`);
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.calls).toContain(`revertActor ${ACTOR}`);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
  });

  it("no free worker: throws at once, naming it", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    h.substrate.fail(
      "resumeActor",
      new SubstrateNoWorkerError("no free workers available"),
    );
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, env),
    ).rejects.toThrow(/no free Substrate worker/);
    expect(
      h.substrate.calls.filter((c) => c === `resumeActor ${ACTOR}`),
    ).toHaveLength(1);
  });

  it("an actor that never settles fails loudly", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    for (let i = 0; i < 20; i += 1) {
      h.substrate.fail("resumeActor", new SubstrateAbortedError("busy"));
    }
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, env),
    ).rejects.toThrow(/did not settle/);
  });

  it("a template another server retired: prepared again once, then the actor is created", async () => {
    const h = harness();
    await h.driver.internals.keeper.ready();
    h.substrate.templates.clear();
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(
      h.substrate.calls.filter((c) => c.startsWith("createTemplate")),
    ).toHaveLength(2);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
  });

  it("a create that fails again after the template was prepared again: thrown", async () => {
    const h = harness();
    h.substrate.fail("createActor", new Error("boom one"));
    h.substrate.fail("createActor", new Error("boom two"));
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, env),
    ).rejects.toThrow(/boom two/);
  });

  it("a waiter refusal throws with its status and code", async () => {
    const h = harness(() => ({
      status: 403,
      body: { code: "binding", error: "this sandbox does not serve it" },
    }));
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, env),
    ).rejects.toThrow(/refused its attach push \(403 binding\)/);
  });

  it("a queue that is not the scope's and id's: throws before touching Substrate", async () => {
    const h = harness();
    await expect(
      h.driver.provisioner.ensureSessionSandbox(SESSION, {
        ...env,
        taskQueue: "session:ses_other",
      }),
    ).rejects.toThrow(/serves session:ses_01abc/);
    expect(h.substrate.calls).toEqual([]);
  });
});

describe("a pause from before this server process", () => {
  it("is started fresh, never thawed, so a runner with old secrets cannot take the turn", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.PAUSED,
      template: "stigmer-runner-old",
      updateTime: new Date(h.now() - 1_000),
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      `suspendActor ${ACTOR}`,
      `getActor ${ACTOR}`,
      `ensureEgressPolicy ${ACTOR}`,
      `resumeActor ${ACTOR}`,
    ]);
    expect(h.router.pushes).toHaveLength(1);
  });

  it("a running runner refusing rotated secrets keeps running, and the turn goes on", async () => {
    const h = harness(() => ({
      status: 409,
      body: { code: "secrets_changed", error: "ANTHROPIC_API_KEY differs" },
    }));
    h.substrate.put({
      name: ACTOR,
      state: ActorState.RUNNING,
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.router.pushes).toHaveLength(1);
    expect(h.substrate.calls).toEqual([
      `getActor ${ACTOR}`,
      `ensureEgressPolicy ${ACTOR}`,
    ]);
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
      state: ActorState.RUNNING,
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
    const first = slow.provisioner.ensureSessionSandbox(SESSION, env);
    const second = slow.provisioner.ensureSessionSandbox(SESSION, env);
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
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
    await h.driver.provisioner.deprovisionSessionSandbox(SESSION);
    await h.driver.provisioner.deprovisionSessionSandbox(SESSION);
    expect(h.substrate.actors.has(ACTOR)).toBe(false);
  });

  it("probe maps Substrate's states onto absent, running and stopped", async () => {
    const h = harness();
    expect(await h.driver.provisioner.probe("session", SESSION)).toBe("absent");
    const actor = h.substrate.put({
      name: ACTOR,
      state: ActorState.RUNNING,
      template: "t",
    });
    expect(await h.driver.provisioner.probe("session", SESSION)).toBe(
      "running",
    );
    actor.state = ActorState.RESUMING;
    expect(await h.driver.provisioner.probe("session", SESSION)).toBe(
      "running",
    );
    for (const state of [
      ActorState.PAUSED,
      ActorState.SUSPENDED,
      ActorState.CRASHED,
    ]) {
      actor.state = state;
      expect(await h.driver.provisioner.probe("session", SESSION)).toBe(
        "stopped",
      );
    }
  });

  it("workflow and connect sandboxes follow the same machine under their own names", async () => {
    const h = harness();
    await h.driver.provisioner.ensureWorkflowSandbox("wex_1", {
      ...env,
      taskQueue: "wfexec:wex_1",
    });
    expect(
      await h.driver.provisioner.createConnectSandbox("mcx_1", {
        ...env,
        taskQueue: "mcpconnect:mcx_1",
      }),
    ).toBe("mcx_1");
    expect(h.substrate.actors.has(sandboxBaseName("workflow", "wex_1"))).toBe(
      true,
    );
    expect(h.substrate.actors.has(sandboxBaseName("connect", "mcx_1"))).toBe(
      true,
    );
    await h.driver.provisioner.deprovisionWorkflowSandbox("wex_1");
    await h.driver.provisioner.deprovisionConnectSandbox("mcx_1");
    expect(h.substrate.actors.size).toBe(0);
  });

  it("lifecycle.resume is the ensure", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: ActorState.PAUSED, template: "t" });
    await h.driver.lifecycle.resume("session", SESSION, env);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
    expect(h.router.pushes).toHaveLength(1);
  });

  it("reattach pushes to a running sandbox and touches no lifecycle", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
    expect(await h.driver.lifecycle.reattach("session", SESSION, env)).toEqual({
      pushed: true,
      result: { ok: true, started: true },
    });
    expect(h.substrate.calls).toEqual([`getActor ${ACTOR}`]);
  });

  it("reattach leaves a sandbox that is not running alone, so the router never wakes it", async () => {
    const h = harness();
    expect(await h.driver.lifecycle.reattach("session", SESSION, env)).toEqual({
      pushed: false,
      state: "absent",
    });
    h.substrate.put({ name: ACTOR, state: ActorState.PAUSED, template: "t" });
    expect(await h.driver.lifecycle.reattach("session", SESSION, env)).toEqual({
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
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    reply = { status: 409, body: { code: "other_queue", error: "taken" } };
    await expect(
      h.driver.lifecycle.reattach("session", SESSION, env),
    ).rejects.toThrow(/attached by another push before this one/);
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.SUSPENDED);
  });

  it("pause, suspend, list and delete act on the named actor", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
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
      state: ActorState.SUSPENDED,
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
  it("on a wake from storage, a refusal of the driver's first push suspends the sandbox and fails", async () => {
    for (const code of ["secrets_changed", "token_mismatch", "other_queue"]) {
      const h = harness(() => ({
        status: 409,
        body: { code, error: "taken" },
      }));
      h.substrate.put({
        name: ACTOR,
        state: ActorState.SUSPENDED,
        template: "stigmer-runner-old",
      });
      await expect(
        h.driver.provisioner.ensureSessionSandbox(SESSION, env),
      ).rejects.toThrow(
        new RegExp(`attached by another push before this one \\(${code}\\)`),
      );
      expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.SUSPENDED);
    }
  });
});

describe("a runner this process started, attached elsewhere after a cut-short wake", () => {
  it("is suspended when a later ensure finds it running or paused, and the ensure fails", async () => {
    for (const later of [ActorState.RUNNING, ActorState.PAUSED]) {
      let reply: { status: number; body: Record<string, unknown> } = {
        status: 400,
        body: { code: "malformed", error: "bad body" },
      };
      const h = harness(() => reply);
      h.substrate.put({
        name: ACTOR,
        state: ActorState.SUSPENDED,
        template: "stigmer-runner-old",
      });
      // The waking ensure is cut short after its resume: its push fails.
      await expect(
        h.driver.provisioner.ensureSessionSandbox(SESSION, env),
      ).rejects.toThrow(/refused its attach push \(400 malformed\)/);
      if (later === ActorState.PAUSED) {
        h.advance(CLOCK_SKEW_ALLOWANCE_MS + 1);
        await h.driver.lifecycle.pause("session", SESSION);
      }
      // A push from elsewhere then won the waiter.
      reply = {
        status: 409,
        body: { code: "secrets_changed", error: "differs" },
      };
      await expect(
        h.driver.provisioner.ensureSessionSandbox(SESSION, env),
      ).rejects.toThrow(/attached by another push before this one/);
      expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.SUSPENDED);
    }
  });
});

describe("a pause close to this process's start", () => {
  it("is started fresh within the clock-skew allowance, thawed in place after it", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: ActorState.PAUSED, template: "t" });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.calls).toContain(`suspendActor ${ACTOR}`);

    const later = harness();
    later.advance(CLOCK_SKEW_ALLOWANCE_MS + 1);
    later.substrate.put({
      name: ACTOR,
      state: ActorState.PAUSED,
      template: "t",
    });
    await later.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(later.substrate.calls).not.toContain(`suspendActor ${ACTOR}`);
  });
});

describe("the runner's mode", () => {
  /** MODE in the template the driver created for its first sandbox. */
  async function modeOfCreatedTemplate(
    runnerMode?: "local" | "cloud",
  ): Promise<string | undefined> {
    const h = harness(undefined, runnerMode);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
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
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
    expect(await h.driver.lifecycle.pause("session", SESSION)).toBe("done");
    expect(await h.driver.lifecycle.suspend("session", SESSION)).toBe("done");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.SUSPENDED);
  });

  it("asks a pause's guard about the sandbox as it is now, and skips when it says no", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
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
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
    expect(await h.driver.lifecycle.pause("session", SESSION, idle)).toBe(
      "done",
    );
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.PAUSED);
  });

  it("thaws in place when a turn arrived while the pause was in flight", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
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
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.RUNNING);
    expect(h.router.pushes).toEqual([]);
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
    h.substrate.put({ name: ACTOR, state: ActorState.PAUSED, template: "t" });
    expect(
      await h.driver.lifecycle.suspend("session", SESSION, {
        proceed: async () => false,
      }),
    ).toBe("skipped");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.PAUSED);
    expect(
      await h.driver.lifecycle.suspend("session", SESSION, {
        proceed: async (actor) => actor.state === "paused",
      }),
    ).toBe("done");
    expect(h.substrate.actors.get(ACTOR)?.state).toBe(ActorState.SUSPENDED);
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
      state: ActorState.DELETING,
      template: current,
    });
    h.substrate.put({
      name: "sbx-ses-000000000002",
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-aaaaaaaaaaaa",
    });
    h.substrate.put({
      name: "sbx-ses-000000000003",
      state: ActorState.SUSPENDED,
      template: current,
    });
    h.substrate.put({
      name: "sbx-wfx-000000000004",
      state: ActorState.RUNNING,
      template: current,
      policy: [],
    });
    h.substrate.put({
      name: "sbx-ses-000000000005",
      state: ActorState.PAUSED,
      template: current,
    });
    // Mid-transition: nothing to keep up this pass.
    h.substrate.put({
      name: "sbx-ses-000000000006",
      state: ActorState.RESUMING,
      template: current,
    });
    const listed = await h.driver.lifecycle.list();
    expect(await h.driver.lifecycle.maintain(listed)).toEqual({
      redeleted: 1,
      egressReconciled: 2,
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
    expect(
      h.substrate.actors.get("sbx-wfx-000000000004")?.policy?.length,
    ).toBeGreaterThan(0);
    expect(h.substrate.templates.has("stigmer-runner-aaaaaaaaaaaa")).toBe(
      false,
    );
    // The egress policy is made current once per process.
    expect(
      (await h.driver.lifecycle.maintain(await h.driver.lifecycle.list()))
        .egressReconciled,
    ).toBe(0);
  });

  it("moves a sleeping sandbox only if it is still asleep when its turn in the queue comes", async () => {
    const h = harness();
    await h.driver.lifecycle.prepare();
    const sleeping = h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    const listed = await h.driver.lifecycle.list();
    sleeping.state = ActorState.RUNNING;
    expect((await h.driver.lifecycle.maintain(listed)).moved).toBe(0);
    expect(h.substrate.calls).not.toContain(`moveActor ${ACTOR}`);
  });

  it("makes egress current only for a sandbox still awake when its turn in the queue comes", async () => {
    const h = harness();
    const awake = h.substrate.put({
      name: ACTOR,
      state: ActorState.PAUSED,
      template: "t",
    });
    const listed = await h.driver.lifecycle.list();
    awake.state = ActorState.SUSPENDED;
    expect((await h.driver.lifecycle.maintain(listed)).egressReconciled).toBe(
      0,
    );
    expect(h.substrate.calls).not.toContain(`ensureEgressPolicy ${ACTOR}`);
  });

  it("repeats a delete only for a sandbox still deleting when its turn in the queue comes", async () => {
    const h = harness();
    const stuck = h.substrate.put({
      name: ACTOR,
      state: ActorState.DELETING,
      template: "t",
    });
    const listed = await h.driver.lifecycle.list();
    stuck.state = ActorState.SUSPENDED;
    expect((await h.driver.lifecycle.maintain(listed)).redeleted).toBe(0);
    expect(h.substrate.calls).not.toContain(`deleteActor ${ACTOR}`);
  });

  it("deletes a sandbox known only by its name, and refuses a name it never gives", async () => {
    const h = harness();
    h.substrate.put({ name: ACTOR, state: ActorState.RUNNING, template: "t" });
    await h.driver.lifecycle.deleteByName(ACTOR);
    expect(h.substrate.actors.has(ACTOR)).toBe(false);
    await h.driver.lifecycle.deleteByName(ACTOR);
    for (const foreign of [
      "golden-t",
      "sbx-anything",
      "sbx-ses-ABCDEF123456",
    ]) {
      h.substrate.put({
        name: foreign,
        state: ActorState.RUNNING,
        template: "t",
      });
      await expect(h.driver.lifecycle.deleteByName(foreign)).rejects.toThrow(
        /not a sandbox this driver names/,
      );
      expect(h.substrate.actors.has(foreign)).toBe(true);
    }
  });

  it("skips a sandbox whose upkeep fails, and stops before retiring when asked", async () => {
    const h = harness();
    h.substrate.put({
      name: "sbx-ses-000000000001",
      state: ActorState.DELETING,
      template: "t",
    });
    h.substrate.put({
      name: "sbx-ses-000000000002",
      state: ActorState.DELETING,
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
    ).toEqual({ redeleted: 1, egressReconciled: 0, moved: 0, retired: 0 });
    expect(h.substrate.calls.slice(before)).not.toContain("listTemplates ");
    // A shutdown before the first sandbox touches none.
    h.substrate.put({
      name: "sbx-ses-000000000003",
      state: ActorState.DELETING,
      template: "t",
    });
    const untouched = h.substrate.calls.length;
    expect(
      await h.driver.lifecycle.maintain(await h.driver.lifecycle.list(), {
        stopping: () => true,
      }),
    ).toEqual({ redeleted: 0, egressReconciled: 0, moved: 0, retired: 0 });
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
      state: ActorState.RUNNING,
      template: "stigmer-runner-old",
      policy: [],
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(h.substrate.actors.get(ACTOR)?.policy?.length).toBeGreaterThan(0);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(
      h.substrate.calls.filter((c) => c === `ensureEgressPolicy ${ACTOR}`),
    ).toHaveLength(1);
  });

  it("is reconciled on every wake from storage", async () => {
    const h = harness();
    h.substrate.put({
      name: ACTOR,
      state: ActorState.SUSPENDED,
      template: "stigmer-runner-old",
    });
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    await h.driver.lifecycle.suspend("session", SESSION);
    await h.driver.provisioner.ensureSessionSandbox(SESSION, env);
    expect(
      h.substrate.calls.filter((c) => c === `ensureEgressPolicy ${ACTOR}`),
    ).toHaveLength(2);
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
