import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { emitEventAction, type EmitEventConfig } from "../../../activities/emit-event.js";

// ─── Temporal signal-delivery mocks ──────────────────────────────────────────
// deliverSignal dynamically imports @temporalio/client and resolves the cluster
// coordinates through loadConfig(). We mock both so the signal path is testable
// without a live Temporal server, and so we can assert which address it dials.
const mockConnect = vi.fn(async (_opts: { address: string }) => ({}));
const mockSignal = vi.fn(async () => undefined);
const mockGetHandle = vi.fn((_id: string) => ({ signal: mockSignal }));
const mockClientCtor = vi.fn((_opts: { connection: unknown; namespace: string }) => ({
  workflow: { getHandle: mockGetHandle },
}));

vi.mock("@temporalio/client", () => ({
  Connection: { connect: (opts: { address: string }) => mockConnect(opts) },
  Client: vi.fn().mockImplementation((opts: { connection: unknown; namespace: string }) =>
    mockClientCtor(opts),
  ),
}));

// Mutable so each test can vary what config.ts resolves. Mirrors the real
// resolution where temporalAddress comes from TEMPORAL_SERVICE_ADDRESS.
let mockTemporalAddress = "localhost:7233";
let mockTemporalNamespace = "default";
vi.mock("../../../config.js", () => ({
  loadConfig: () => ({
    temporalAddress: mockTemporalAddress,
    temporalNamespace: mockTemporalNamespace,
  }),
}));

