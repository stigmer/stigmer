/**
 * The MCP server names the runner and the control plane share: which names
 * are the platform's, the name grammar an agent's own server is held to,
 * and the login variable both install and a run read. The login cases are
 * the ones install has always produced, so moving the function here changed
 * no plugin's stored variable.
 */
import { describe, expect, it } from "vitest";

import {
  MCP_SERVER_NAME_PATTERN,
  PLATFORM_MCP_SERVERS,
  accessTokenVariable,
  isReservedMcpServerName,
} from "../index.js";

describe("isReservedMcpServerName", () => {
  it("reserves the platform's servers and every name starting stigmer", () => {
    for (const name of PLATFORM_MCP_SERVERS) expect(isReservedMcpServerName(name)).toBe(true);
    expect(isReservedMcpServerName("stigmer")).toBe(true);
    expect(isReservedMcpServerName("stigmerish")).toBe(true);
    expect(isReservedMcpServerName("stigmer-tools")).toBe(true);
  });

  it("reserves plugin, which would read as a plugin's server in a tool name", () => {
    expect(isReservedMcpServerName("plugin")).toBe(true);
    expect(isReservedMcpServerName("plugins")).toBe(false);
  });

  it("leaves every other name to the agent", () => {
    expect(isReservedMcpServerName("zendesk")).toBe(false);
    expect(isReservedMcpServerName("my-stigmer")).toBe(false);
  });
});

describe("MCP_SERVER_NAME_PATTERN", () => {
  it("is the tool lists' server segment: lowercase, a letter first, no trailing hyphen", () => {
    for (const name of ["zendesk", "a1", "acme-crm"]) expect(MCP_SERVER_NAME_PATTERN.test(name)).toBe(true);
    for (const name of ["Zendesk", "1abc", "acme-", "a", "acme_crm", "plugin_x"]) {
      expect(MCP_SERVER_NAME_PATTERN.test(name)).toBe(false);
    }
  });
});

describe("accessTokenVariable", () => {
  it("upper-cases the name and folds every other run of characters to one underscore", () => {
    expect(accessTokenVariable("linear")).toBe("LINEAR_ACCESS_TOKEN");
    expect(accessTokenVariable("my-server.v2")).toBe("MY_SERVER_V2_ACCESS_TOKEN");
    expect(accessTokenVariable("-edge-")).toBe("EDGE_ACCESS_TOKEN");
    expect(accessTokenVariable("--")).toBe("MCP_ACCESS_TOKEN");
  });

  it("folds a long run of separators in linear time", () => {
    expect(accessTokenVariable(`${"-".repeat(50_000)}x${"-".repeat(50_000)}`)).toBe("X_ACCESS_TOKEN");
  });
});
