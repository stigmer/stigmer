/**
 * Stigmer domain term definitions for the <Term> tooltip component.
 *
 * SOURCE OF TRUTH: docs/vocabulary.md
 * Definitions in this file must match the vocabulary guide. When updating
 * a definition here, update docs/vocabulary.md first, then copy the
 * plain-language definition from the term's detailed entry, as plain text:
 * a tooltip shows no markdown, so the entry's `**emphasis**` is dropped.
 *
 * Keep definitions to one or two sentences. If a term needs a full
 * explanation, link to the relevant concepts page instead.
 */
export const glossary: Record<string, string> = {
  Agent:
    "A reusable definition of what an AI assistant knows and can do. Think of it as a recipe that describes the assistant's personality, tools, and knowledge.",
  Run:
    "One run of an Agent from start to finish: what a user starts when they send a message, fire a schedule or open a share link.",
  Score:
    "One grade of a finished run: a person's thumbs up or down on the final answer, the free run-health checks Stigmer runs on every completed run, an AI judge's verdict, or an eval run's checks on one try.",
  Evaluator:
    "AI grading switched on for one Agent: how many of its runs an AI judge grades, the monthly spending limit, and the judge's model.",
  "Eval Run":
    "One run of test cases: on an Agent, the cases of the plugins it uses, tried several times on the Agent itself; or on a plugin, the plugin's own cases, tried on the built-in assistant. Comparing a plugin tries each case with the plugin and without it and records the difference it makes. An eval run on an Agent is stamped with the Agent's version, so two versions compare side by side.",
  Session:
    "An ongoing conversation with an Agent across multiple messages. A session remembers what was said earlier so the Agent can follow along.",
  Skill:
    "A piece of knowledge you attach to an Agent so it has domain expertise. Skills let you give an Agent specialized information without rewriting its instructions.",
  "MCP server":
    "An external tool connection that lets an Agent interact with other systems. In Stigmer an MCP server is an entry in a plugin, or one an Agent lists itself; it is not a resource of its own.",
  "Embedding settings":
    "How an Organization's own product signs its users in: which web origins may use the minted tokens, whether a first sign-in creates the person's account and with which role, and which shared vaults their runs use.",
  Organization:
    "The boundary that holds people, Agents, Sessions and secrets together; nothing outside it sees them.",
  Vault:
    "A person's or a team's box of the logins and secrets their runs use. Everyone has their own My vault; an organization's admins create shared vaults and decide who may use them.",
  Environment:
    "Reserved. Stigmer once had an Environment resource holding variables and secrets; vaults replaced it. The word now names only the sandbox a run executes in.",
  "Agent Channel":
    "A connection that puts an Agent into an external messaging platform — Slack or WhatsApp — so people can chat with it where they already work.",
  "Channel App":
    "A customer-owned messaging-platform app (your own Slack app, or your Meta app with WhatsApp Business access) that Agent Channels install through.",
};
