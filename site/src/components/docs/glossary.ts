/**
 * Stigmer domain term definitions for the <Term> tooltip component.
 *
 * Each entry maps a display term (as it appears in prose) to a plain-language
 * definition. Definitions follow the Document Writer role guidelines: write
 * for a smart person who is not technical.
 *
 * Keep definitions to one or two sentences. If a term needs a full
 * explanation, link to the relevant concepts page instead.
 */
export const glossary: Record<string, string> = {
  Agent:
    "A reusable definition of what an AI assistant knows and can do. Think of it as a recipe that describes the assistant's personality, tools, and knowledge.",
  "Agent Execution":
    "One run of an Agent from start to finish. Each time an Agent handles a request, that is one execution.",
  "Agent Instance":
    "A deployed copy of an Agent running in a specific environment with its own configuration and secrets.",
  Session:
    "An ongoing conversation with an Agent across multiple messages. A session remembers what was said earlier so the Agent can follow along.",
  Workflow:
    "A step-by-step automation that runs tasks in a defined order. Workflows keep running reliably even if something crashes.",
  "Workflow Execution":
    "One run of a Workflow from start to finish.",
  Skill:
    "A piece of knowledge you attach to an Agent so it has domain expertise. Skills let you give an Agent specialized information without rewriting its instructions.",
  "MCP Server":
    "An external tool connection that lets an Agent interact with other systems — like databases, APIs, or file storage.",
  Organization:
    "A workspace that keeps one team's Agents, Workflows, and settings separate from another's.",
  Environment:
    "A separate space (like testing or production) where the same Agent can run with different settings.",
  Project:
    "A container within an Organization that groups related Agents, Workflows, and resources together.",
};
