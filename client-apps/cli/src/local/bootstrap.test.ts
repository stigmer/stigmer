// Pins the local bootstrap's shape: prepare, then retire, then run, over one
// client; a preparation failure skips the retire and the run together (nothing
// is deleted before its replacement is in hand); a retire failure is contained
// by its own warning and the run still happens; a default that failed to
// land is one warning naming `stigmer bootstrap`; nothing throws past the
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
  it("prepares, retires, then runs, over the same client and home", async () => {
    const order: string[] = [];
    await bootstrapLocalBackend("/home/x", {
      client,
      say: () => {},
      prepare: async () => {
        order.push("prepare");
        return prepared;
      },
      retire: async (s, home) => {
        expect(s).toBe(stigmer);
        expect(home).toBe("/home/x");
        order.push("retire");
      },
      run: async (s, p) => {
        expect(s).toBe(stigmer);
        expect(p).toBe(prepared);
        order.push("run");
        return converged();
      },
    });
    expect(order).toEqual(["prepare", "retire", "run"]);
  });

  it("skips the retire and the run when preparation fails, with one warning", async () => {
    const said: string[] = [];
    let retired = 0;
    let ran = 0;
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      prepare: async () => {
        throw new Error("offline");
      },
      retire: async () => {
        retired += 1;
      },
      run: async () => {
        ran += 1;
        return converged();
      },
    });
    expect(retired).toBe(0);
    expect(ran).toBe(0);
    expect(said).toEqual([
      "Warning: could not prepare the default plugins, so the local backend was not bootstrapped and nothing was retired. Run 'stigmer up' again to retry.",
    ]);
  });

  it("still runs when the retire step threw, and warns once for it", async () => {
    const said: string[] = [];
    let ran = 0;
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      prepare: async () => prepared,
      retire: async () => {
        throw new Error("project read failed");
      },
      run: async () => {
        ran += 1;
        return converged();
      },
    });
    expect(ran).toBe(1);
    expect(said).toEqual([
      "Warning: failed to retire the resources an older release installed. Run 'stigmer up' again to retry.",
    ]);
  });

  it("names each default that did not land and the verb that retries it", async () => {
    const said: string[] = [];
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      prepare: async () => prepared,
      retire: async () => {},
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

  it("turns a run that cannot even start into one warning naming the verb", async () => {
    const said: string[] = [];
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      prepare: async () => prepared,
      retire: async () => {},
      run: async () => {
        throw new Error("backend unreachable");
      },
    });
    expect(said).toEqual([
      "Warning: failed to bootstrap the local backend. Run 'stigmer bootstrap' to retry.",
    ]);
  });
});
