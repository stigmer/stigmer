// The enforcing lane of an EXECUTION target: the open-source sibling in the
// OIDC posture, beside its own engine, with a runner keyed the way the
// Helm chart keys one — see TargetProfile.enforcingLane and
// CapabilityFlags.runnerActsAsRunCreator.
// Domain: conformance harness (execution engine).
//
// A Class A enforcing lane (enforcing-lane.ts) proves what an authorization
// arm can read over the wire: who may create, read, grant. It cannot show
// what happens when a RUN is dispatched under enforcement, because nothing
// polls its Temporal — it has none. This lane is that lane with an engine
// behind it, the same relationship `local-execution` has to `local`:
//
//   1. the people lane boots the issuer and the sibling — through the
//      target's spawnSibling, which on an execution target brings its own
//      Temporal (SiblingExecutionServer) — and provisions the founder;
//   2. the founder mints an API key in an organization of their own: the
//      "signed-in operator mints the runner's key" step of the chart's
//      two-step install, driven by the harness instead of a person;
//   3. a runner boots against the sibling's engine, its unified port and
//      its artifact store, keyed with that key as its ONE token (the runner
//      has one token variable for the proxy bearer and the control-plane
//      credential alike), dialing a mock LLM this lane owns.
//
// What the arms then see is the contract this lane exists for: a run a
// MEMBER dispatches is served by a runner whose process credential is the
// operator's, and it completes and reports as the member, because the
// server minted the run its own credential at dispatch and the runner
// presents it. Nothing about people is written here twice — provisioning,
// revocation and roles are the people lane's, composed, not copied.
//
// The mock is the lane's own, never the primary's: one FIFO per runner, so
// a title call the sibling's runner makes in the background can never eat
// a turn a suite queued for the primary. The runner's key is deliberately
// NOT on the lane's surface — an arm that needs "an API key alone" mints
// one as the founder; the contract is about any key, not this one.
//
// Boot is five processes (issuer, Temporal, server, mock, runner) inside
// one suite hook, and the readiness gates each process already has are the
// only ones. The lane prints its boot durations once, so a hook timeout on
// a loaded machine reads as the boot reading it is and not as an arm.
import type {
  EnforcingLane,
  SiblingExecutionServer,
  SpawnSiblingOptions,
} from "../targets/target";
import { makeApiKey, plaintextKeyOf } from "../support/apikeys";
import { uniqueName } from "../support/naming";

import {
  newSiblingEnforcingLane,
  type SiblingEnforcingLane,
} from "./enforcing-lane";
import { MockLlmProxy } from "./mock-llm";
import { ensureRunnerBuilt } from "./runner-build";
import { spawnRunner, type RunningRunner } from "./runner-process";

export interface SiblingEnforcingExecutionLaneDeps {
  // The target's own sibling spawn: an OIDC-posture server WITH its own
  // engine and storage, so the lane never learns how a server or a Temporal
  // is booted.
  spawnSibling(options: SpawnSiblingOptions): Promise<SiblingExecutionServer>;
}

// How long each half of the boot took, in milliseconds: the people lane
// (issuer, Temporal, server, founder) and the runner side (key, mock,
// runner). Reported, never asserted — a reading, not a contract.
export interface LaneBootReading {
  readonly peopleMs: number;
  readonly runnerMs: number;
}

// The one line the lane prints after boot. Pure, so the unit arm pins its
// shape; it must carry both readings and say what a slow one means, because
// the only other trace of a slow boot is a vitest hook timeout with no
// reading at all.
export function describeLaneBoot(reading: LaneBootReading): string {
  const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
  return (
    `[enforcing-execution-lane] booted: issuer + engine + server + founder in ${seconds(reading.peopleMs)}, ` +
    `key + mock + runner in ${seconds(reading.runnerMs)} — a slow reading here is the machine's load, not an arm`
  );
}

export async function newSiblingEnforcingExecutionLane(
  deps: SiblingEnforcingExecutionLaneDeps,
): Promise<SiblingEnforcingLane> {
  const bootStartedAt = Date.now();

  // The people lane spawns the sibling through us so we can keep the
  // engine-bearing handle it does not know it holds.
  let spawned: SiblingExecutionServer | undefined;
  const people = await newSiblingEnforcingLane({
    async spawnSibling(options) {
      spawned = await deps.spawnSibling(options);
      return spawned;
    },
  });
  if (spawned === undefined) {
    await people.close();
    throw new Error(
      "the people lane returned without spawning a sibling; the execution lane has no engine to boot a runner against",
    );
  }
  const sibling = spawned;
  const peopleReadyAt = Date.now();

  const mock = new MockLlmProxy();
  let runner: RunningRunner | undefined;
  try {
    // The operator's key: minted by the founder in an organization of their
    // own, exactly as the chart's install asks a signed-in operator to do.
    // Newcomers the people lane provisions are revoked on this organization
    // like every other the founder holds, so no arm ever meets it.
    const home = await people.lane.provisionTenancy();
    const key = plaintextKeyOf(
      await people.lane.clients.apiKeyCommand.create(
        makeApiKey({ org: home.org, name: uniqueName("runner-key") }),
      ),
    );

    await mock.start();
    runner = await spawnRunner({
      entryPath: await ensureRunnerBuilt(),
      temporalHostPort: sibling.engine.temporalHostPort,
      backendEndpoint: sibling.engine.serverBaseUrl,
      // The sibling serves the model registry on its unified port, as the
      // primary does for its runner (runner-process.ts, registryOrigin).
      registryOrigin: sibling.engine.serverBaseUrl,
      proxy: { endpoint: mock.url(), token: key },
      artifactDir: sibling.artifactStore.dir,
      artifactServeUrl: sibling.artifactStore.serveUrl,
    });
  } catch (error) {
    await runner?.stop().catch(() => undefined);
    await mock.close().catch(() => undefined);
    await people.close().catch(() => undefined);
    throw error;
  }
  const running = runner;

  console.info(
    describeLaneBoot({
      peopleMs: peopleReadyAt - bootStartedAt,
      runnerMs: Date.now() - peopleReadyAt,
    }),
  );

  const lane: EnforcingLane = {
    ...people.lane,
    llmProxy: () => mock,
  };

  return {
    lane,
    // Reverse boot order: the runner (it streams to the server), the mock,
    // then the people lane's own close (server, storage, Temporal, issuer).
    async close() {
      await running.stop();
      await mock.close();
      await people.close();
    },
  };
}
