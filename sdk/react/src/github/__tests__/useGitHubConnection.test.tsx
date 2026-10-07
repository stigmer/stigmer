/**
 * The GitHub connection is the person's own credential serving the git
 * host github.com, with one field, GITHUB_TOKEN: exactly where a run looks
 * for the token a workspace clone of a github.com repository needs.
 * Pinned: on mount the token is revealed from that credential (and the
 * hook reports connected with the GitHub user); a callback's token is
 * saved into a new credential of the person's named "GitHub" serving
 * github.com when none does, or into the one that does; a credential
 * serving another target is never read or written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { GitHubService, ExchangeOAuthCodeResponseSchema } from "@stigmer/protos/ai/stigmer/platform/github/v1/service_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ME, credentialWorld, routeCredentials, storedCredential, type CredentialWorld } from "../../credential/__tests__/credential-world";
import { useGitHubConnection } from "../useGitHubConnection";

const ORG = "org_acme";
const GITHUB = { kind: "git_host", host: "github.com" } as const;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ login: "octocat", avatar_url: "a", name: "Octo" }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function wrapperFor(world: CredentialWorld) {
  const stigmer = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport((router) => {
      routeCredentials(router, world);
      router.service(GitHubService, {
        exchangeOAuthCode: () => create(ExchangeOAuthCodeResponseSchema, { accessToken: "gho_new" }),
      });
    }),
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={stigmer}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useGitHubConnection", () => {
  it("reveals the token from the person's credential serving github.com", async () => {
    const world = credentialWorld([
      storedCredential({ id: "other", org: ORG, owner: "person", fields: ["GITHUB_TOKEN"], serves: [{ kind: "git_host", host: "gitlab.com" }] }),
      storedCredential({ id: "github", org: ORG, owner: "person", fields: ["GITHUB_TOKEN"], serves: [GITHUB] }),
    ]);
    world.secrets["github#GITHUB_TOKEN"] = "gho_saved";
    world.secrets["other#GITHUB_TOKEN"] = "glpat_wrong";

    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(world) });

    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(result.current.token).toBe("gho_saved");
    expect(result.current.user?.login).toBe("octocat");
  });

  it("saves a callback's token into a new credential of the person's named GitHub, serving github.com", async () => {
    const world = credentialWorld([]);
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(world) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.handleCallback("code", "state", "https://app.example/cb");
    });

    expect(world.writes.map((w) => w.rpc)).toEqual(["create"]);
    const created = world.writes[0]!.credential;
    expect(created.metadata?.name).toBe("GitHub");
    expect(created.spec?.owner).toEqual({ case: "person", value: ME });
    expect(Object.keys(created.spec?.fields ?? {})).toEqual(["GITHUB_TOKEN"]);
    expect(created.spec?.serves.map((t) => t.target)).toEqual([{ case: "gitHost", value: "github.com" }]);
    expect(result.current.token).toBe("gho_new");
  });

  it("replaces the token in the credential that already serves github.com", async () => {
    const world = credentialWorld([
      storedCredential({ id: "github", org: ORG, owner: "person", fields: ["OTHER"], serves: [GITHUB] }),
    ]);
    const { result } = renderHook(() => useGitHubConnection(ORG), { wrapper: wrapperFor(world) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.handleCallback("code", "state", "https://app.example/cb");
    });

    expect(world.writes.map((w) => [w.rpc, w.credential.metadata?.id, w.fields])).toEqual([
      ["setFields", "github", ["GITHUB_TOKEN"]],
    ]);
  });
});
