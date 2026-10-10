/**
 * The one spec edit that puts a plugin on an agent. Pins: the plugin is
 * appended to `plugins` after the ones listed, everything else kept; an
 * agent that lists it already is returned unchanged; references compare by
 * organization and slug, a reference without an organization naming the
 * agent's own.
 */

import { describe, expect, it } from "vitest";
import type { AgentInput } from "@stigmer/sdk";
import { listsPlugin, withPlugin } from "../plugin-on-agent.js";

const ORG = "org_acme";

function agent(plugins: AgentInput["plugins"]): AgentInput {
  return { name: "reviewer", org: ORG, instructions: "Review.", env: { API_TOKEN: { isSecret: true } }, plugins };
}

describe("withPlugin", () => {
  it("appends the plugin after the ones listed and keeps the rest", () => {
    const next = withPlugin(agent([{ org: ORG, slug: "notion" }]), { org: ORG, slug: "linear" });
    expect(next.plugins).toEqual([
      { org: ORG, slug: "notion" },
      { org: ORG, slug: "linear" },
    ]);
    expect(next.env).toEqual({ API_TOKEN: { isSecret: true } });
    expect(next.instructions).toBe("Review.");
  });

  it("starts the list for an agent that lists none", () => {
    expect(withPlugin(agent(undefined), { org: ORG, slug: "linear" }).plugins).toEqual([{ org: ORG, slug: "linear" }]);
  });

  it("returns an agent that lists the plugin unchanged", () => {
    const input = agent([{ org: ORG, slug: "linear" }]);
    expect(withPlugin(input, { org: ORG, slug: "linear" })).toBe(input);
  });
});

describe("listsPlugin", () => {
  it("matches by organization and slug, an empty organization naming the agent's", () => {
    expect(listsPlugin(agent([{ org: "", slug: "linear" }]), { org: ORG, slug: "linear" })).toBe(true);
    expect(listsPlugin(agent([{ org: ORG, slug: "linear" }]), { org: "", slug: "linear" })).toBe(true);
    expect(listsPlugin(agent([{ org: "org_globex", slug: "linear" }]), { org: ORG, slug: "linear" })).toBe(false);
    expect(listsPlugin(agent([{ org: ORG, slug: "notion" }]), { org: ORG, slug: "linear" })).toBe(false);
  });
});
