import { describe, it, expect } from "vitest";
import { mapManagerOptionsToConfig } from "../runner-manager.js";
import type { RunnerManagerOptions } from "../runner-manager.js";
import type { TokenRef } from "../config.js";

/**
 * The manager maps its options into a runner {@link Config}. The critical
 * invariant these tests lock is that execution location (`mode`) is decoupled
 * from credential transport (`proxyEndpoint`): the desktop runner executes
 * LOCALLY while still routing Cursor traffic through the proxy. Re-coupling the
 * two previously broke local-path workspace sessions. The second invariant:
 * the config carries the root's credential REFS and no credential by value,
 * so a rotation the root writes is what every reader sees (config.ts header).
 */
describe("mapManagerOptionsToConfig", () => {
  const base: RunnerManagerOptions = {
    temporalAddress: "localhost:7233",
    stigmerEndpoint: "http://localhost:7234",
  };
  const refs = (): [TokenRef, TokenRef] => [{ current: null }, { current: null }];

  it("defaults mode to local when executionMode is unset", () => {
    const config = mapManagerOptionsToConfig(base, ...refs());
    expect(config.mode).toBe("local");
  });

  it("stays local with a proxy endpoint set (the desktop case)", () => {
    const config = mapManagerOptionsToConfig({
      ...base,
      proxyEndpoint: "https://localhost:9090",
      stigmerToken: "tok",
    }, ...refs());
    expect(config.mode).toBe("local");
    expect(config.proxyEndpoint).toBe("https://localhost:9090");
    // Proxy transport still engages independently of execution location.
    expect(config.cursorApiKey).toBe("proxy-managed");
    expect(config.checkpointerType).toBe("http");
  });

  it("binds the proxy credential to the runner-token ref, never the control-plane ref", () => {
    const tokenRef = { current: "control-plane-token" };
    const runnerTokenRef = { current: "control-plane-token" };
    const config = mapManagerOptionsToConfig(
      { ...base, proxyEndpoint: "https://localhost:9090", stigmerToken: "control-plane-token" },
      tokenRef,
      runnerTokenRef,
    );
    expect(config.proxyTokenRef).toBe(runnerTokenRef);
    expect(config.stigmerRunnerTokenRef).toBe(runnerTokenRef);
    expect(config.stigmerTokenRef).toBe(tokenRef);

    // After the mint the two refs diverge; the proxy credential follows the mint.
    runnerTokenRef.current = "minted-runner-token";
    expect(config.proxyTokenRef?.current).toBe("minted-runner-token");
    expect(config.stigmerTokenRef.current).toBe("control-plane-token");
  });

  it("carries the control-plane credential as the root's ref and nowhere by value: a rotation the root writes is what a reader sees", () => {
    const tokenRef: TokenRef = { current: "boot-credential" };
    const runnerTokenRef: TokenRef = { current: "boot-credential" };
    const config = mapManagerOptionsToConfig(
      { ...base, proxyEndpoint: "https://localhost:9090", stigmerToken: "boot-credential" },
      tokenRef,
      runnerTokenRef,
    );
    expect(config.stigmerTokenRef).toBe(tokenRef);
    expect(config.cursorApiKey).toBe("proxy-managed");

    // The pre-mint lockstep the coordinator keeps: one rotation writes both refs.
    tokenRef.current = "session-credential";
    runnerTokenRef.current = "session-credential";
    expect(config.stigmerTokenRef.current).toBe("session-credential");
    expect(JSON.stringify(config)).not.toContain("boot-credential");
  });

  it("uses cloud only when executionMode is explicitly cloud", () => {
    const config = mapManagerOptionsToConfig({
      ...base,
      executionMode: "cloud",
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    }, ...refs());
    expect(config.mode).toBe("cloud");
  });

  it("honors explicit local executionMode even with a proxy", () => {
    const config = mapManagerOptionsToConfig({
      ...base,
      executionMode: "local",
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    }, ...refs());
    expect(config.mode).toBe("local");
  });
});
