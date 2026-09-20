// Pins the local bootstrap's shape: prepare, then run, over one client; a
// preparation failure skips the run with one warning naming the retry; a
// run that cannot start is one warning; a default that failed to land is one
// warning per default naming `stigmer bootstrap`; nothing throws past the
// bootstrap.

import { describe, expect, it } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import type { BackendClient } from "../client/index.js";
import {
  type BootstrapResult,
  type PreparedBootstrap,
  bootstrapLocalBackend,
} from "./bootstrap.js";

const stigmer = {} as unknown as Stigmer;
const client = { stigmer } as unknown as BackendClient;
const prepared: PreparedBootstrap = { defaults: [] };

function converged(): BootstrapResult {
  return { org: "present", plugins: { outcomes: [], failed: [] } };
}

describe("bootstrapLocalBackend", () => {
  it("prepares, then runs, over the same client", async () => {
    const order: string[] = [];
    await bootstrapLocalBackend({
      client,
      say: () => {},
      prepare: async () => {
        order.push("prepare");
        return prepared;
      },
      run: async (s, p) => {
        expect(s).toBe(stigmer);
        expect(p).toBe(prepared);
        order.push("run");
        return converged();
      },
    });
    expect(order).toEqual(["prepare", "run"]);
  });

  it("skips the run when preparation fails, with one warning", async () => {
    const said: string[] = [];
    let ran = 0;
    await bootstrapLocalBackend({
      client,
      say: (line) => said.push(line),
      prepare: async () => {
        throw new Error("offline");
      },
      run: async () => {
        ran += 1;
        return converged();
      },
    });
    expect(ran).toBe(0);
    expect(said).toEqual([
      "Warning: could not prepare the default plugins, so the local backend was not bootstrapped. Run 'stigmer up' again to retry.",
    ]);
  });

  it("contains a run that cannot start in one warning naming the retry", async () => {
    const said: string[] = [];
    await bootstrapLocalBackend({
      client,
      say: (line) => said.push(line),
      prepare: async () => prepared,
      run: async () => {
        throw new Error("backend unreachable");
      },
    });
    expect(said).toEqual([
      "Warning: failed to bootstrap the local backend. Run 'stigmer up' again to retry.",
    ]);
  });

  it("names each default that did not land and the verb that retries it", async () => {
    const said: string[] = [];
    await bootstrapLocalBackend({
      client,
      say: (line) => said.push(line),
      prepare: async () => prepared,
      run: async () => ({
        org: "created",
        plugins: {
          outcomes: [
            { name: "assistant", action: "failed", error: "refused" },
          ],
          failed: ["assistant"],
        },
      }),
    });
    expect(said).toEqual([
      "Warning: failed to install default plugin 'assistant'. Run 'stigmer bootstrap' to retry.",
    ]);
  });
});
