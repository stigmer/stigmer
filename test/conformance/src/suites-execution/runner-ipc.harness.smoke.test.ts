// Execution-engine harness smoke for the runner's MANAGER-MODE IPC handshake.
// Domain: runner embedding — the stdin/stdout protocol a host (the desktop's
// Rust crate) drives the runner through; not a gRPC contract, hence a smoke.
//
// The runner's ipc-protocol.ts is the canonical definition; the Rust host
// crate hand-mirrors it, kept honest by golden fixtures (make gen-ipc-fixtures).
// What neither the fixtures nor the runner's unit arms can prove is that the
// REAL runner process, booted the way a host boots it, writes the `ready` line
// with the version the hosts negotiate on and answers `shutdown` — `ready` is
// sent only after the manager has connected to Temporal (main.ts), so the arm
// belongs where Temporal is: the execution class. Entry 20260910.02, ruling 3;
// the Go harness's TestOffline_RunnerManager_AdvertisesProtocolVersion.
//
// The smoke boots a SECOND runner beside the target's static one: the static
// runner serves the file's engine, this one is the subject. It needs the
// target's Temporal address and server URL, which the local execution target
// exposes through `engineCoordinates()`; the cloud targets, whose runner
// discovers Temporal through the control plane, do not, and the file reports
// SKIPPED there.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IPC_PROTOCOL_VERSION } from "../../../../backend/services/runner/src/ipc-protocol";
import { ensureRunnerBuilt } from "../harness/runner-build";
import { spawnManagerRunner, type ManagerRunner } from "../harness/runner-manager-process";
import { createTarget, type TargetProfile } from "../targets";

const hasEngineCoordinates = createTarget().engineCoordinates !== undefined;

let target: TargetProfile;
let manager: ManagerRunner | undefined;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
});

afterAll(async () => {
  await manager?.stop();
  await target?.teardown();
});

describe.skipIf(!hasEngineCoordinates)("Runner manager-mode IPC — handshake", () => {
  it("a manager-mode runner advertises protocol version 1 in its ready handshake and answers shutdown with shutdownComplete", async () => {
    const coordinates = target.engineCoordinates!();
    manager = await spawnManagerRunner({
      entryPath: await ensureRunnerBuilt(),
      temporalHostPort: coordinates.temporalHostPort,
      backendEndpoint: coordinates.serverBaseUrl,
      registryOrigin: coordinates.serverBaseUrl,
    });

    expect(manager.ready.type).toBe("ready");
    expect(manager.ready.protocolVersion, "the version the hosts negotiate on").toBe(IPC_PROTOCOL_VERSION);
    expect(manager.ready.protocolVersion).toBe(1);

    manager.send({ type: "shutdown" });
    const response = await manager.nextResponse("shutdownComplete");
    expect(response.type).toBe("shutdownComplete");
  });
});
