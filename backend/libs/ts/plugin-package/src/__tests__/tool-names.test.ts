/**
 * Pins toolServerSegment, the server part of a plugin tool's name as Claude
 * Code builds it: `plugin_<plugin>_<server>`, every character outside
 * `A-Za-z0-9_-` in either name written as `_`, and a `_` or `-` already in a
 * name kept as it is, so an agent's tool list written for Claude Code names
 * the same tools here.
 */
import { describe, expect, it } from "vitest";

import { toolServerSegment } from "../tool-names.js";

describe("toolServerSegment", () => {
  it("joins the plugin and server names under the plugin_ prefix", () => {
    expect(toolServerSegment("orders", "api")).toBe("plugin_orders_api");
  });

  it("keeps letters, digits, underscores and hyphens as they are", () => {
    expect(toolServerSegment("Order-Mgmt_2", "db_read-1")).toBe("plugin_Order-Mgmt_2_db_read-1");
  });

  it("writes every other character in either name as an underscore", () => {
    expect(toolServerSegment("acme.orders", "api server")).toBe("plugin_acme_orders_api_server");
    expect(toolServerSegment("@scope/tools", "fs:read")).toBe("plugin__scope_tools_fs_read");
    expect(toolServerSegment("café", "ü")).toBe("plugin_caf___");
  });
});
