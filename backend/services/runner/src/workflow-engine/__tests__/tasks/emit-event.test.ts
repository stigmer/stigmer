import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { emitEventAction, type EmitEventConfig, type SignalDeliveryTarget } from "../../../activities/emit-event.js";

// ─── Server-mediated signal-delivery mocks ───────────────────────────────────
// deliverSignal routes through StigmerClient.sendWorkflowSignal (the server's
// SendSignal lane — oss#517). We mock the client so the signal path is testable
// without a live server, and so we can assert the addressing, the bounded call
// timeout, and the best-effort delivery_errors contract.
const mockSendWorkflowSignal = vi.fn(async (
  _executionId: string,
  _signalName: string,
  _payload: unknown,
  _options?: { timeoutMs?: number },
) => ({}));
const mockClientCtor = vi.fn((_opts: { endpoint: string; token?: string | null }) => ({
  sendWorkflowSignal: mockSendWorkflowSignal,
}));

vi.mock("../../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(
    (opts: { endpoint: string; token?: string | null }) => mockClientCtor(opts),
  ),
}));

// Mutable so each test can vary what config.ts resolves. deliverSignal builds
// its client from the canonical stigmerBackendEndpoint resolution.
let mockBackendEndpoint = "http://localhost:7234";
vi.mock("../../../config.js", () => ({
  loadConfig: () => ({
    stigmerBackendEndpoint: mockBackendEndpoint,
    stigmerToken: null,
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

  describe("signal delivery (server-mediated SendSignal lane)", () => {
    beforeEach(() => {
      mockSendWorkflowSignal.mockClear();
      mockClientCtor.mockClear();
      mockSendWorkflowSignal.mockResolvedValue({});
      mockBackendEndpoint = "http://localhost:7234";
    });

    it("routes through the server resolved by config, addressed by execution_id", async () => {
      mockBackendEndpoint = "https://api.stigmer.example.com";

      const config: EmitEventConfig = {
        event: { type: "approval.granted" },
        delivery: [
          { signal: { execution_id: "wfx_01ABC", signal_name: "approval_resolved" } },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(mockClientCtor).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "https://api.stigmer.example.com" }),
      );
      expect(mockSendWorkflowSignal).toHaveBeenCalledTimes(1);
      const [executionId, signalName, envelope, options] =
        mockSendWorkflowSignal.mock.calls[0] as unknown as [
          string,
          string,
          Record<string, unknown>,
          { timeoutMs?: number },
        ];
      expect(executionId).toBe("wfx_01ABC");
      expect(signalName).toBe("approval_resolved");
      expect(envelope.type).toBe("approval.granted");
      expect(envelope.specversion).toBe("1.0");
      expect(result.delivery_errors).toBeUndefined();
      // Best-effort delivery must never consume the activity's 5m budget.
      expect(options).toEqual({ timeoutMs: 30_000 });
    });

    it("keeps signal delivery best-effort: server refusals are collected, not thrown", async () => {
      mockSendWorkflowSignal.mockRejectedValueOnce(
        new Error("[failed_precondition] cannot send signal to execution in phase EXECUTION_COMPLETED"),
      );

      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [
          { signal: { execution_id: "wfx_done", signal_name: "ping" } },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(result.delivery_errors).toHaveLength(1);
      expect((result.delivery_errors as any)[0].target).toBe("signal:wfx_done/ping");
      expect((result.delivery_errors as any)[0].error).toContain("failed_precondition");
    });

    it("refuses the pre-oss#517 workflow_id field by name, without calling the server", async () => {
      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [
          {
            signal: {
              workflow_id: "workflow-exec-wfx_01ABC",
              signal_name: "ping",
            } as unknown as SignalDeliveryTarget,
          },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(mockSendWorkflowSignal).not.toHaveBeenCalled();
      expect(result.delivery_errors).toHaveLength(1);
      expect((result.delivery_errors as any)[0].error).toContain("'execution_id'");
      expect((result.delivery_errors as any)[0].error).toContain("'workflow_id' is not supported");
    });

    it("refuses a signal target missing signal_name", async () => {
      const config: EmitEventConfig = {
        event: { type: "test" },
        delivery: [
          {
            signal: {
              execution_id: "wfx_01ABC",
            } as unknown as SignalDeliveryTarget,
          },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(mockSendWorkflowSignal).not.toHaveBeenCalled();
      expect(result.delivery_errors).toHaveLength(1);
      expect((result.delivery_errors as any)[0].error).toContain("'signal_name'");
    });

    it("reuses one client across multiple signal targets", async () => {
      const config: EmitEventConfig = {
        event: { type: "fanout" },
        delivery: [
          { signal: { execution_id: "wfx_a", signal_name: "sig_a" } },
          { signal: { execution_id: "wfx_b", signal_name: "sig_b" } },
        ],
      };

      const result = await emitEventAction(config, "exec-1");

      expect(mockClientCtor).toHaveBeenCalledTimes(1);
      expect(mockSendWorkflowSignal).toHaveBeenCalledTimes(2);
      expect(result.delivery_errors).toBeUndefined();
    });

    it("constructs no client for webhook-only delivery", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 200 })),
      ) as any;

      try {
        const config: EmitEventConfig = {
          event: { type: "test" },
          delivery: [{ webhook: { url: "https://events.example.com" } }],
        };

        await emitEventAction(config, "exec-1");

        expect(mockClientCtor).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
