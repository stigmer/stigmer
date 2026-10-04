/**
 * Where an agent's declared keys come from once nothing else supplies them:
 * the person's personal environment. Every run of an agent reads the keys
 * it declares from the running person's personal environment, so setup
 * creates nothing per agent. Pinned: an agent whose keys the personal
 * environment already holds resolves `saved` without asking, and saving
 * typed values writes them to the personal environment and resolves
 * `saved`, with no other resource written.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentSetup } from "../useAgentSetup";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";

const REVIEWER = create(AgentSchema, {
  metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ACME_ID, slug: "reviewer", name: "Reviewer" }),
  spec: create(AgentSpecSchema, {
    env: { API_TOKEN: create(EnvVarDeclarationSchema, { isSecret: true, description: "API token" }) },
  }),
});

/** Every write the client received, by RPC name. */
type Writes = string[];

/** A client whose personal environment holds `held` keys. */
function client(writes: Writes, held: readonly string[]) {
  const personal = create(EnvironmentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "env_1", org: ACME_ID, slug: "personal" }),
    spec: { data: Object.fromEntries(held.map((key) => [key, { value: "", isSecret: true }])) },
  });
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport(({ service }) => {
      service(AgentQueryController, { getByReference: () => REVIEWER });
      service(EnvironmentQueryController, {
        list: () => create(EnvironmentListSchema, { items: held.length > 0 ? [personal] : [] }),
      });
      service(EnvironmentCommandController, {
        create: () => {
          writes.push("environment.create");
          return personal;
        },
        updateVariables: (request) => {
          writes.push(`environment.updateVariables:${Object.keys(request.variables).join(",")}`);
          return personal;
        },
      });
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

describe("useAgentSetup and the personal environment", () => {
  it("resolves saved, asking nothing, when the personal environment holds every declared key", async () => {
    const writes: Writes = [];
    const { result } = renderHook(() => useAgentSetup(ACME_ID), {
      wrapper: wrapper(client(writes, ["API_TOKEN"])),
    });
    // Resolution reads the personal environment as loaded; retried until
    // its list has settled.
    await waitFor(async () => {
      await act(async () => {
        await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
      });
      expect(result.current.state.status).toBe("ready");
    });

    if (result.current.state.status === "ready") {
      expect(result.current.state.resolution).toEqual({ mode: "saved" });
    }
    expect(writes).toEqual([]);
  });

  it("saves typed values to the personal environment and resolves saved, writing nothing else", async () => {
    const writes: Writes = [];
    const { result } = renderHook(() => useAgentSetup(ACME_ID), {
      wrapper: wrapper(client(writes, [])),
    });

    await act(async () => {
      await result.current.resolveAgent({ org: "acme", slug: "reviewer" });
    });
    expect(result.current.state.status).toBe("needsEnvVars");
    // The personal environment's list must have settled before a save.
    await waitFor(async () => {
      await act(async () => {
        await result.current.submitEnvVars({ API_TOKEN: { value: "t", isSecret: true } }, { saveForFuture: true });
      });
    });

    expect(result.current.state.status).toBe("ready");
    if (result.current.state.status === "ready") {
      expect(result.current.state.resolution).toEqual({ mode: "saved" });
    }
    expect(writes.every((write) => write.startsWith("environment."))).toBe(true);
    expect(writes.join(" ")).toContain("API_TOKEN");
  });
});
