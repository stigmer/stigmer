// Skill resource templates: latest (stigmer://skills/{org}/{slug}) and versioned
// (stigmer://skills/{org}/{slug}/{version}).
// Go parity: mcp-server/internal/domains/skills/resources.go.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BackendTarget } from "../client.js";
import { registerResource, registerVersionedResource } from "../resourcehandler.js";
import { fetchSkill } from "./fetch.js";

/** Register both skill resource templates; returns the registered resource names. */
export function registerSkillResources(server: McpServer, target: BackendTarget): string[] {
  registerResource(server, target, {
    name: "stigmer_skill",
    title: "Stigmer Skill",
    description:
      "Full definition of a Stigmer skill (latest version), identified by organization and slug.",
    template: "stigmer://skills/{org}/{slug}",
    // Two-segment URI → latest version (empty version string).
    fetch: (serverAddress, token, org, slug) => fetchSkill(serverAddress, token, org, slug, ""),
  });

  registerVersionedResource(server, target, {
    name: "stigmer_skill_version",
    title: "Stigmer Skill (versioned)",
    description:
      "Full definition of a Stigmer skill at a specific version, identified by organization, slug, and version (tag name or SHA-256 hash).",
    template: "stigmer://skills/{org}/{slug}/{version}",
    fetch: fetchSkill,
  });

  return ["stigmer_skill", "stigmer_skill_version"];
}
