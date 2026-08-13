import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  HttpServerConfigSchema,
  McpServerAuthSchema,
  McpServerSpecSchema,
  StdioServerConfigSchema,
  ToolApprovalPolicySchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { samples } from "../../test/samples";
import {
  buildRefreshInput,
  computeDefinitionDrift,
} from "../internal/definitionDrift";

/**
 * Pins the drift comparison and refresh-payload semantics of
 * stigmer/stigmer#228. The scenarios mirror the reporting incident: the
 * monday.com seedpack template was fixed (custom token header ->
 * `Authorization: Bearer`, plus `oauth_only`), and pre-fix copies had to
 * detect exactly that class of change — while cosmetic template edits
 * (descriptions, icons, tags) must never nag.
 */

/** The org copy: pre-fix monday.com configuration. */
function preFixCopy(): McpServer {
  const server = samples.mcpServer({ name: "Monday", org: "acme", slug: "monday" });
  server.spec = create(McpServerSpecSchema, {
    description: "monday.com MCP server",
    iconUrl: "https://example.com/monday.svg",
    tags: ["monday", "project-management"],
    serverType: {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://mcp.monday.com/mcp",
        headers: { MONDAY_TOKEN: "${MONDAY_ACCESS_TOKEN}" },
      }),
    },
    env: {
      MONDAY_ACCESS_TOKEN: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "monday.com personal API token",
      }),
    },
    defaultEnabledTools: ["boards_list"],
    pinnedToolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "items_delete",
        message: "Deletes board items",
        fromDestructiveHint: true,
      }),
    ],
    auth: create(McpServerAuthSchema, {
      targetEnvVar: "MONDAY_ACCESS_TOKEN",
      tokenLifetimeHint: "1h",
    }),
  });
  return server;
}

/** The marketplace template after the fix. */
function fixedTemplate(): McpServer {
  const server = preFixCopy();
  server.metadata!.org = "stigmer";
  server.spec!.serverType = {
    case: "http",
    value: create(HttpServerConfigSchema, {
      url: "https://mcp.monday.com/mcp",
      headers: { Authorization: "Bearer ${MONDAY_ACCESS_TOKEN}" },
    }),
  };
  server.spec!.env = {
    MONDAY_ACCESS_TOKEN: create(EnvVarDeclarationSchema, {
      isSecret: true,
      // Rewritten by the fix — descriptions are cosmetic and must not
      // register as environment-variable drift on their own.
      description: "OAuth access token, obtained automatically via Connect.",
    }),
  };
  server.spec!.auth = create(McpServerAuthSchema, {
    targetEnvVar: "MONDAY_ACCESS_TOKEN",
    tokenLifetimeHint: "1h",
    oauthOnly: true,
  });
  // Policy fields differ on the template: a refresh must NOT import them.
  server.spec!.defaultEnabledTools = [];
  server.spec!.pinnedToolApprovals = [];
  return server;
}

