/**
 * Pins the config loader's env semantics to Go's (pkg/config/config.go
 * getEnvInt/getEnvString): defaults on absence, defaults on malformed
 * values (silently — Go's shipped leniency is contract), explicit values
 * win. The model-registry refresh switch is only disabled by the literal
 * "off" (model_registry_store.go), and the ready line is only turned on by
 * the literal "stdout". The Temporal connection settings are
 * the security exception: their reader (`@stigmer/temporal-codecs`) fails
 * the boot on a contradiction, and its own suite pins each rule; here the
 * config only has to carry its result.
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
    expect(loadConfig({ ARTIFACT_HTTP_HOST: "0.0.0.0" }).artifactHttpHost).toBe(
      "0.0.0.0",
    );
    // Empty string is absent, per the Go getEnvString leniency.
    expect(loadConfig({ ARTIFACT_HTTP_HOST: "" }).artifactHttpHost).toBe(
      "127.0.0.1",
    );
  });

  // stigmer#1089: the artifact lane's port and serve URL follow the unified
  // port the composition binds (boot/artifact-lane.ts), so the loader keeps
  // only what the operator set and derives nothing.
  it("leaves an unset or malformed ARTIFACT_HTTP_PORT unset, for the lane to derive", () => {
    expect(loadConfig({}).artifactHttpPort).toBeUndefined();
    expect(loadConfig({ GRPC_PORT: "0" }).artifactHttpPort).toBeUndefined();
    expect(loadConfig({ ARTIFACT_HTTP_PORT: "7300x" }).artifactHttpPort).toBeUndefined();
    expect(loadConfig({ ARTIFACT_HTTP_PORT: "7300" }).artifactHttpPort).toBe(7300);
    expect(loadConfig({ ARTIFACT_HTTP_PORT: "0" }).artifactHttpPort).toBe(0);
  });

  it("leaves an unset ARTIFACT_LOCAL_SERVE_URL empty, for the bound lane to answer", () => {
    expect(loadConfig({}).artifactLocalServeUrl).toBe("");
    expect(
      loadConfig({ ARTIFACT_LOCAL_SERVE_URL: "https://artifacts.stigmer.test" })
        .artifactLocalServeUrl,
    ).toBe("https://artifacts.stigmer.test");
  });

  // 20260913.02 (sp.console-login, Q-CL-1): the console's public PKCE client
  // id is lenient on purpose — a CLI-only self-host that set the issuer
  // before this knob existed must keep booting on upgrade, and the served
  // console reports the gap itself (Q-CL-2).
  describe("temporalConnection (the STIGMER_TEMPORAL_* settings)", () => {
    it("is a plaintext connection when nothing is set", () => {
      expect(loadConfig({}).temporalConnection).toEqual({});
    });

    it("carries an API key, which implies TLS", () => {
      expect(loadConfig({ STIGMER_TEMPORAL_API_KEY: "k-1" }).temporalConnection).toEqual({
        tls: {},
        apiKey: "k-1",
      });
    });

    it("fails the boot on half a client pair", () => {
      expect(() =>
        loadConfig({ STIGMER_TEMPORAL_TLS_CLIENT_CERT_DATA: "-----BEGIN CERTIFICATE-----" }),
      ).toThrow(/mutual TLS needs both/);
    });
  });

  // stigmer#1357: the address runners are told to dial is its own fact.
  // Defaulting it to the server's own address keeps every co-located
  // install byte-identical; a clustered server overrides it for runners
  // that cannot resolve the cluster-internal name it dials itself.
  describe("runnerBootstrapTemporalAddress (STIGMER_RUNNER_BOOTSTRAP_TEMPORAL_ADDRESS)", () => {
    it("defaults to the address the server dials", () => {
      expect(loadConfig({}).runnerBootstrapTemporalAddress).toBe("localhost:7233");
      expect(
        loadConfig({ TEMPORAL_HOST_PORT: "temporal.internal:7233" }).runnerBootstrapTemporalAddress,
      ).toBe("temporal.internal:7233");
    });

    it("reads an explicit value, leaving the server's own address alone", () => {
      const config = loadConfig({
        TEMPORAL_HOST_PORT: "temporal.internal:7233",
        STIGMER_RUNNER_BOOTSTRAP_TEMPORAL_ADDRESS: "temporal.example.com:7233",
      });
      expect(config.runnerBootstrapTemporalAddress).toBe("temporal.example.com:7233");
      expect(config.temporalHostPort).toBe("temporal.internal:7233");
    });

    it("treats an empty string as absent (Go's getEnvString)", () => {
      expect(
        loadConfig({
          TEMPORAL_HOST_PORT: "temporal.internal:7233",
          STIGMER_RUNNER_BOOTSTRAP_TEMPORAL_ADDRESS: "",
        }).runnerBootstrapTemporalAddress,
      ).toBe("temporal.internal:7233");
    });
  });

  describe("STIGMER_OIDC_CONSOLE_CLIENT_ID (the console's sign-in client)", () => {
    const OIDC = {
      STIGMER_OIDC_ISSUER: "https://auth.example.com/realms/main",
      STIGMER_OIDC_AUDIENCE: "https://stigmer.example.com/",
    };

    it("is empty when absent, and the issuer alone still boots", () => {
      expect(loadConfig(OIDC).oidcConsoleClientId).toBe("");
    });

    it("reads the explicit value", () => {
      expect(
        loadConfig({
          ...OIDC,
          STIGMER_OIDC_CONSOLE_CLIENT_ID: "stigmer-console",
        }).oidcConsoleClientId,
      ).toBe("stigmer-console");
    });

    it("treats an empty string as absent (Go's getEnvString)", () => {
      expect(
        loadConfig({ ...OIDC, STIGMER_OIDC_CONSOLE_CLIENT_ID: "" })
          .oidcConsoleClientId,
      ).toBe("");
    });

    it("is carried even without an issuer — the posture, not this knob, decides whether it is used", () => {
      expect(
        loadConfig({ STIGMER_OIDC_CONSOLE_CLIENT_ID: "stigmer-console" })
          .oidcConsoleClientId,
      ).toBe("stigmer-console");
    });
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

  it("announces the ready line only for the word 'stdout'", () => {
    expect(loadConfig({ STIGMER_READY_LINE: "stdout" }).readyLine).toBe(
      "stdout",
    );
    for (const value of ["1", "true", "STDOUT", ""]) {
      expect(
        loadConfig({ STIGMER_READY_LINE: value }).readyLine,
      ).toBeUndefined();
    }
    expect(loadConfig({}).readyLine).toBeUndefined();
  });
});
