import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StigmerClientOptions, TokenRef } from "../stigmer-client.js";

/**
 * We mock `@connectrpc/connect-node` so the constructor never opens a real
 * HTTP/2 connection.  The fake transport stores the interceptors it was
 * given, letting us invoke them directly to assert header behaviour.
 */
let capturedInterceptors: Array<(next: any) => (req: any) => Promise<any>>;

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: (opts: { interceptors?: any[] }) => {
    capturedInterceptors = opts.interceptors ?? [];
    return {} as any;
  },
}));

vi.mock("@connectrpc/connect", () => ({
  createClient: () => ({}) as any,
}));

import { StigmerClient } from "../stigmer-client.js";
import { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";

function makeRequest(
  serviceTypeName = "ai.stigmer.agentic.session.v1.SessionQueryController",
): { header: Map<string, string>; service: { typeName: string } } {
  return { header: new Map(), service: { typeName: serviceTypeName } };
}

/** A request targeting the ExecutionContext query service (runner-credential path). */
function makeExecutionContextRequest() {
  return makeRequest(ExecutionContextQueryController.typeName);
}

async function runInterceptor(req: ReturnType<typeof makeRequest>) {
  const interceptor = capturedInterceptors[0]!;
  const next = vi.fn().mockResolvedValue({ ok: true });
  const handler = interceptor(next);
  await handler(req as any);
  return { next, req };
}

describe("StigmerClient", () => {
  beforeEach(() => {
    capturedInterceptors = [];
  });

  describe("auth interceptor", () => {
    it("sets Authorization header when token is provided", async () => {
      new StigmerClient({ endpoint: "http://localhost", token: "tok-123" });
      const req = makeRequest();
      await runInterceptor(req);

      expect(req.header.get("authorization")).toBe("Bearer tok-123");
    });

    it("sends no auth header when token is null", async () => {
      new StigmerClient({ endpoint: "http://localhost", token: null });
      const req = makeRequest();
      await runInterceptor(req);

      expect(req.header.has("authorization")).toBe(false);
    });

    it("updateToken() changes the token used on subsequent requests", async () => {
      const client = new StigmerClient({ endpoint: "http://localhost", token: "old" });

      client.updateToken("new-tok");

      const req = makeRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer new-tok");
    });

    it("updateToken(null) removes the Authorization header", async () => {
      const client = new StigmerClient({ endpoint: "http://localhost", token: "tok" });

      client.updateToken(null);

      const req = makeRequest();
      await runInterceptor(req);
      expect(req.header.has("authorization")).toBe(false);
    });
  });

  describe("tokenRef", () => {
    it("reads from tokenRef.current instead of currentToken when provided", async () => {
      const ref: TokenRef = { current: "ref-tok" };
      new StigmerClient({ endpoint: "http://localhost", token: "ignored", tokenRef: ref });

      const req = makeRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer ref-tok");
    });

    it("propagates updates to tokenRef.current on subsequent requests", async () => {
      const ref: TokenRef = { current: "v1" };
      new StigmerClient({ endpoint: "http://localhost", token: null, tokenRef: ref });

      const req1 = makeRequest();
      await runInterceptor(req1);
      expect(req1.header.get("authorization")).toBe("Bearer v1");

      ref.current = "v2";

      const req2 = makeRequest();
      await runInterceptor(req2);
      expect(req2.header.get("authorization")).toBe("Bearer v2");
    });

    it("falls back to currentToken when tokenRef.current is null", async () => {
      const ref: TokenRef = { current: null };
      new StigmerClient({ endpoint: "http://localhost", token: "fallback", tokenRef: ref });

      const req = makeRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer fallback");
    });

    it("sends no header when both tokenRef.current and currentToken are null", async () => {
      const ref: TokenRef = { current: null };
      new StigmerClient({ endpoint: "http://localhost", token: null, tokenRef: ref });

      const req = makeRequest();
      await runInterceptor(req);
      expect(req.header.has("authorization")).toBe(false);
    });
  });

  describe("runnerTokenRef (ExecutionContext credential selection)", () => {
    // Cloud gates ExecutionContext secret decryption on a runner-class
    // token_type claim (stigmer-cloud#152). These tests pin the selection
    // policy: the runner credential is used for the ExecutionContext query
    // service only, and only when present.

    it("uses the runner credential for ExecutionContext reads", async () => {
      const tokenRef: TokenRef = { current: "control-plane-tok" };
      const runnerRef: TokenRef = { current: "runner-tok" };
      new StigmerClient({
        endpoint: "http://localhost",
        token: null,
        tokenRef,
        runnerTokenRef: runnerRef,
      });

      const req = makeExecutionContextRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer runner-tok");
    });

    it("keeps the control-plane token for every other service", async () => {
      const tokenRef: TokenRef = { current: "control-plane-tok" };
      const runnerRef: TokenRef = { current: "runner-tok" };
      new StigmerClient({
        endpoint: "http://localhost",
        token: null,
        tokenRef,
        runnerTokenRef: runnerRef,
      });

      const req = makeRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer control-plane-tok");
    });

    it("falls back to the control-plane token when no runner credential exists (OSS/local)", async () => {
      const tokenRef: TokenRef = { current: "control-plane-tok" };
      const runnerRef: TokenRef = { current: null };
      new StigmerClient({
        endpoint: "http://localhost",
        token: null,
        tokenRef,
        runnerTokenRef: runnerRef,
      });

      const req = makeExecutionContextRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer control-plane-tok");
    });

    it("propagates runner-credential refreshes on subsequent requests", async () => {
      const runnerRef: TokenRef = { current: "minted-v1" };
      new StigmerClient({
        endpoint: "http://localhost",
        token: null,
        runnerTokenRef: runnerRef,
      });

      const req1 = makeExecutionContextRequest();
      await runInterceptor(req1);
      expect(req1.header.get("authorization")).toBe("Bearer minted-v1");

      runnerRef.current = "minted-v2";

      const req2 = makeExecutionContextRequest();
      await runInterceptor(req2);
      expect(req2.header.get("authorization")).toBe("Bearer minted-v2");
    });
  });

  describe("updateToken", () => {
    it("does not affect tokenRef-based resolution", async () => {
      const ref: TokenRef = { current: "from-ref" };
      const client = new StigmerClient({ endpoint: "http://localhost", token: null, tokenRef: ref });

      client.updateToken("from-update");

      const req = makeRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer from-ref");
    });
  });

  describe("transport", () => {
    it("exposes transport as a readonly property", () => {
      const client = new StigmerClient({ endpoint: "http://localhost", token: null });
      expect(client.transport).toBeDefined();
    });
  });
});
