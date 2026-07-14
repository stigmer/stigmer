import { describe, it, expect, beforeEach } from "vitest";
import type { Transport } from "@connectrpc/connect";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { Stigmer } from "../stigmer";

interface CapturedRequest {
  methodName: string;
  message: unknown;
}

function createCapturingTransport(): {
  transport: Transport;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];

  const transport = {
    unary: async (
      method: { name: string },
      _signal: unknown,
      _timeout: unknown,
      _header: unknown,
      message: unknown,
    ) => ({
      header: new Headers(),
      trailer: new Headers(),
      message,
    }),
    stream: async () => {
      throw new Error("streaming not implemented in test transport");
    },
  } as unknown as Transport;

  const originalUnary = (transport as unknown as Record<string, unknown>).unary as (
    ...args: unknown[]
  ) => Promise<unknown>;

  (transport as unknown as Record<string, unknown>).unary = async (
    method: { name: string },
    signal: unknown,
    timeout: unknown,
    header: unknown,
    message: unknown,
    ...rest: unknown[]
  ) => {
    captured.push({ methodName: method.name, message });
    return originalUnary(method, signal, timeout, header, message, ...rest);
  };

  return { transport, captured };
}

describe("Stigmer execution target defaults", () => {
  let captured: CapturedRequest[];
  let stigmer: Stigmer;

  describe("with executionTarget: 'local'", () => {
    beforeEach(() => {
      const ctx = createCapturingTransport();
      captured = ctx.captured;
      stigmer = new Stigmer({
        baseUrl: "http://localhost:7234",
        apiKey: "test-key",
        executionTarget: "local",
        customTransport: ctx.transport,
      });
    });

    it("injects LOCAL into session.create when per-call input omits it", async () => {
      await stigmer.session.create({ name: "test", org: "test-org" });
      const proto = captured[0].message as Session;
      expect(proto.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
    });

    it("preserves per-call override on session.create", async () => {
      await stigmer.session.create({
        name: "test",
        org: "test-org",
        executionTarget: ExecutionTarget.CLOUD,
      });
      const proto = captured[0].message as Session;
      expect(proto.spec?.executionTarget).toBe(ExecutionTarget.CLOUD);
    });

    it("injects LOCAL into session.apply when per-call input omits it", async () => {
      await stigmer.session.apply({ name: "test", org: "test-org" });
      const proto = captured[0].message as Session;
      expect(proto.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
    });

    it("injects LOCAL into agentExecution.create's sessionSpec (one-call bootstrap)", async () => {
      await stigmer.agentExecution.create({
        name: "test",
        org: "test-org",
        message: "hi",
        sessionSpec: { agentInstanceId: "ain_1" },
      });
      const proto = captured[0].message as AgentExecution;
      expect(proto.spec?.sessionSpec?.executionTarget).toBe(ExecutionTarget.LOCAL);
    });

    it("preserves a per-call sessionSpec.executionTarget override", async () => {
      await stigmer.agentExecution.create({
        name: "test",
        org: "test-org",
        message: "hi",
        sessionSpec: {
          agentInstanceId: "ain_1",
          executionTarget: ExecutionTarget.CLOUD,
        },
      });
      const proto = captured[0].message as AgentExecution;
      expect(proto.spec?.sessionSpec?.executionTarget).toBe(ExecutionTarget.CLOUD);
    });

    it("does not synthesize a sessionSpec on agentExecution.create without one", async () => {
      await stigmer.agentExecution.create({
        name: "test",
        org: "test-org",
        message: "hi",
        sessionId: "ses_1",
      });
      const proto = captured[0].message as AgentExecution;
      expect(proto.spec?.sessionSpec).toBeUndefined();
    });
  });

  describe("with executionTarget: 'cloud'", () => {
    beforeEach(() => {
      const ctx = createCapturingTransport();
      captured = ctx.captured;
      stigmer = new Stigmer({
        baseUrl: "http://localhost:7234",
        apiKey: "test-key",
        executionTarget: "cloud",
        customTransport: ctx.transport,
      });
    });

    it("injects CLOUD into session.create", async () => {
      await stigmer.session.create({ name: "test", org: "test-org" });
      const proto = captured[0].message as Session;
      expect(proto.spec?.executionTarget).toBe(ExecutionTarget.CLOUD);
    });
  });

  describe("without executionTarget config", () => {
    beforeEach(() => {
      const ctx = createCapturingTransport();
      captured = ctx.captured;
      stigmer = new Stigmer({
        baseUrl: "http://localhost:7234",
        apiKey: "test-key",
        customTransport: ctx.transport,
      });
    });

    it("does not inject executionTarget on session.create", async () => {
      await stigmer.session.create({ name: "test", org: "test-org" });
      const proto = captured[0].message as Session;
      expect(proto.spec?.executionTarget).toBe(ExecutionTarget.UNSPECIFIED);
    });

    it("defaultExecutionTarget is undefined", () => {
      expect(stigmer.defaultExecutionTarget).toBeUndefined();
    });
  });
});
