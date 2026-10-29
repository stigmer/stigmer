/**
 * A Stigmer plugin for the Claude hermetic goldens: `acme`, carrying one
 * skill (`lint`) and one agent (`helper`, whose file names that skill), as
 * the control plane holds an installed plugin: its status lists what it
 * carries, and its archive is what the runner mounts, verified by digest
 * (`shared/plugin-mount.ts`).
 *
 * A scenario lists it on its record's agent ({@link useAcme}) and answers
 * the control plane's plugin reads with {@link ACME_CLIENT}, through
 * `ClaudeTurnOptions.clientOverrides`.
 */

import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginArtifactDownloadUrlSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";
import { vi } from "vitest";

import type { StigmerClient } from "../../../client/stigmer-client.js";
import type { ExecutionRecord } from "../../../__test-utils__/hermetic-activity.js";
import { mintedDownload } from "../../../__test-utils__/minted-download.js";

/** The plugin skill's body, as the plugin's author wrote it. */
export const LINT_BODY = "Run the linter and fix what it reports.";

/** The plugin agent's instructions, by which a script knows the agent's model calls. */
export const HELPER_INSTRUCTIONS = "You are acme's helper. Lint what you are given.";

const ARCHIVE = buildZip([
  { name: ".claude-plugin/plugin.json", content: '{"name":"acme"}' },
  { name: "skills/lint/SKILL.md", content: `---\nname: lint\ndescription: Lints.\nallowed-tools: Bash\n---\n${LINT_BODY}\n` },
  { name: "skills/lint/rules.md", content: "No unused variables.\n" },
  { name: "agents/helper.md", content: `---\nname: helper\nskills: lint\n---\n${HELPER_INSTRUCTIONS}\n` },
]);

export const ACME = create(PluginSchema, {
  metadata: { id: "plg_acme", org: "hermetic-org", slug: "acme", name: "acme" },
  status: {
    digest: createHash("sha256").update(ARCHIVE).digest("hex"),
    artifactStorageKey: "plugins/acme.zip",
    skills: [{ name: "lint", description: "Lints the change.", path: "skills/lint" }],
    agents: [{ name: "helper", description: "Lints what it is given.", instructions: HELPER_INSTRUCTIONS, skills: ["lint"] }],
  },
});

/** The control plane's answers for the plugin: the record, and its archive on the transfer lane. */
export const ACME_CLIENT: Partial<StigmerClient> = {
  getPluginByReference: vi.fn(async () => ACME),
  getPluginArtifactDownloadUrl: vi.fn(async () => create(PluginArtifactDownloadUrlSchema, mintedDownload(ARCHIVE))),
};

/** List the plugin on the record's agent (`AgentSpec.plugins`). */
export function useAcme(record: ExecutionRecord): void {
  record.agent!.spec!.plugins.push(create(ApiResourceReferenceSchema, { kind: 58, org: "hermetic-org", slug: "acme" }));
}