describe("emitEventAction", () => {
  describe("envelope construction", () => {
    it("constructs a CloudEvents 1.0 envelope with required fields", async () => {
      const config: EmitEventConfig = {
        event: { type: "workflow.step.completed" },
      };

      const result = await emitEventAction(config, "exec-123");

      expect(result.specversion).toBe("1.0");
      expect(result.type).toBe("workflow.step.completed");
      expect(result.source).toBe("/workflows/executions/exec-123");
      expect(result.datacontenttype).toBe("application/json");
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(result.time).toBeDefined();
    });

    it("uses custom source when provided", async () => {
      const config: EmitEventConfig = {
        event: { type: "user.created", source: "/services/auth" },
      };

      const result = await emitEventAction(config, "exec-456");

      expect(result.source).toBe("/services/auth");
    });

    it("includes subject when provided", async () => {
      const config: EmitEventConfig = {
        event: { type: "order.shipped", subject: "order-789" },
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.subject).toBe("order-789");
    });

    it("includes data when provided and non-empty", async () => {
      const config: EmitEventConfig = {
        event: {
          type: "build.completed",
          data: { build_id: "b-123", status: "success", duration_ms: 4500 },
        },
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.data).toEqual({ build_id: "b-123", status: "success", duration_ms: 4500 });
    });

    it("omits data when empty object", async () => {
      const config: EmitEventConfig = {
        event: { type: "ping", data: {} },
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.data).toBeUndefined();
    });

    it("omits subject when not provided", async () => {
      const config: EmitEventConfig = {
        event: { type: "test" },
      };

      const result = await emitEventAction(config, "exec-1");

      expect("subject" in result).toBe(false);
    });

    it("throws when event field is missing", async () => {
      const config = {} as EmitEventConfig;
      await expect(emitEventAction(config, "exec-1")).rejects.toThrow("'event' field is required");
    });

    it("throws when event.type is missing", async () => {
      const config = { event: {} } as unknown as EmitEventConfig;
      await expect(emitEventAction(config, "exec-1")).rejects.toThrow("'event.type' field is required");
    });

    it("generates unique IDs for each invocation", async () => {
      const config: EmitEventConfig = { event: { type: "test" } };
      const r1 = await emitEventAction(config, "e1");
      const r2 = await emitEventAction(config, "e1");
      expect(r1.id).not.toBe(r2.id);
    });

    it("time field is a valid ISO 8601 string", async () => {
      const config: EmitEventConfig = { event: { type: "test" } };
      const result = await emitEventAction(config, "e1");
      const parsed = new Date(result.time as string);
      expect(parsed.toISOString()).toBe(result.time);
    });
  });

  describe("no delivery (backward compatible)", () => {
    it("returns envelope only when no delivery config", async () => {
      const config: EmitEventConfig = {
        event: { type: "test.event" },
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.type).toBe("test.event");
      expect(result.delivery_errors).toBeUndefined();
    });

    it("returns envelope only when delivery is empty array", async () => {
      const config: EmitEventConfig = {
        event: { type: "test.event" },
        delivery: [],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.type).toBe("test.event");
      expect(result.delivery_errors).toBeUndefined();
    });
  });

  describe("webhook delivery", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("sends CloudEvents envelope via HTTP POST", async () => {
      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
      globalThis.fetch = fetchSpy as any;

      const config: EmitEventConfig = {
        event: { type: "test.delivered", data: { key: "value" } },
        delivery: [{ webhook: { url: "https://events.example.com/ingest" } }],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe("https://events.example.com/ingest");
      expect(call[1].method).toBe("POST");
      expect((call[1].headers as Record<string, string>)["Content-Type"]).toBe("application/cloudevents+json");

      const body = JSON.parse(call[1].body as string);
      expect(body.type).toBe("test.delivered");
      expect(body.data).toEqual({ key: "value" });

      expect(result.delivery_errors).toBeUndefined();
    });

    it("resolves placeholders in webhook headers", async () => {
      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
      globalThis.fetch = fetchSpy as any;

      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [{
          webhook: {
            url: "https://api.example.com",
            headers: { Authorization: "Bearer ${.secrets.API_TOKEN}" },
          },
        }],
      };

      await emitEventAction(config, "exec-1", { API_TOKEN: "secret123" });

      const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect((call[1].headers as Record<string, string>)["Authorization"]).toBe("Bearer secret123");
    });

    it("collects delivery errors on HTTP failure", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 502 })),
      ) as any;

      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [{ webhook: { url: "https://down.example.com" } }],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.delivery_errors).toHaveLength(1);
      expect((result.delivery_errors as any)[0].target).toBe("webhook:https://down.example.com");
      expect((result.delivery_errors as any)[0].error).toContain("502");
    });

    it("collects delivery errors on network failure", async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.reject(new Error("ECONNREFUSED")),
      ) as any;

      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [{ webhook: { url: "https://unreachable.example.com" } }],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.delivery_errors).toHaveLength(1);
      expect((result.delivery_errors as any)[0].error).toContain("ECONNREFUSED");
    });

    it("delivers to multiple webhook targets", async () => {
      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
      globalThis.fetch = fetchSpy as any;

      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [
          { webhook: { url: "https://a.example.com" } },
          { webhook: { url: "https://b.example.com" } },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.delivery_errors).toBeUndefined();
    });
  });

  describe("signal delivery (Temporal coordinates from config)", () => {
    beforeEach(() => {
      mockConnect.mockClear();
      mockSignal.mockClear();
      mockGetHandle.mockClear();
      mockClientCtor.mockClear();
      mockSignal.mockResolvedValue(undefined);
      mockTemporalAddress = "localhost:7233";
      mockTemporalNamespace = "default";
    });

    it("dials the Temporal address resolved by config, not a hardcoded localhost", async () => {
      // Regression for F1: deliverSignal previously read process.env.TEMPORAL_ADDRESS
      // and fell back to localhost — diverging from the canonical
      // TEMPORAL_SERVICE_ADDRESS the worker uses. It now goes through loadConfig().
      mockTemporalAddress = "stigmer-temporal-frontend:7233";
      mockTemporalNamespace = "stigmer-prod";

      const config: EmitEventConfig = {
        event: { type: "approval.granted" },
        delivery: [
          { signal: { workflow_id: "wf-abc", signal_name: "approvalResolved" } },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(mockConnect).toHaveBeenCalledWith({ address: "stigmer-temporal-frontend:7233" });
      expect(mockClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: "stigmer-prod" }),
      );
      expect(mockGetHandle).toHaveBeenCalledWith("wf-abc");
      expect(mockSignal).toHaveBeenCalledTimes(1);
      const [signalName, envelope] = mockSignal.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(signalName).toBe("approvalResolved");
      expect(envelope.type).toBe("approval.granted");
      expect(result.delivery_errors).toBeUndefined();
    });

    it("keeps signal delivery best-effort: failures are collected, not thrown", async () => {
      mockSignal.mockRejectedValueOnce(new Error("temporal unavailable"));

      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [
          { signal: { workflow_id: "wf-down", signal_name: "ping" } },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.delivery_errors).toHaveLength(1);
      expect((result.delivery_errors as any)[0].target).toBe("signal:wf-down/ping");
      expect((result.delivery_errors as any)[0].error).toContain("temporal unavailable");
    });
  });
});
