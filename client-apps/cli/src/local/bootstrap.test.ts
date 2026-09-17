// Pins the bootstrap's shape: the seedpack step then the default-plugins step,
// over one client; a seedpack failure is contained by its own step and the
// plugins step still runs; a plugins failure is a warning that names the
// retry command, never a throw past the bootstrap.

import { describe, expect, it } from "vitest";
import type { BackendClient } from "../client/index.js";
import {
  bootstrapLocalBackend,
  installDefaultPluginsBestEffort,
} from "./bootstrap.js";

const client = { stigmer: {} } as unknown as BackendClient;

describe("bootstrapLocalBackend", () => {
  it("runs the seedpack step then the plugins step, over the same client and home", async () => {
    const order: string[] = [];
    await bootstrapLocalBackend("/home/x", {
      client,
      say: () => {},
      seedpack: async (c, home) => {
        expect(c).toBe(client);
        expect(home).toBe("/home/x");
        order.push("seedpack");
      },
      plugins: async (c, home) => {
        expect(c).toBe(client);
        expect(home).toBe("/home/x");
        order.push("plugins");
      },
    });
    expect(order).toEqual(["seedpack", "plugins"]);
  });

  it("still runs the plugins step when the seedpack step has warned", async () => {
    const said: string[] = [];
    let plugins = 0;
    await bootstrapLocalBackend("/home/x", {
      client,
      say: (line) => said.push(line),
      seedpack: async (_c, _h, say) => say("Warning: seedpack failed"),
      plugins: async () => {
        plugins += 1;
      },
    });
    expect(plugins).toBe(1);
    expect(said).toEqual(["Warning: seedpack failed"]);
  });
});

describe("installDefaultPluginsBestEffort", () => {
  it("turns a step that cannot even start into one warning naming the retry commands", async () => {
    const said: string[] = [];
    // A client whose plugin lookups throw: the step's own failure path, not a default's.
    const broken = {
      stigmer: {
        plugin: {
          getByReference: async () => {
            throw new Error("backend unreachable");
          },
        },
      },
    } as unknown as BackendClient;
    await installDefaultPluginsBestEffort(broken, "/home/x", (line) =>
      said.push(line),
    );
    expect(said.filter((line) => line.startsWith("Warning:"))).toEqual([
      "Warning: failed to install default plugin 'assistant'. Run 'stigmer install assistant' to retry.",
    ]);
  });
});
