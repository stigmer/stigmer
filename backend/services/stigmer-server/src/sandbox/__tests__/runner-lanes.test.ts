/**
 * Pins the runner's own HTTPS hosts (runner-lanes.ts, runnerPlatformHosts),
 * which a limited Environment keeps open beside its listed hosts:
 *
 *   - Anthropic: ANTHROPIC_BASE_URL's host wins over the default, and
 *     `api.anthropic.com` only when ANTHROPIC_API_KEY is set, a runner
 *     secret included;
 *   - OpenAI: the same, OPENAI_BASE_URL over `api.openai.com`;
 *   - Bedrock: ANTHROPIC_BEDROCK_BASE_URL's host, else
 *     `bedrock-runtime.<AWS_REGION>.amazonaws.com` only beside a credential;
 *   - Cursor's three hosts when CURSOR_API_KEY is set;
 *   - an https:// public MCP address and OTLP endpoint, by host;
 *   - an http:// URL gives no host, and a host named twice appears once.
 */
import { describe, expect, it } from "vitest";

import {
  CURSOR_HOSTS,
  runnerPlatformHosts,
} from "../runner-lanes.js";

function hosts(
  runnerEnv: Record<string, string> = {},
  runnerSecretEnv: Record<string, string> = {},
  mcpPublicEndpoint = "",
): string[] {
  return runnerPlatformHosts({ runnerEnv, runnerSecretEnv, mcpPublicEndpoint });
}

describe("runnerPlatformHosts", () => {
  it("is empty for a runner given nothing", () => {
    expect(hosts()).toEqual([]);
  });

  it("Anthropic: the base URL's host wins over the default", () => {
    expect(
      hosts(
        { ANTHROPIC_BASE_URL: "https://Gateway.Example.com/anthropic" },
        { ANTHROPIC_API_KEY: "sk" },
      ),
    ).toEqual(["gateway.example.com"]);
  });

  it("Anthropic: the default host only when the key is set, as a secret or a setting", () => {
    expect(hosts({}, { ANTHROPIC_API_KEY: "sk" })).toEqual([
      "api.anthropic.com",
    ]);
    expect(hosts({ ANTHROPIC_API_KEY: "sk" })).toEqual(["api.anthropic.com"]);
    expect(hosts({}, { ANTHROPIC_API_KEY: "  " })).toEqual([]);
  });

  it("OpenAI: the base URL's host wins over the default, and the default only with a key", () => {
    expect(
      hosts(
        { OPENAI_BASE_URL: "https://openai-proxy.example.com/v1" },
        { OPENAI_API_KEY: "sk" },
      ),
    ).toEqual(["openai-proxy.example.com"]);
    expect(hosts({}, { OPENAI_API_KEY: "sk" })).toEqual(["api.openai.com"]);
  });

  it("Bedrock: the base URL's host, else the region's runtime host beside a credential", () => {
    expect(
      hosts({
        ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock.proxy.example.com",
        AWS_REGION: "us-east-1",
      }),
    ).toEqual(["bedrock.proxy.example.com"]);
    expect(
      hosts({ AWS_REGION: "eu-west-1" }, { AWS_BEARER_TOKEN_BEDROCK: "t" }),
    ).toEqual(["bedrock-runtime.eu-west-1.amazonaws.com"]);
    expect(
      hosts({ AWS_REGION: "us-west-2" }, { AWS_ACCESS_KEY_ID: "AKIA" }),
    ).toEqual(["bedrock-runtime.us-west-2.amazonaws.com"]);
    expect(hosts({ AWS_REGION: "us-west-2" })).toEqual([]);
  });

  it("Cursor's three hosts when its key is set", () => {
    expect(hosts({}, { CURSOR_API_KEY: "c" })).toEqual([...CURSOR_HOSTS]);
    expect([...CURSOR_HOSTS]).toEqual([
      "api2.cursor.sh",
      "api.cursor.com",
      "api.cursor.sh",
    ]);
  });

  it("the https:// public MCP address and OTLP endpoint, by host", () => {
    expect(
      hosts(
        { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example.com:4318" },
        {},
        "https://api.stigmer.ai",
      ),
    ).toEqual(["api.stigmer.ai", "otel.example.com"]);
  });

  it("an http:// URL gives nothing", () => {
    expect(
      hosts(
        {
          ANTHROPIC_BASE_URL: "http://fake-model.example:18555",
          OPENAI_BASE_URL: "http://openai.local.example",
          ANTHROPIC_BEDROCK_BASE_URL: "http://bedrock.local.example",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel.local.example:4318",
        },
        { ANTHROPIC_API_KEY: "sk", OPENAI_API_KEY: "sk" },
        "http://stigmer.stigmer.svc:7234",
      ),
    ).toEqual([]);
  });

  it("a host named twice appears once", () => {
    expect(
      hosts(
        {
          ANTHROPIC_BASE_URL: "https://gateway.example.com/anthropic",
          OPENAI_BASE_URL: "https://gateway.example.com/openai",
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://gateway.example.com/otel",
        },
        {},
        "https://gateway.example.com",
      ),
    ).toEqual(["gateway.example.com"]);
  });
});
