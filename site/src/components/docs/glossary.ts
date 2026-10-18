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
    "One run of an Agent from start to finish: what a user starts when they send a message, start a routine or open a chat link.",
  Score:
    "One grade of a finished run: a person's thumbs up or down on the final answer, the free run-health checks Stigmer runs on every completed run, an AI judge's verdict, or an eval run's checks on one try.",
  "Scoring Rule":
    "AI grading switched on for one Agent: how many of its runs an AI judge grades, the monthly spending limit, and the judge's model.",
  Eval:
    "A set of test cases for an Agent: an evals/ folder in Claude Code's plugin-eval format, pushed whole and kept with every version. Pushing the same folder again changes nothing; a changed folder is a new version, reachable by its digest or by a tag. An eval run on an Agent runs an eval's cases, its mocks standing in for the Agent's own servers and its plugins'.",
  "Eval Run":
    "One run of test cases: on an Agent, the cases of the plugins it uses or of the evals it names, tried several times on the Agent itself; or on a plugin, the plugin's own cases, tried on the built-in assistant. Comparing a plugin tries each case with the plugin and without it and records the difference it makes. An eval run on an Agent is stamped with the Agent's version, so two versions compare side by side.",
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
    "A named setup for the sandboxes Agents run in: the packages installed in each one and the websites it may reach. A conversation uses the one it names, else its routine's, else its Agent's default, else its Organization's.",
  Channel:
    "A way people reach an Agent: a hosted chat link, a Slack workspace or a WhatsApp number. Each Channel has one type, and an Agent can have several.",
  Routine:
    "A saved Agent invocation (which Agent, what to tell it, its workspace, vaults and Environment) that starts on its schedule, when someone runs it, or when another system calls it with a note.",
  "Channel App":
    "A customer-owned messaging-platform app (your own Slack app, or your Meta app with WhatsApp Business access) that Slack and WhatsApp channels install through.",
};
