// Pins the local bootstrap's shape: prepare, then run, then retire, over one
// client; a preparation failure skips the run and the retire together, and a
// run that cannot start skips the retire (nothing is deleted before its
// replacement is in place); a default that failed to land is one warning
// naming `stigmer bootstrap` and holds the retire back with a line saying so;
// a retire failure is contained by its own warning; nothing throws past the
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
  it("prepares, runs, then retires, over the same client and home", async () => {
    const order: string[] = [];
    await bootstrapLocalBackend("/home/x", {
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
      retire: async (s, home) => {
        expect(s).toBe(stigmer);
        expect(home).toBe("/home/x");
        order.push("retire");
      },
    });
    expect(order).toEqual(["prepare", "run", "retire"]);
  });

  it("skips the run and the retire when preparation fails, with one warning", async () => {
    const said: string[] = [];
    let retired = 0;
    let ran = 0;
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      prepare: async () => {
        throw new Error("offline");
      },
      run: async () => {
        ran += 1;
        return converged();
      },
      retire: async () => {
        retired += 1;
      },
    });
    expect(ran).toBe(0);
    expect(retired).toBe(0);
    expect(said).toEqual([
      "Warning: could not prepare the default plugins, so the local backend was not bootstrapped and nothing was retired. Run 'stigmer up' again to retry.",
    ]);
  });

  it("skips the retire when the run cannot even start, with one warning naming the retry", async () => {
    const said: string[] = [];
    let retired = 0;
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      prepare: async () => prepared,
      run: async () => {
        throw new Error("backend unreachable");
      },
      retire: async () => {
        retired += 1;
      },
    });
    expect(retired).toBe(0);
    expect(said).toEqual([
      "Warning: failed to bootstrap the local backend, so nothing was retired. Run 'stigmer up' again to retry.",
    ]);
  });

  it("holds the retire back when a default did not land, naming the default and saying why", async () => {
    const said: string[] = [];
    let retired = 0;
    await bootstrapLocalBackend("/home/x", {
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
      retire: async () => {
        retired += 1;
      },
    });
    expect(retired).toBe(0);
    expect(said).toEqual([
      "Warning: failed to install default plugin 'assistant'. Run 'stigmer bootstrap' to retry.",
      "Nothing was retired: the resources an older release installed stay until every default plugin is in place.",
    ]);
  });

  it("contains a retire that threw in one warning, after the run succeeded", async () => {
    const said: string[] = [];
    let ran = 0;
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      prepare: async () => prepared,
      run: async () => {
        ran += 1;
        return converged();
      },
      retire: async () => {
        throw new Error("project read failed");
      },
    });
    expect(ran).toBe(1);
    expect(said).toEqual([
      "Warning: failed to retire the resources an older release installed. Run 'stigmer up' again to retry.",
    ]);
  });
});
