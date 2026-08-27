/**
 * Integration smoke for the local-process driver (§6d, O6): real child
 * processes, the full ensure → fast-path → probe → deprovision cycle,
 * and the env contract the runner reads (config.ts's variables) —
 * proven by a stand-in script that dumps its environment where the test
 * can read it, so no real runner install is needed.
 *
 * Unix-only like the runner itself; deterministic (poll with timeout,
 * never sleep).
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { newLocalProcessSandboxProvisioner } from "../local-process.js";
import type { SandboxDriverConfig } from "../provisioner.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

describe.skipIf(process.platform === "win32")(
  "local-process driver (integration)",
  () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sbx-localproc-"));
    // The stand-in runner: records its environment, then stays alive
    // polling like a worker would (the driver kills it on deprovision).
    const script = path.join(dir, "fake-runner.sh");
    writeFileSync(
      script,
      `#!/bin/sh\nenv > "${dir}/env-$$.dump"\necho "$$" >> "${dir}/spawns.log"\nwhile true; do sleep 1; done\n`,
    );
    chmodSync(script, 0o755);

    const config: SandboxDriverConfig = {
      backendEndpoint: "http://127.0.0.1:7234",
      temporalAddress: "127.0.0.1:7233",
      runnerImage: "unused-by-this-driver",
      runnerCommand: script,
      kubernetesNamespace: "unused-by-this-driver",
    };
    const driver = newLocalProcessSandboxProvisioner({
      config,
      logger: silentLogger,
    });

    afterAll(async () => {
      await driver.deprovisionSessionSandbox("ses_smoke");
      rmSync(dir, { recursive: true, force: true });
    });

    function spawnCount(): number {
      const log = path.join(dir, "spawns.log");
      if (!existsSync(log)) {
        return 0;
      }
      return readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
        .length;
    }

    it("ensure spawns once, injects the runner env contract, and is idempotent", async () => {
      await driver.ensureSessionSandbox("ses_smoke", {
        taskQueue: "session:ses_smoke",
        stigmerToken: "tok-smoke",
      });
      await vi.waitFor(() => expect(spawnCount()).toBe(1));
      expect(await driver.probe("session", "ses_smoke")).toBe("running");

      // Fast path: a second ensure must not spawn a second process.
      await driver.ensureSessionSandbox("ses_smoke", {
        taskQueue: "session:ses_smoke",
        stigmerToken: "tok-smoke",
      });
      expect(spawnCount()).toBe(1);

      // The env dump carries the contract the runner's config.ts reads.
      const dumpName = readFileSync(path.join(dir, "spawns.log"), "utf8")
        .trim()
        .split("\n")[0];
      const dump = readFileSync(path.join(dir, `env-${dumpName}.dump`), "utf8");
      expect(dump).toContain("MODE=local");
      expect(dump).toContain("STIGMER_TASK_QUEUE=session:ses_smoke");
      expect(dump).toContain("STIGMER_TOKEN=tok-smoke");
      expect(dump).toContain(
        `STIGMER_BACKEND_ENDPOINT=${config.backendEndpoint}`,
      );
      expect(dump).toContain(
        `TEMPORAL_SERVICE_ADDRESS=${config.temporalAddress}`,
      );
      expect(dump).toMatch(/WORKSPACE_ROOT_DIR=.+session-ses_smoke/);
    });

    it("deprovision kills the child; probe reports absent; re-ensure respawns", async () => {
      await driver.deprovisionSessionSandbox("ses_smoke");
      await vi.waitFor(async () => {
        expect(await driver.probe("session", "ses_smoke")).toBe("absent");
      });

      // The repair arm without stored state: a fresh ensure respawns.
      await driver.ensureSessionSandbox("ses_smoke", {
        taskQueue: "session:ses_smoke",
        stigmerToken: "",
      });
      await vi.waitFor(() => expect(spawnCount()).toBe(2));
      expect(await driver.probe("session", "ses_smoke")).toBe("running");
    });

    it("deprovision of an absent sandbox is success (idempotent)", async () => {
      await driver.deprovisionWorkflowSandbox("wfx_never_existed");
    });
  },
);
