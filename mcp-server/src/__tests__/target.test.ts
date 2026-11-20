// The backend target run() serves with (target.ts): the shared-disk switch
// reaches it only when the embedder passes it, and never by default, so a
// server started without it, the hosted one among them, reads no path.

import { describe, expect, it } from "vitest";

import type { Config } from "../config";
import { loadConfigFromEnv } from "../config";
import { backendTargetOf } from "../target";

const cfg: Config = { ...loadConfigFromEnv(), stigmerServerAddress: "127.0.0.1:1", apiKey: "key" };

describe("backendTargetOf", () => {
  it("carries the embedder's shared-disk switch and token provider", () => {
    const getAccessToken = () => "tok";
    expect(backendTargetOf(cfg, { localFiles: true, getAccessToken })).toEqual({
      serverAddress: "127.0.0.1:1",
      apiKey: "key",
      getAccessToken,
      localFiles: true,
    });
  });

  it("shares no disk unless asked", () => {
    expect(backendTargetOf(cfg)).toEqual({ serverAddress: "127.0.0.1:1", apiKey: "key" });
    expect(backendTargetOf(cfg, { localFiles: false }).localFiles).toBeUndefined();
  });
});
