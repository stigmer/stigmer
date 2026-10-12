// Unit arms for the fake OpenTelemetry collector the run-traces suite reads:
// an OTLP/HTTP JSON export carrying the login is recorded span by span, its
// attributes flattened to plain values and its resource's process named; an
// export without the login is refused 401 and counted; a metrics export is
// taken and not read. Driven over loopback with plain fetch; no runner.
// Domain: conformance harness (execution engine, run traces).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COLLECTOR_LOGIN, FakeOtlpCollector } from "../fake-otlp-collector";

const collector = new FakeOtlpCollector();

beforeAll(async () => {
  await collector.start();
});

afterAll(async () => {
  await collector.close();
});

function exportBody(): unknown {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "stigmer.runner.process", value: { stringValue: "agent-host" } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: "a".repeat(32),
                spanId: "b".repeat(16),
                parentSpanId: "c".repeat(16),
                name: "chat claude",
                kind: 3,
                status: { code: 2 },
                attributes: [
                  { key: "gen_ai.provider.name", value: { stringValue: "anthropic" } },
                  { key: "gen_ai.usage.output_tokens", value: { intValue: "5" } },
                  { key: "ratio", value: { doubleValue: 0.5 } },
                  { key: "flag", value: { boolValue: true } },
                  { key: "gen_ai.response.finish_reasons", value: { arrayValue: { values: [{ stringValue: "end_turn" }] } } },
                ],
              },
              { traceId: "d".repeat(32), spanId: "e".repeat(16), name: "invoke_agent bot" },
            ],
          },
        ],
      },
      { scopeSpans: [{ spans: [{ traceId: "a".repeat(32), spanId: "f".repeat(16), name: "invoke_agent root" }] }] },
    ],
  };
}

function post(path: string, body: unknown, login?: string): Promise<Response> {
  return fetch(`${collector.endpoint()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(login !== undefined ? { authorization: login } : {}) },
    body: JSON.stringify(body),
  });
}

describe("the fake OTLP collector", () => {
  it("refuses an export without the login, and counts it", async () => {
    expect((await post("/v1/traces", exportBody())).status).toBe(401);
    expect(collector.refused()).toBe(1);
    expect(collector.spans()).toHaveLength(0);
  });

  it("records every span of an export with the login, flattened, with its process", async () => {
    expect((await post("/v1/traces", exportBody(), COLLECTOR_LOGIN)).status).toBe(200);
    expect(collector.spans()).toHaveLength(3);
    const [chat, other, root] = collector.spans();
    expect(chat).toEqual({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      parentSpanId: "c".repeat(16),
      name: "chat claude",
      kind: 3,
      attributes: {
        "gen_ai.provider.name": "anthropic",
        "gen_ai.usage.output_tokens": 5,
        ratio: 0.5,
        flag: true,
        "gen_ai.response.finish_reasons": ["end_turn"],
      },
      process: "agent-host",
      statusCode: 2,
    });
    expect(other).toMatchObject({ parentSpanId: "", kind: 0, statusCode: 0, attributes: {} });
    expect(root, "a resource that names no process is the runner's").toMatchObject({ process: "" });
    expect(collector.trace("a".repeat(32)).map((span) => span.name)).toEqual(["chat claude", "invoke_agent root"]);
  });

  it("takes a metrics export without reading it", async () => {
    expect((await post("/v1/metrics", { resourceMetrics: [] }, COLLECTOR_LOGIN)).status).toBe(200);
    expect(collector.spans()).toHaveLength(3);
  });

  it("names its missing start when asked for its endpoint too early, and closes when never started", async () => {
    const idle = new FakeOtlpCollector();
    expect(() => idle.endpoint()).toThrow("start() must be called before endpoint()");
    await expect(idle.close()).resolves.toBeUndefined();
  });
});