describe("computeDefinitionDrift", () => {
  it("returns null when connection-defining configuration matches", () => {
    expect(computeDefinitionDrift(preFixCopy(), preFixCopy())).toBeNull();
  });

  it("detects the monday.com incident: header fix + oauth_only", () => {
    expect(computeDefinitionDrift(preFixCopy(), fixedTemplate())).toEqual([
      "headers",
      "authentication",
    ]);
  });

  it("ignores cosmetic-only template changes", () => {
    const template = preFixCopy();
    template.spec!.description = "A much better description";
    template.spec!.iconUrl = "https://example.com/new-icon.svg";
    template.spec!.tags = ["monday", "pm", "extra"];
    template.spec!.repositoryUrl = "https://github.com/mondaycom/mcp-v2";
    template.spec!.githubStars = 999;
    expect(computeDefinitionDrift(preFixCopy(), template)).toBeNull();
  });

  it("ignores user policy differences (enabled tools, approval pins)", () => {
    const template = preFixCopy();
    template.spec!.defaultEnabledTools = ["boards_list", "items_create"];
    template.spec!.pinnedToolApprovals = [];
    expect(computeDefinitionDrift(preFixCopy(), template)).toBeNull();
  });

  it("detects endpoint URL changes", () => {
    const template = preFixCopy();
    (template.spec!.serverType.value as { url: string }).url =
      "https://mcp2.monday.com/mcp";
    expect(computeDefinitionDrift(preFixCopy(), template)).toEqual(["endpoint"]);
  });

  it("detects a transport switch as a single coarse change", () => {
    const template = preFixCopy();
    template.spec!.serverType = {
      case: "stdio",
      value: create(StdioServerConfigSchema, { command: "npx" }),
    };
    expect(computeDefinitionDrift(preFixCopy(), template)).toEqual(["transport"]);
  });

  it("detects functional env changes (new required var)", () => {
    const template = preFixCopy();
    template.spec!.env = {
      ...template.spec!.env,
      MONDAY_WORKSPACE_ID: create(EnvVarDeclarationSchema, { isSecret: false }),
    };
    expect(computeDefinitionDrift(preFixCopy(), template)).toEqual([
      "environmentVariables",
    ]);
  });

  it("detects an is_secret flip as functional env drift", () => {
    const template = preFixCopy();
    template.spec!.env = {
      MONDAY_ACCESS_TOKEN: create(EnvVarDeclarationSchema, {
        isSecret: false,
        description: "monday.com personal API token",
      }),
    };
    expect(computeDefinitionDrift(preFixCopy(), template)).toEqual([
      "environmentVariables",
    ]);
  });

  it("compares stdio command and args", () => {
    const current = preFixCopy();
    current.spec!.serverType = {
      case: "stdio",
      value: create(StdioServerConfigSchema, {
        command: "npx",
        args: ["-y", "@mondaycom/mcp@1"],
      }),
    };
    const template = preFixCopy();
    template.spec!.serverType = {
      case: "stdio",
      value: create(StdioServerConfigSchema, {
        command: "npx",
        args: ["-y", "@mondaycom/mcp@2"],
      }),
    };
    expect(computeDefinitionDrift(current, template)).toEqual(["command"]);
  });

  it("treats header map key order as irrelevant", () => {
    const current = preFixCopy();
    current.spec!.serverType = {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://mcp.monday.com/mcp",
        headers: { "X-One": "1", "X-Two": "2" },
      }),
    };
    const template = preFixCopy();
    template.spec!.serverType = {
      case: "http",
      value: create(HttpServerConfigSchema, {
        url: "https://mcp.monday.com/mcp",
        headers: { "X-Two": "2", "X-One": "1" },
      }),
    };
    expect(computeDefinitionDrift(current, template)).toBeNull();
  });
});

describe("buildRefreshInput", () => {
  it("takes the definition from the template and keeps the user's identity and policy", () => {
    const current = preFixCopy();
    const template = fixedTemplate();
    const input = buildRefreshInput(current, template);

    // Identity: the update lands on the user's own resource.
    expect(input.name).toBe("Monday");
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("monday");

    // Definition: the fixed template configuration wins.
    expect(input.http?.headers).toEqual({
      Authorization: "Bearer ${MONDAY_ACCESS_TOKEN}",
    });
    expect(input.auth?.oauthOnly).toBe(true);
    expect(input.env?.MONDAY_ACCESS_TOKEN?.description).toBe(
      "OAuth access token, obtained automatically via Connect.",
    );

    // User policy: never reset by a refresh (the template has neither).
    expect(input.defaultEnabledTools).toEqual(["boards_list"]);
    expect(input.pinnedToolApprovals).toEqual([
      {
        toolName: "items_delete",
        message: "Deletes board items",
        fromDestructiveHint: true,
      },
    ]);
  });

  it("carries a template transport switch cleanly", () => {
    const current = preFixCopy();
    const template = preFixCopy();
    template.spec!.serverType = {
      case: "stdio",
      value: create(StdioServerConfigSchema, { command: "npx", args: ["-y", "mcp"] }),
    };
    const input = buildRefreshInput(current, template);
    expect(input.stdio).toEqual({ command: "npx", args: ["-y", "mcp"] });
    expect(input.http).toBeUndefined();
  });
});
