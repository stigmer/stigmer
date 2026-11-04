// run()'s options: what an embedder passes beside the Config reaches the
// backend target every tool handler shares.
//
// The server module is mocked so the test reads the target run() builds for
// stdio without owning the process's stdin and stdout. It pins that a token
// provider given to run() is put on the target, and that without one the
// target carries the Config's API key alone, as before options existed. What
// the target then does with a provider is pinned by credential.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfigFromEnv } from "../config";
import type { BackendTarget } from "../domains/client";

const targets: BackendTarget[] = [];

vi.mock("../server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server.js")>();
  return {
    ...actual,
    stdioServer: (target: BackendTarget) => {
      targets.push(target);
      return {};
    },
    serveStdio: async () => undefined,
  };
});

const { run } = await import("../index");

afterEach(() => {
  targets.length = 0;
});

describe("run() options", () => {
  it("puts the embedder's token provider on the stdio target", async () => {
    const getAccessToken = async (): Promise<string | null> => "fresh";
    await run(
      { ...loadConfigFromEnv({}), apiKey: "", logLevel: "error" },
      new AbortController().signal,
      { getAccessToken },
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]?.getAccessToken).toBe(getAccessToken);
  });

  it("leaves the target on the Config's API key when no provider is given", async () => {
    await run(
      { ...loadConfigFromEnv({}), apiKey: "fixed", logLevel: "error" },
      new AbortController().signal,
    );
    expect(targets[0]).toEqual({ serverAddress: expect.any(String), apiKey: "fixed" });
    expect(targets[0] && "getAccessToken" in targets[0]).toBe(false);
  });
});
