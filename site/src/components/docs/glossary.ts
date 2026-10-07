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
  Run:
    "One run of an Agent from start to finish: what a user starts when they send a message, fire a schedule or open a share link.",
  Session:
    "An ongoing conversation with an Agent across multiple messages. A session remembers what was said earlier so the Agent can follow along.",
  Skill:
    "A piece of knowledge you attach to an Agent so it has domain expertise. Skills let you give an Agent specialized information without rewriting its instructions.",
  "MCP Server":
    "An external tool connection that lets an Agent interact with other systems — like databases, APIs, or file storage.",
  PlatformClient:
    "A credential pair your backend uses to mint Stigmer-signed user tokens. Use it to embed Stigmer in your product without setting up OIDC federation.",
  Organization:
    "The boundary that holds people, Agents, Sessions and secrets together; nothing outside it sees them.",
  Credential:
    'A saved set of secret values that belongs to a person or to an Organization: "my Linear sign-in", "my OpenAI key", "our Datadog key". A run takes the values it needs from Credentials by one rule.',
  "Agent Channel":
    "A connection that puts an Agent into an external messaging platform — Slack or WhatsApp — so people can chat with it where they already work.",
  "Channel App":
    "A customer-owned messaging-platform app (your own Slack app, or your Meta app with WhatsApp Business access) that Agent Channels install through.",
};
