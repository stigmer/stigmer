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
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

function makeRequest(
  serviceTypeName = "ai.stigmer.agentic.session.v1.SessionQueryController",
  methodName = "get",
): { header: Map<string, string>; service: { typeName: string }; method: { name: string } } {
  return {
    header: new Map(),
    service: { typeName: serviceTypeName },
    method: { name: methodName },
  };
}

/** A request targeting the ExecutionContext query service (runner-credential path). */
function makeExecutionContextRequest() {
  return makeRequest(ExecutionContextQueryController.typeName, "getByExecutionId");
}

/** A request for the scoped-token exchange (runner-credential path, #156). */
function makeScopedTokenExchangeRequest() {
  return makeRequest(PlatformQueryController.typeName, "getRunnerScopedToken");
}

/** An unsigned JWT-shaped token carrying the given token_type claim. */
function fakeTokenOfType(tokenType: string): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64({ token_type: tokenType })}.sig`;
}

/**
 * Run the request through the full interceptor chain, composed the same way
 * the transport composes it (first interceptor outermost). The client
 * registers more than just the auth interceptor (e.g. OTel trace
 * propagation), so invoking a single one by index would silently test the
 * wrong thing.
 */
async function runInterceptor(req: ReturnType<typeof makeRequest>) {
  const next = vi.fn().mockResolvedValue({ ok: true });
  const handler = capturedInterceptors.reduceRight(
    (inner, interceptor) => interceptor(inner),
    next as (req: any) => Promise<any>,
  );
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

    it("uses the runner credential for the scoped-token exchange (#156)", async () => {
      // The exchange requires the embedded_runner bootstrap credential; the
      // control-plane token (the user's Auth0 token) would be denied.
      const tokenRef: TokenRef = { current: "control-plane-tok" };
      const runnerRef: TokenRef = { current: "runner-tok" };
      new StigmerClient({
        endpoint: "http://localhost",
        token: null,
        tokenRef,
        runnerTokenRef: runnerRef,
      });

      const req = makeScopedTokenExchangeRequest();
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer runner-tok");
    });

    it("keeps the control-plane token for other platform-service methods", async () => {
      const tokenRef: TokenRef = { current: "control-plane-tok" };
      const runnerRef: TokenRef = { current: "runner-tok" };
      new StigmerClient({
        endpoint: "http://localhost",
        token: null,
        tokenRef,
        runnerTokenRef: runnerRef,
      });

      const req = makeRequest(PlatformQueryController.typeName, "getRunnerBootstrapConfig");
      await runInterceptor(req);
      expect(req.header.get("authorization")).toBe("Bearer control-plane-tok");
    });
  });

  describe("per-call credential precedence (#156)", () => {
    it("never overwrites an authorization header set via call options", async () => {
      // The scoped-token flow authenticates individual ExecutionContext reads
      // with a per-execution credential. Concurrent sessions in one runner
      // process mean the process-wide selection below must not clobber it.
      const runnerRef: TokenRef = { current: "process-wide-runner-tok" };
      new StigmerClient({
        endpoint: "http://localhost",
        token: "process-wide-tok",
        runnerTokenRef: runnerRef,
      });

      const req = makeExecutionContextRequest();
      req.header.set("authorization", "Bearer per-call-scoped-tok");
      await runInterceptor(req);

      expect(req.header.get("authorization")).toBe("Bearer per-call-scoped-tok");
    });
  });

  describe("acquireScopedRunnerToken", () => {
    function clientWithRunnerCredential(token: string | null): StigmerClient {
      return new StigmerClient({
        endpoint: "http://localhost",
        token: null,
        runnerTokenRef: { current: token },
      });
    }

    it("exchanges when holding an embedded_runner bootstrap credential", async () => {
      const client = clientWithRunnerCredential(fakeTokenOfType("embedded_runner"));
      vi.spyOn(client, "getRunnerScopedToken").mockResolvedValue({
        token: "scoped-tok",
        expiresInSeconds: 14400,
      });

      const token = await client.acquireScopedRunnerToken({ agentExecutionId: "aex_1" });

      expect(token).toBe("scoped-tok");
      expect(client.getRunnerScopedToken).toHaveBeenCalledWith({ agentExecutionId: "aex_1" });
    });

    it("skips the exchange for an already-scoped sandbox credential (cloud sandbox runner)", async () => {
      const client = clientWithRunnerCredential(fakeTokenOfType("sandbox"));
      const spy = vi.spyOn(client, "getRunnerScopedToken");

      const token = await client.acquireScopedRunnerToken({ agentExecutionId: "aex_1" });

      expect(token).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it("skips the exchange when no runner credential exists (OSS/local)", async () => {
      const client = clientWithRunnerCredential(null);
      const spy = vi.spyOn(client, "getRunnerScopedToken");

      const token = await client.acquireScopedRunnerToken({ workflowExecutionId: "wfx_1" });

      expect(token).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it("falls back (undefined) when the server mints no token", async () => {
      const client = clientWithRunnerCredential(fakeTokenOfType("embedded_runner"));
      vi.spyOn(client, "getRunnerScopedToken").mockResolvedValue(undefined);

      const token = await client.acquireScopedRunnerToken({ agentExecutionId: "aex_1" });

      expect(token).toBeUndefined();
    });

    it("falls back (undefined) when the exchange fails, instead of failing the execution", async () => {
      const client = clientWithRunnerCredential(fakeTokenOfType("embedded_runner"));
      vi.spyOn(client, "getRunnerScopedToken").mockRejectedValue(new Error("boom"));

      const token = await client.acquireScopedRunnerToken({ agentExecutionId: "aex_1" });

      expect(token).toBeUndefined();
    });
  });

  describe("getRunnerScopedToken scope mapping", () => {
    function clientWithPlatformQuery(response: Record<string, unknown>) {
      const client = new StigmerClient({ endpoint: "http://localhost", token: null });
      const getRunnerScopedToken = vi.fn().mockResolvedValue(response);
      // Reach into the private generated client: the mocked createClient()
      // returned {}, so install the method it would have provided.
      (client as any).platformQuery = { getRunnerScopedToken };
      return { client, rpc: getRunnerScopedToken };
    }

    it("maps agentExecutionId onto its oneof arm", async () => {
      const { client, rpc } = clientWithPlatformQuery({ runnerScopedToken: "tok" });

      await client.getRunnerScopedToken({ agentExecutionId: "aex_1" });

      const input = rpc.mock.calls[0]![0];
      expect(input.scope).toEqual({ case: "agentExecutionId", value: "aex_1" });
    });

    it("maps workflowExecutionId onto its oneof arm", async () => {
      const { client, rpc } = clientWithPlatformQuery({ runnerScopedToken: "tok" });

      await client.getRunnerScopedToken({ workflowExecutionId: "wfx_1" });

      const input = rpc.mock.calls[0]![0];
      expect(input.scope).toEqual({ case: "workflowExecutionId", value: "wfx_1" });
    });

    it("maps poolClaimSessionId onto the pool_claim message arm", async () => {
      const { client, rpc } = clientWithPlatformQuery({ runnerScopedToken: "tok" });

      await client.getRunnerScopedToken({ poolClaimSessionId: "ses_1" });

      const input = rpc.mock.calls[0]![0];
      expect(input.scope.case).toBe("poolClaim");
      expect(input.scope.value.sessionId).toBe("ses_1");
    });

    it("authenticates with the caller token per-call when one is supplied (pool attach)", async () => {
      const { client, rpc } = clientWithPlatformQuery({ runnerScopedToken: "tok" });

      await client.getRunnerScopedToken({ poolClaimSessionId: "ses_1" }, "pool-tok");

      expect(rpc).toHaveBeenCalledWith(
        expect.anything(),
        { headers: { authorization: "Bearer pool-tok" } },
      );
    });

    it("passes no call options without a caller token", async () => {
      const { client, rpc } = clientWithPlatformQuery({ runnerScopedToken: "tok" });

      await client.getRunnerScopedToken({ agentExecutionId: "aex_1" });

      expect(rpc).toHaveBeenCalledWith(expect.anything(), undefined);
    });

    it("returns undefined when the server mints nothing (presence-based contract)", async () => {
      const { client } = clientWithPlatformQuery({ runnerScopedToken: "" });

      const scoped = await client.getRunnerScopedToken({ poolClaimSessionId: "ses_1" });

      expect(scoped).toBeUndefined();
    });
  });

  describe("getExecutionContextByExecutionId per-call credential", () => {
    it("passes the scoped token as a per-call authorization header", async () => {
      const client = new StigmerClient({ endpoint: "http://localhost", token: null });
      const getByExecutionId = vi.fn().mockResolvedValue({});
      // Reach into the private generated client: the mocked createClient()
      // returned {}, so install the method it would have provided.
      (client as any).executionContextQuery = { getByExecutionId };

      await client.getExecutionContextByExecutionId("aex_1", "scoped-tok");

      expect(getByExecutionId).toHaveBeenCalledWith(
        expect.anything(),
        { headers: { authorization: "Bearer scoped-tok" } },
      );
    });

    it("passes no call options without a scoped token", async () => {
      const client = new StigmerClient({ endpoint: "http://localhost", token: null });
      const getByExecutionId = vi.fn().mockResolvedValue({});
      (client as any).executionContextQuery = { getByExecutionId };

      await client.getExecutionContextByExecutionId("aex_1");

      expect(getByExecutionId).toHaveBeenCalledWith(expect.anything(), undefined);
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
