import { EXAMPLES } from "@stigmer/examples";
import type { AgentWizardData } from "../../agent/steps/types.js";
import type { ResourceTemplate } from "./types.js";

/**
 * Built-in agent templates shipped with the SDK: Stigmer's example jobs,
 * the same list the launcher's first question offers (`@stigmer/examples`).
 *
 * Each template is a job done for a product's users, with a file in and a
 * file out: a variance report from a ledger, a drafted reply to each open
 * ticket, a contract's risky clauses, an invoice matched against its
 * purchase order. A template pre-fills only the name, description and
 * instructions, since a plugin, Skill or MCP server it named would be
 * missing for most users; every field can be changed after selection.
 *
 * Platform builders pass their own template arrays to `CreationPicker`
 * or `TemplateGallery` for the jobs of their own product; these are the
 * default.
 */
export const AGENT_TEMPLATES: readonly ResourceTemplate<AgentWizardData>[] = EXAMPLES.map((example) => ({
  id: example.id,
  name: example.name,
  description: `${example.for}: ${example.gives.charAt(0).toLowerCase()}${example.gives.slice(1)} in, ${example.gets.charAt(0).toLowerCase()}${example.gets.slice(1)} out.`,
  category: example.category,
  tags: [...example.tags],
  data: {
    name: example.agent.name,
    description: example.agent.description,
    instructions: example.agent.instructions,
  },
}));
