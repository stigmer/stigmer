/**
 * Pins the manager's activity interceptors (runner-manager.ts,
 * buildInterceptorConfig): the run credential's and the in-flight counter's
 * always, and OpenTelemetry's beside them only when traces export. The
 * manager registers no workflow, so no workflow-side module exists to
 * resolve (stigmer/stigmer#1810 was the slim runner's manager dying at boot
 * resolving one).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetTelemetrySettingsForTests } from "../otel-export.js";
import { buildInterceptorConfig } from "../runner-manager.js";
import { runCredentialActivityInterceptor } from "../interceptors/run-credential-activity.js";

afterEach(() => {
  vi.unstubAllEnvs();
  // The settings are resolved once per process (otel-export.ts); each case reads its own.
  resetTelemetrySettingsForTests();
});

describe("the manager's activity interceptors", () => {
  it("adds OpenTelemetry's when traces export", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4317");
    const config = await buildInterceptorConfig();
    expect(config.interceptors.activity).toHaveLength(3);
    expect(config.interceptors.activity[0]).toBe(runCredentialActivityInterceptor);
  });

  it("registers the run credential's and the in-flight counter's without an endpoint", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    const config = await buildInterceptorConfig();
    expect(config.interceptors.activity).toHaveLength(2);
    expect(Object.keys(config)).toEqual(["interceptors"]);
  });
});
