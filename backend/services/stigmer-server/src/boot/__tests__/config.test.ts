/**
 * Pins the config loader's env semantics to Go's (pkg/config/config.go
 * getEnvInt/getEnvString): defaults on absence, defaults on malformed
 * values (silently — Go's shipped leniency is contract), explicit values
 * win. The model-registry refresh switch is only disabled by the literal
 * "off" (model_registry_store.go).
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRPC_PORT,
  DEFAULT_MODEL_REGISTRY_UPSTREAM,
  loadConfig,
} from "../config.js";

describe("loadConfig", () => {
  it("returns Go's defaults for an empty environment", () => {
    const config = loadConfig({});
    expect(config.grpcPort).toBe(DEFAULT_GRPC_PORT);
    expect(config.logLevel).toBe("info");
    expect(config.env).toBe("local");
    expect(config.modelRegistryUpstream).toBe(DEFAULT_MODEL_REGISTRY_UPSTREAM);
    expect(config.modelRegistryRefreshEnabled).toBe(true);
  });

  it("reads explicit values", () => {
    const config = loadConfig({
      GRPC_PORT: "9000",
      LOG_LEVEL: "debug",
      ENV: "production",
      STIGMER_MODEL_REGISTRY_UPSTREAM: "http://127.0.0.1:1234",
    });
    expect(config.grpcPort).toBe(9000);
    expect(config.logLevel).toBe("debug");
    expect(config.env).toBe("production");
    expect(config.modelRegistryUpstream).toBe("http://127.0.0.1:1234");
  });

  it.each([
    ["not-a-number", DEFAULT_GRPC_PORT],
    ["7234x", DEFAULT_GRPC_PORT],
    ["", DEFAULT_GRPC_PORT],
  ])(
    "falls back on malformed GRPC_PORT %j exactly as Go's getEnvInt",
    (raw, expected) => {
      expect(loadConfig({ GRPC_PORT: raw }).grpcPort).toBe(expected);
    },
  );

  it("treats empty-string env values as absent (Go's getEnvString)", () => {
    expect(loadConfig({ LOG_LEVEL: "" }).logLevel).toBe("info");
  });

  // DD-013 / Phase-2 P4: the loopback default is the retired Go server's
  // posture and must survive any future refactor — a changed default would
  // silently expose every bare-metal install's artifact lane.
  it("defaults the artifact file server host to loopback", () => {
    expect(loadConfig({}).artifactHttpHost).toBe("127.0.0.1");
  });

  it("reads an explicit ARTIFACT_HTTP_HOST (the container override)", () => {
    expect(
      loadConfig({ ARTIFACT_HTTP_HOST: "0.0.0.0" }).artifactHttpHost,
    ).toBe("0.0.0.0");
    // Empty string is absent, per the Go getEnvString leniency.
    expect(loadConfig({ ARTIFACT_HTTP_HOST: "" }).artifactHttpHost).toBe(
      "127.0.0.1",
    );
  });

  it("disables the model-registry refresh only for the literal 'off'", () => {
    expect(
      loadConfig({ STIGMER_MODEL_REGISTRY_REFRESH: "off" })
        .modelRegistryRefreshEnabled,
    ).toBe(false);
    expect(
      loadConfig({ STIGMER_MODEL_REGISTRY_REFRESH: "false" })
        .modelRegistryRefreshEnabled,
    ).toBe(true);
    expect(loadConfig({}).modelRegistryRefreshEnabled).toBe(true);
  });
});
