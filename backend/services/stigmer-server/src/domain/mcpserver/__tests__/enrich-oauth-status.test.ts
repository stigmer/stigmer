/**
 * Pins the vendor-approval enrichment's degrade: a store fault while the
 * login app for the server's address is looked up leaves the read
 * unenriched and logged, never failed (the start's refusal is the
 * enforcement boundary).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceIdSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { TARGET_RESOURCE_KEY } from "../../../pipeline/steps/load-target.js";
import type { Store } from "../../../store/interface.js";
import { newEnrichOAuthStatusStep } from "../steps.js";

describe("EnrichOAuthStatus under a store fault", () => {
  it("leaves the server unenriched and logs the failed lookup", async () => {
    const warnings: string[] = [];
    const logger = createLogger({ level: "warn", pretty: false, write: (line) => warnings.push(line) });
    const store = {
      resourceNames: { resolve: () => Promise.reject(new Error("names table gone")) },
    } as unknown as Store;
    const server = create(McpServerSchema, {
      metadata: { id: "mcps_1", org: "org_1" },
      spec: { serverType: { case: "http", value: { url: "https://mcp.vendor.example/mcp" } }, auth: { targetEnvVar: "TOKEN" } },
    });
    const ctx = new RequestContext(ApiResourceIdSchema, create(ApiResourceIdSchema), testCallerIdentity());
    ctx.set(TARGET_RESOURCE_KEY, server);
    await newEnrichOAuthStatusStep<typeof ApiResourceIdSchema>(store, logger).execute(ctx);
    expect(server.status?.oauthStatus).toBeUndefined();
    expect(warnings.join("\n")).toContain("Login app lookup failed; returning MCP server without oauth_status enrichment");
  });
});
