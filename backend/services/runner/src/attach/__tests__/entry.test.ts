/**
 * Pins the attach entry (entry.ts): its configuration from the sandbox's
 * environment (defaults, overrides, a refused port), that the waiter reads the
 * sandbox name from the configured file on every push, and that SIGTERM or
 * SIGINT stops the waiter once and then exits 0, or 1 when stopping fails.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { attachEntryConfig, runAttachEntry, type AttachEntryHost } from "../entry.js";
import type { AttachWaiter, AttachWaiterOptions } from "../waiter.js";

describe("attachEntryConfig", () => {
  it("defaults to port 80, the actor-metadata file, and the runner entry beside the attach folder", () => {
    const config = attachEntryConfig({});
    expect(config.port).toBe(80);
    expect(config.sandboxNameFile).toBe("/run/ate/actor-name");
    expect(basename(config.runnerEntry)).toBe("main.js");
    expect(basename(dirname(config.runnerEntry))).not.toBe("attach");
  });

  it("takes the port and the name file from the environment", () => {
    const config = attachEntryConfig({ STIGMER_ATTACH_PORT: "8790", STIGMER_SANDBOX_NAME_FILE: "/tmp/name" });
    expect(config).toMatchObject({ port: 8790, sandboxNameFile: "/tmp/name" });
    expect(attachEntryConfig({ STIGMER_ATTACH_PORT: "", STIGMER_SANDBOX_NAME_FILE: "" })).toMatchObject({
      port: 80,
      sandboxNameFile: "/run/ate/actor-name",
    });
  });

  it("refuses a port that is not one", () => {
    for (const port of ["0", "65536", "eighty", "80.5", "-1"]) {
      expect(() => attachEntryConfig({ STIGMER_ATTACH_PORT: port })).toThrow(/STIGMER_ATTACH_PORT/);
    }
  });
});

describe("runAttachEntry", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function fakeHost() {
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const host: AttachEntryHost = {
      onSignal: (signal, handler) => handlers.set(signal, handler),
      exit: (code) => exits.push(code),
      log: () => {},
    };
    return { host, handlers, exits };
  }

  function fakeWaiter(close: () => Promise<void>): { start: (o: AttachWaiterOptions) => Promise<AttachWaiter>; seen: AttachWaiterOptions[]; closes: () => number } {
    const seen: AttachWaiterOptions[] = [];
    let closes = 0;
    return {
      seen,
      closes: () => closes,
      start: async (options) => {
        seen.push(options);
        return {
          server: undefined as never,
          port: options.port,
          attachedQueue: () => undefined,
          close: () => {
            closes += 1;
            return close();
          },
        };
      },
    };
  }

  it("starts the waiter with the sandbox's environment and reads the name file on every push", async () => {
    dir = mkdtempSync(join(tmpdir(), "attach-entry-"));
    const nameFile = join(dir, "actor-name");
    writeFileSync(nameFile, "sbx-ses-aaaaaaaaaaaa\n");
    const { host } = fakeHost();
    const waiter = fakeWaiter(async () => {});
    const env = { STIGMER_ATTACH_PORT: "8791", STIGMER_SANDBOX_NAME_FILE: nameFile, MODE: "cloud" };
    await runAttachEntry(env, host, waiter.start);
    const options = waiter.seen[0]!;
    expect(options.port).toBe(8791);
    expect(options.baseEnv).toBe(env);
    expect(options.readSandboxName()).toBe("sbx-ses-aaaaaaaaaaaa");
    writeFileSync(nameFile, "sbx-ses-bbbbbbbbbbbb");
    expect(options.readSandboxName()).toBe("sbx-ses-bbbbbbbbbbbb");
  });

  it("stops the waiter once on SIGTERM or SIGINT, then exits 0", async () => {
    const { host, handlers, exits } = fakeHost();
    const waiter = fakeWaiter(async () => {});
    await runAttachEntry({}, host, waiter.start);
    handlers.get("SIGTERM")!();
    handlers.get("SIGINT")!();
    await new Promise((r) => setTimeout(r, 10));
    expect(waiter.closes()).toBe(1);
    expect(exits).toEqual([0]);
  });

  it("exits 1 when stopping fails", async () => {
    const { host, handlers, exits } = fakeHost();
    const waiter = fakeWaiter(async () => {
      throw new Error("child would not stop");
    });
    await runAttachEntry({}, host, waiter.start);
    handlers.get("SIGINT")!();
    await new Promise((r) => setTimeout(r, 10));
    expect(exits).toEqual([1]);
  });

  it("refuses to start on an unusable port", async () => {
    const { host } = fakeHost();
    const waiter = fakeWaiter(async () => {});
    await expect(runAttachEntry({ STIGMER_ATTACH_PORT: "nope" }, host, waiter.start)).rejects.toThrow(/STIGMER_ATTACH_PORT/);
    expect(waiter.seen).toEqual([]);
  });
});
