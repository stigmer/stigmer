/**
 * Where a run's values come from once nothing for this run supplies them:
 * credentials, per declarer, by the server resolver's rule. Pinned:
 *
 * - an agent whose own key the person's credential serving it holds
 *   resolves `saved` asking nothing; so does one whose key only the
 *   organization's credential serving it holds (a team key);
 * - an MCP server's key is read from the credential serving the server,
 *   never from one serving the agent, and a personal-sign-in server never
 *   takes the organization's credential;
 * - a server with organization sign-in whose organization credential
 *   lacks a value is a pending organization sign-in, never a form field;
 * - typed values are saved into the person's own credential serving each
 *   declarer that needs them: `setFields` on the one that serves it, or a
 *   new credential of the person's (owner = their id), named after the
 *   declarer and serving it alone, when none does; nothing else is
 *   written.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { McpServerSignIn, McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/usage_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ME, credentialWorld, routeCredentials, storedCredential, type CredentialWorld } from "../../credential/__tests__/credential-world";
import { useAgentSetup } from "../useAgentSetup";

afterEach(cleanup);

const ORG = "org_acme";
const AGENT = { kind: "agent", org: ORG, slug: "reviewer" } as const;
const LINEAR = { kind: "mcp_server", org: ORG, slug: "linear" } as const;

function agent(env: readonly string[], servers: readonly string[] = []) {
  return create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: "agt_1", org: ORG, slug: "reviewer", name: "Reviewer" }),
    spec: create(AgentSpecSchema, {
      env: Object.fromEntries(env.map((key) => [key, create(EnvVarDeclarationSchema, { isSecret: true })])),
      mcpServerUsages: servers.map((slug) => create(McpServerUsageSchema, { mcpServerRef: { org: ORG, slug } })),
    }),
  });
}

function server(slug: string, env: readonly string[], signIn = McpServerSignIn.unspecified) {
  return create(McpServerSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: `mcp_${slug}`, org: ORG, slug, name: slug === "linear" ? "Linear" : slug }),
    spec: create(McpServerSpecSchema, {
      signIn,
      env: Object.fromEntries(env.map((key) => [key, create(EnvVarDeclarationSchema, { isSecret: true })])),
    }),
  });
}

function client(world: CredentialWorld, theAgent = agent(["API_TOKEN"]), servers: ReturnType<typeof server>[] = []) {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport((router) => {
      router.service(AgentQueryController, { getByReference: () => theAgent });
      router.service(McpServerQueryController, {
        getByReference: (ref) => servers.find((s) => s.metadata?.slug === ref.slug)!,
      });
      routeCredentials(router, world);
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

async function resolve(stigmer: Stigmer) {
  const hook = renderHook(() => useAgentSetup(ORG), { wrapper: wrapper(stigmer) });
  await act(async () => {
    await hook.result.current.resolveAgent({ org: ORG, slug: "reviewer" });
  });
  return hook;
}

describe("useAgentSetup and credentials", () => {
  it("resolves saved, asking nothing, when the person's credential serving the agent holds its key", async () => {
    const world = credentialWorld([
      storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["API_TOKEN"], serves: [AGENT] }),
    ]);
    const { result } = await resolve(client(world));
    expect(result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
    expect(world.writes).toEqual([]);
  });

  it("resolves saved from the organization's credential serving the agent when the person has none", async () => {
    const world = credentialWorld([
      storedCredential({ id: "team", org: ORG, owner: "org", fields: ["API_TOKEN"], serves: [AGENT] }),
    ]);
    const { result } = await resolve(client(world));
    expect(result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
  });

  it("asks for an MCP server's key that only a credential serving the agent holds", async () => {
    const world = credentialWorld([
      storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["LINEAR_API_KEY"], serves: [AGENT] }),
    ]);
    const { result } = await resolve(client(world, agent([], ["linear"]), [server("linear", ["LINEAR_API_KEY"])]));
    expect(result.current.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [expect.objectContaining({ key: "LINEAR_API_KEY" })],
      pendingSignIns: [],
    });
  });

  it("never takes the organization's credential for a server with personal sign-in", async () => {
    const world = credentialWorld([
      storedCredential({ id: "team", org: ORG, owner: "org", fields: ["LINEAR_API_KEY"], serves: [LINEAR] }),
    ]);
    const { result } = await resolve(client(world, agent([], ["linear"]), [server("linear", ["LINEAR_API_KEY"])]));
    expect(result.current.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [expect.objectContaining({ key: "LINEAR_API_KEY" })],
    });
  });

  it("holds an organization-sign-in server the organization has not connected as a pending organization sign-in", async () => {
    const world = credentialWorld([]);
    const { result } = await resolve(
      client(world, agent([], ["linear"]), [server("linear", ["LINEAR_API_KEY"], McpServerSignIn.organization)]),
    );
    expect(result.current.state).toMatchObject({
      status: "needsEnvVars",
      missingVariables: [],
      pendingSignIns: [expect.objectContaining({ id: "mcp_linear", organization: true })],
    });

    const connected = credentialWorld([
      storedCredential({ id: "org-linear", org: ORG, owner: "org", fields: ["LINEAR_API_KEY"], serves: [LINEAR] }),
    ]);
    const ready = await resolve(
      client(connected, agent([], ["linear"]), [server("linear", ["LINEAR_API_KEY"], McpServerSignIn.organization)]),
    );
    expect(ready.result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
  });

  it("creates a credential of the person's, named after the declarer and serving it, when none serves it", async () => {
    const world = credentialWorld([]);
    const { result } = await resolve(client(world));
    expect(result.current.state.status).toBe("needsEnvVars");

    await act(async () => {
      await result.current.submitEnvVars({ API_TOKEN: { value: "t", isSecret: true } }, { saveForFuture: true });
    });

    expect(result.current.state).toMatchObject({ status: "ready", resolution: { mode: "saved" } });
    expect(world.writes.map((w) => w.rpc)).toEqual(["create"]);
    const created = world.writes[0]!.credential;
    expect(created.metadata?.name).toBe("Reviewer");
    expect(created.spec?.owner).toEqual({ case: "person", value: ME });
    expect(Object.keys(created.spec?.fields ?? {})).toEqual(["API_TOKEN"]);
    expect(created.spec?.serves.map((t) => t.target)).toEqual([
      { case: "agent", value: expect.objectContaining({ org: ORG, slug: "reviewer" }) },
    ]);
  });

  it("sets the fields of the person's credential that already serves the declarer, one save per declarer", async () => {
    const world = credentialWorld([
      storedCredential({ id: "mine-linear", org: ORG, owner: "person", fields: ["OTHER"], serves: [LINEAR] }),
    ]);
    const { result } = await resolve(
      client(world, agent(["API_TOKEN"], ["linear"]), [server("linear", ["LINEAR_API_KEY"])]),
    );
    expect(result.current.state).toMatchObject({ status: "needsEnvVars" });

    await act(async () => {
      await result.current.submitEnvVars(
        { API_TOKEN: { value: "a", isSecret: true }, LINEAR_API_KEY: { value: "l", isSecret: true } },
        { saveForFuture: true },
      );
    });

    expect(world.writes.map((w) => [w.rpc, w.credential.metadata?.id, w.fields ?? Object.keys(w.credential.spec?.fields ?? {})])).toEqual([
      ["create", "cred_2", ["API_TOKEN"]],
      ["setFields", "mine-linear", ["LINEAR_API_KEY"]],
    ]);
  });

  it("keeps one-time values out of every credential", async () => {
    const world = credentialWorld([]);
    const { result } = await resolve(client(world));
    await act(async () => {
      await result.current.submitEnvVars({ API_TOKEN: { value: "t", isSecret: true } }, { saveForFuture: false });
    });
    expect(result.current.state).toMatchObject({ status: "ready", resolution: { mode: "oneTime" } });
    expect(world.writes).toEqual([]);
  });
});
