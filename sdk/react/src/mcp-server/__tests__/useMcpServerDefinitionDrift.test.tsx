import { describe, it, expect, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import {
  SearchResponseSchema,
  SearchResultSchema,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import {
  HttpServerConfigSchema,
  McpServerSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { samples } from "../../test/samples";
import { StigmerContext } from "../../context";
import { useMcpServerDefinitionDrift } from "../useMcpServerDefinitionDrift";

/**
 * Pins the template-resolution rules of the drift check
 * (stigmer/stigmer#228): the marketplace counterpart is a cross-org
 * PUBLIC row with the exact same slug — found through the search RPC's
 * `crossOrgPublic` scope, the SDK's only client-side definition of
 * "marketplace". Zero candidates, ambiguity, and transport failures all
 * resolve to `null` (advisory affordance, never an error state).
 */

afterEach(cleanup);

function serverWithHeaders(
  org: string,
  headers: Record<string, string>,
): McpServer {
  const server = samples.mcpServer({ name: "Monday", org, slug: "monday" });
  server.spec = create(McpServerSpecSchema, {
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://mcp.monday.com/mcp",
        headers,
      }),
    },
  });
  return server;
}

function searchEntry(org: string) {
  return create(SearchResultSchema, {
    kind: ApiResourceKind.mcp_server,
    id: `mcp-${org}`,
    name: "Monday",
    slug: "monday",
    org,
  });
}

function renderDrift(
  server: McpServer | null,
  register: Parameters<typeof createRouterTransport>[0],
) {
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(register),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return renderHook(() => useMcpServerDefinitionDrift(server), { wrapper });
}

const STALE_HEADERS = { MONDAY_TOKEN: "${MONDAY_ACCESS_TOKEN}" };
const FIXED_HEADERS = { Authorization: "Bearer ${MONDAY_ACCESS_TOKEN}" };

describe("useMcpServerDefinitionDrift", () => {
  it("reports drift against a single cross-org public row with the same slug", async () => {
    const { result } = renderDrift(
      serverWithHeaders("acme", STALE_HEADERS),
      (router) => {
        router.service(SearchService, {
          search: () =>
            create(SearchResponseSchema, {
              entries: [searchEntry("acme"), searchEntry("stigmer")],
            }),
        });
        router.service(McpServerQueryController, {
          getByReference: () => serverWithHeaders("stigmer", FIXED_HEADERS),
        });
      },
    );

    await waitFor(() => expect(result.current.drift).not.toBeNull());
    expect(result.current.drift?.changedFields).toEqual(["headers"]);
    expect(result.current.drift?.template.metadata?.org).toBe("stigmer");
  });

  it("stays quiet when the configurations match", async () => {
    const { result } = renderDrift(
      serverWithHeaders("acme", FIXED_HEADERS),
      (router) => {
        router.service(SearchService, {
          search: () =>
            create(SearchResponseSchema, { entries: [searchEntry("stigmer")] }),
        });
        router.service(McpServerQueryController, {
          getByReference: () => serverWithHeaders("stigmer", FIXED_HEADERS),
        });
      },
    );

    // Settle the async check, then confirm no drift was reported.
    await new Promise((r) => setTimeout(r, 20));
    await waitFor(() => expect(result.current.drift).toBeNull());
  });

  it("stays quiet when no foreign-org row shares the slug", async () => {
    const { result } = renderDrift(
      serverWithHeaders("acme", STALE_HEADERS),
      (router) => {
        router.service(SearchService, {
          search: () =>
            create(SearchResponseSchema, { entries: [searchEntry("acme")] }),
        });
      },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.drift).toBeNull();
  });

  it("stays quiet when multiple foreign orgs share the slug (ambiguous template)", async () => {
    const { result } = renderDrift(
      serverWithHeaders("acme", STALE_HEADERS),
      (router) => {
        router.service(SearchService, {
          search: () =>
            create(SearchResponseSchema, {
              entries: [searchEntry("stigmer"), searchEntry("other-org")],
            }),
        });
      },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.drift).toBeNull();
  });

  it("fails quiet when the search RPC errors", async () => {
    const { result } = renderDrift(
      serverWithHeaders("acme", STALE_HEADERS),
      (router) => {
        router.service(SearchService, {
          search: () => {
            throw new ConnectError("boom", Code.Unavailable);
          },
        });
      },
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.drift).toBeNull();
  });

  it("skips entirely when passed null", async () => {
    const { result } = renderDrift(null, () => {});
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.drift).toBeNull();
  });
});
