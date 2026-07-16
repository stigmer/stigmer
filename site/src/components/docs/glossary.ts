/**
 * Stigmer domain term definitions for the <Term> tooltip component.
 *
 * SOURCE OF TRUTH: docs/vocabulary.md
 * Definitions in this file must match the vocabulary guide. When updating
 * a definition here, update docs/vocabulary.md first, then copy the
 * plain-language definition from the term's detailed entry.
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
  PlatformClient:
    "A credential pair your backend uses to mint Stigmer-signed user tokens. Use it to embed Stigmer in your product without setting up OIDC federation.",
  Organization:
    "A workspace that keeps one team's Agents, Workflows, and settings separate from another's.",
  Environment:
    "A separate space (like testing or production) where the same Agent can run with different settings.",
  Project:
    "A container within an Organization that groups related Agents, Workflows, and resources together.",
  "Agent Channel":
    "A connection that puts an Agent into an external messaging platform — Slack today — so people can chat with it where they already work.",
  "Channel App":
    "A customer-owned messaging-platform app (your own Slack app) that an Agent Channel can install through instead of the shared Stigmer app, so the bot carries your name.",
};
