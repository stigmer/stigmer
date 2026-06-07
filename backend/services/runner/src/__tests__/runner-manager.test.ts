import { describe, it, expect } from "vitest";
import { mapManagerOptionsToConfig } from "../runner-manager.js";
import type { RunnerManagerOptions } from "../runner-manager.js";

/**
 * The manager maps its options into a runner {@link Config}. The critical
 * invariant these tests lock is that execution location (`mode`) is decoupled
 * from credential transport (`proxyEndpoint`): the desktop runner executes
 * LOCALLY while still routing Cursor traffic through the proxy. Re-coupling the
 * two previously broke local-path workspace sessions.
 */
describe("mapManagerOptionsToConfig", () => {
  const base: RunnerManagerOptions = {
    temporalAddress: "localhost:7233",
    stigmerEndpoint: "http://localhost:7234",
  };

  it("defaults mode to local when executionMode is unset", () => {
    const config = mapManagerOptionsToConfig(base);
    expect(config.mode).toBe("local");
  });

  it("stays local with a proxy endpoint set (the desktop case)", () => {
    const config = mapManagerOptionsToConfig({
      ...base,
      proxyEndpoint: "https://localhost:9090",
      stigmerToken: "tok",
    });
    expect(config.mode).toBe("local");
    expect(config.proxyEndpoint).toBe("https://localhost:9090");
    // Proxy transport still engages independently of execution location.
    expect(config.cursorApiKey).toBe("proxy-managed");
    expect(config.checkpointerType).toBe("http");
  });

  it("uses cloud only when executionMode is explicitly cloud", () => {
    const config = mapManagerOptionsToConfig({
      ...base,
      executionMode: "cloud",
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    });
    expect(config.mode).toBe("cloud");
  });

  it("honors explicit local executionMode even with a proxy", () => {
    const config = mapManagerOptionsToConfig({
      ...base,
      executionMode: "local",
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    });
    expect(config.mode).toBe("local");
  });
});
