// run() over HTTP: the standalone transports mount the stateless handler.
//
// Pins that run() in "http" and "both" modes starts on an ephemeral port and
// stops cleanly when its signal aborts; the routes themselves are pinned by
// http.test.ts through the same handler.

import { describe, expect, it } from "vitest";

import { loadConfigFromEnv, type Config } from "../config";
import { run } from "../index";

function config(transport: Config["transport"]): Config {
  return { ...loadConfigFromEnv({}), transport, httpPort: "0", logLevel: "error" };
}

describe("run() over HTTP", () => {
  it.each(["http", "both"] as const)("serves %s and stops on abort", async (transport) => {
    const controller = new AbortController();
    const running = run(config(transport), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await expect(running).resolves.toBeUndefined();
  });
});
