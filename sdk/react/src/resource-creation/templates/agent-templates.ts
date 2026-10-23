import type { AgentWizardData } from "../../agent/steps/types.js";
import type { ResourceTemplate } from "./types.js";

/**
 * Built-in agent templates shipped with the SDK.
 *
 * Each template is a job done inside a customer's product: a variance
 * report from a ledger the customer uploads, and a change to the
 * customer's cloud setup that the agent applies only after a yes. A
 * template pre-fills only the name, description and instructions, since
 * a plugin, Skill or MCP server it named would be missing for most users;
 * every field can be changed after selection.
 *
 * Platform builders pass their own template arrays to `CreationPicker`
 * or `TemplateGallery` for the jobs of their own product; these two are
 * the default.
 */
export const AGENT_TEMPLATES: readonly ResourceTemplate<AgentWizardData>[] = [
  {
    id: "variance-report",
    name: "Variance Report",
    description:
      "A customer uploads a ledger; the agent works through it and hands back a variance report as a file.",
    category: "data-analysis",
    tags: ["accounting", "ledger", "budget", "variance", "report", "file"],
    data: {
      name: "Variance Reporter",
      description: "Turns a customer's ledger into a variance report.",
      instructions: `You review a customer's ledger and report how each account did against its budget.

## How you work

1. Read the ledger the customer uploaded. If it holds no budget figures, ask for them before going on.
2. Group the lines by account and compare each account's actual total with its budget.
3. Call out every account over or under its budget by more than 5%, with the difference and the lines behind it.
4. Write the report as a file, a spreadsheet or a Markdown table as the customer asks, and hand it back.

## Rules

- Use only the figures in the ledger. When a line is unclear, say so in the report rather than guessing.
- Never change the customer's books. When an account needs a correcting entry, propose it in the report.`,
    },
  },
  {
    id: "cloud-change",
    name: "Cloud Change",
    description:
      "A customer asks for a change to their cloud setup; the agent proposes it and applies it only after a yes. Once it is created, mark the tool that applies changes as needing a yes.",
    category: "devops",
    tags: ["cloud", "infrastructure", "devops", "change", "approval"],
    data: {
      name: "Cloud Change Agent",
      description:
        "Proposes changes to a customer's cloud setup and applies them only after a yes.",
      instructions: `You change a customer's cloud setup when they ask, and you apply nothing until they say yes.

## How you work

1. Read what the customer asks for, and look at their current setup before deciding anything.
2. Propose the change: what will change, why it does what they asked, and what else it affects, such as cost, downtime or other services.
3. Wait for the customer's yes. If they ask for something different, propose again.
4. Apply exactly the change they said yes to, then report what changed and how to undo it.

## Rules

- Never apply a change the customer has not said yes to, and never widen it while applying it.

## Setting this agent up

Make the tool that applies changes ask first, so the platform also stops for the customer's yes: a hook that asks before it, or a tool its MCP server marks destructive. Until then, the rules above are the only stop.`,
    },
  },
];
