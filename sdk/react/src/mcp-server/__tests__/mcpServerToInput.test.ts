import { describe, expect, it } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  HttpServerConfigSchema,
  McpServerAuthSchema,
  McpServerSpecSchema,
  StdioServerConfigSchema,
  ToolApprovalPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { buildMcpServerProto } from "@stigmer/sdk";
import { mcpServerToInput } from "../internal/mcpServerToInput.js";

/**
 * `mcpServerToInput` powers every read-modify-write update in the SDK: the
 * backend does FULL spec replacement, so any spec field the conversion
 * fails to carry is silently ERASED by the very next inline edit. That is
 * not hypothetical — `spec.tags` and `auth.oauth_only` were lost this way
 * until the conversion (and the SDK input type) learned them.
 *
 * Two layers of protection:
 *
 * 1. A field-inventory fence: pins the exact field set of every proto
 *    message the conversion traverses. Adding a field to the proto makes
 *    this test fail with instructions, instead of shipping a new
 *    silent-data-loss bug.
 * 2. A round-trip proof: a fully-populated server survives
 *    `mcpServerToInput` -> `buildMcpServerProto` with its spec intact.
 */

// ---------------------------------------------------------------------------
// Layer 1 — field-inventory fence
// ---------------------------------------------------------------------------

/**
 * Every message the conversion walks, with its complete expected field set
 * (proto `localName`s; oneof members appear as individual fields).
 *
 * If this fails because a field was ADDED: map the new field in
 * `mcpServerToInput`, populate it in `fullyPopulatedServer` below, and only
 * then extend the expected list here.
 */
const EXPECTED_FIELD_INVENTORY: ReadonlyArray<
  readonly [DescMessage, readonly string[]]
> = [
  [
    McpServerSpecSchema,
    [
      "auth",
      "defaultEnabledTools",
      "description",
      "env",
      "githubStars",
      "http",
      "iconUrl",
      "pinnedToolApprovals",
      "repositoryUrl",
      "stdio",
      "tags",
    ],
  ],
  [StdioServerConfigSchema, ["args", "command", "workingDir"]],
  [HttpServerConfigSchema, ["headers", "queryParams", "timeoutSeconds", "url"]],
  [EnvVarDeclarationSchema, ["description", "isSecret", "optional"]],
  [ToolApprovalPolicySchema, ["fromDestructiveHint", "message", "toolName"]],
  [
    McpServerAuthSchema,
    [
      "discoveryUrl",
      "oauthAppRef",
      "oauthOnly",
      "scopeHints",
      "targetEnvVar",
      "tokenLifetimeHint",
    ],
  ],
];

describe("mcpServerToInput field-inventory fence", () => {
  it.each(
    EXPECTED_FIELD_INVENTORY.map(
      ([schema, fields]) => [schema.typeName, schema, fields] as const,
    ),
  )("%s has exactly the fields the conversion maps", (_name, schema, fields) => {
    const actual = schema.fields.map((f) => f.localName).sort();
    expect(
      actual,
      `${schema.typeName} changed shape. Map any new field in ` +
        "mcpServerToInput (unmapped spec fields are ERASED on the next " +
        "update), populate it in this file's fullyPopulatedServer fixture, " +
        "then update EXPECTED_FIELD_INVENTORY.",
    ).toEqual([...fields].sort());
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — round-trip proof
// ---------------------------------------------------------------------------

/**
 * A server with EVERY spec field set to a non-default value, so any field
 * the conversion drops shows up as a round-trip diff.
 */
function fullyPopulatedServer(transport: "stdio" | "http") {
  const server = create(McpServerSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata: create(ApiResourceMetadataSchema, {
      name: "Monday",
      org: "acme",
      slug: "monday",
      labels: { "stigmer.ai/category": "productivity" },
    }),
    spec: create(McpServerSpecSchema, {
      description: "monday.com MCP server",
      iconUrl: "https://example.com/monday.svg",
      tags: ["monday", "project-management"],
      defaultEnabledTools: ["boards_list", "items_create"],
      env: {
        MONDAY_ACCESS_TOKEN: create(EnvVarDeclarationSchema, {
          isSecret: true,
          description: "OAuth access token",
          optional: true,
        }),
      },
      pinnedToolApprovals: [
        create(ToolApprovalPolicySchema, {
          toolName: "items_delete",
          message: "Deletes board items",
          fromDestructiveHint: true,
        }),
      ],
      repositoryUrl: "https://github.com/mondaycom/mcp",
      githubStars: 387,
      auth: create(McpServerAuthSchema, {
        oauthAppRef: create(ApiResourceReferenceSchema, {
          org: "stigmer",
          slug: "monday-oauth",
          kind: ApiResourceKind.oauth_app,
        }),
        targetEnvVar: "MONDAY_ACCESS_TOKEN",
        tokenLifetimeHint: "1h",
        scopeHints: ["boards:read", "boards:write"],
        discoveryUrl: "https://auth.monday.com/.well-known/oauth",
        oauthOnly: true,
      }),
    }),
  });

  if (transport === "stdio") {
    server.spec!.serverType = {
      case: "stdio",
      value: create(StdioServerConfigSchema, {
        command: "npx",
        args: ["-y", "@mondaycom/mcp"],
        workingDir: "/workspace",
      }),
    };
  } else {
    server.spec!.serverType = {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://mcp.monday.com/mcp",
        headers: { Authorization: "Bearer ${MONDAY_ACCESS_TOKEN}" },
        queryParams: { version: "2" },
        timeoutSeconds: 45,
      }),
    };
  }

  return server;
}

describe("mcpServerToInput round-trip", () => {
  it.each(["stdio", "http"] as const)(
    "a fully-populated %s server survives toInput -> buildProto with spec intact",
    (transport) => {
      const original = fullyPopulatedServer(transport);
      const rebuilt = buildMcpServerProto(mcpServerToInput(original));

      expect(toJson(McpServerSpecSchema, rebuilt.spec!)).toEqual(
        toJson(McpServerSpecSchema, original.spec!),
      );

      // Metadata identity fields the conversion is responsible for.
      // (visibility is intentionally absent: the backend preserves it on
      // update, and updateVisibility is its dedicated write path.)
      expect(rebuilt.metadata?.name).toBe("Monday");
      expect(rebuilt.metadata?.org).toBe("acme");
      expect(rebuilt.metadata?.slug).toBe("monday");
      expect(rebuilt.metadata?.labels).toEqual({
        "stigmer.ai/category": "productivity",
      });
    },
  );
});
