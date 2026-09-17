/**
 * The pool re-evaluation must settle. An agent that declares a variable the
 * personal environment lacks enters `needsEnvVars`; the session composer's
 * pool always holds the system keys, so the pool-resolve effect always
 * runs. Before this test, the effect dispatched a freshly built array on
 * every run, the reducer stored it, the effect saw a new dependency and
 * ran again, until React's update cap ("Maximum update depth exceeded").
 * The first agents in a fresh install to declare `env` were the ones a
 * plugin materialises, which is how the loop surfaced. Pinned: with a pool
 * that never covers the variable, the state stays `needsEnvVars` with the
 * same missing list and no error is logged; with a pool that covers it,
 * the state moves to `ready`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/query_pb";
import { AgentInstanceListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";

afterEach(cleanup);

const REF = { org: "acme", slug: "warmth-kit" };

function client() {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, {
        getByReference: () =>
          create(AgentSchema, {
            metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: REF.org, slug: REF.slug, name: "warmth-kit" }),
            spec: create(AgentSpecSchema, {
              env: { API_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true, description: "API token" }) },
            }),
          }),
      });
      service(AgentInstanceQueryController, { list: () => create(AgentInstanceListSchema, { items: [] }) });
      service(EnvironmentQueryController, { list: () => create(EnvironmentListSchema, { items: [] }) });
    }),
  });
}

function wrapper(stigmer: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useAgentSetup pool re-evaluation", () => {
  it("settles in needsEnvVars when the pool never covers the variable", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const systemOnly = new Set(["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY"]);
    const { result } = renderHook(() => useAgentSetup(REF.org, systemOnly), { wrapper: wrapper(client()) });

    await act(async () => {
      await result.current.resolveAgent(REF);
    });

    expect(result.current.state.status).toBe("needsEnvVars");
    if (result.current.state.status === "needsEnvVars") {
      expect(result.current.state.missingVariables.map((v) => v.key)).toEqual(["API_TOKEN"]);
    }
    expect(errors.mock.calls.map((call) => String(call[0]))).not.toContainEqual(expect.stringContaining("Maximum update depth"));
    errors.mockRestore();
  });

  it("moves to ready when the pool covers the variable", async () => {
    const covering = new Set(["STIGMER_SERVER_ADDRESS", "API_TOKEN"]);
    const { result } = renderHook(() => useAgentSetup(REF.org, covering), { wrapper: wrapper(client()) });

    await act(async () => {
      await result.current.resolveAgent(REF);
    });

    expect(result.current.state.status).toBe("ready");
  });
});
