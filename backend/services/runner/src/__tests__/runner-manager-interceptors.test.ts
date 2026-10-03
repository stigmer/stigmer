/**
 * Pins where the manager's OTel workflow interceptor comes from
 * (runner-manager.ts, buildInterceptorConfig). A pre-built workflow bundle
 * has it baked in, and the slim artifact cannot resolve the module beside
 * its entry, so with an OTLP endpoint set the pre-built path must register
 * no module for bundling (stigmer/stigmer#1810: the slim runner's manager
 * and pool modes died at boot resolving it); the runtime-bundling path
 * still registers the resolved module.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildInterceptorConfig } from "../runner-manager.js";
import {
  OTEL_WORKFLOW_INTERCEPTOR_MODULE,
  resolveWorkflowSource,
} from "../workflow-source.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the manager's workflow interceptor modules", () => {
  it("registers no OTel module for a pre-built bundle, even with an OTLP endpoint", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4317");
    const config = await buildInterceptorConfig("prebuilt");
    expect(
      config.workflowInterceptorModules.filter((m) =>
        m.includes("interceptors-opentelemetry"),
      ),
    ).toEqual([]);
    expect(config.interceptors.activity).toBeDefined();
  });

  it("registers the resolved OTel module when bundling at boot", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4317");
    const config = await buildInterceptorConfig("runtime");
    const otel = config.workflowInterceptorModules.filter((m) =>
      m.includes("interceptors-opentelemetry"),
    );
    expect(otel).toHaveLength(1);
    expect(otel[0]).toContain(
      OTEL_WORKFLOW_INTERCEPTOR_MODULE.split("/").pop(),
    );
  });

  it("defaults to the workflow source the manager will use", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4317");
    const expected = await buildInterceptorConfig(resolveWorkflowSource().kind);
    const config = await buildInterceptorConfig();
    expect(config.workflowInterceptorModules).toEqual(
      expected.workflowInterceptorModules,
    );
  });

  it("registers no OTel module without an endpoint", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    const config = await buildInterceptorConfig("runtime");
    expect(
      config.workflowInterceptorModules.filter((m) =>
        m.includes("interceptors-opentelemetry"),
      ),
    ).toEqual([]);
  });
});
