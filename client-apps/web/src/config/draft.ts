import { Bot, FileCode2, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * System agent blueprints (skill-creator, agent-creator, mcp-server-creator)
 * live in the "stigmer" organization. This is a platform convention established
 * in the seedpack. Agent resolution always uses this org; execution creation
 * uses the user's active org.
 */
export const SYSTEM_AGENT_ORG = "stigmer";

export interface DraftConfig {
  type: "skill" | "agent" | "mcp-server";
  agentSlug: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  inputPlaceholder: string;
}

export const SKILL_DRAFT_CONFIG: DraftConfig = {
  type: "skill",
  agentSlug: "skill-creator",
  title: "Draft Skill",
  description: "Describe a skill and let the AI draft it for you",
  icon: FileCode2,
  href: "/draft/skill",
  inputPlaceholder: "Describe the skill you want to create...",
};

export const AGENT_DRAFT_CONFIG: DraftConfig = {
  type: "agent",
  agentSlug: "agent-creator",
  title: "Draft Agent",
  description: "Describe an agent and let the AI draft it for you",
  icon: Bot,
  href: "/draft/agent",
  inputPlaceholder: "Describe the agent you want to create...",
};

export const MCP_SERVER_DRAFT_CONFIG: DraftConfig = {
  type: "mcp-server",
  agentSlug: "mcp-server-creator",
  title: "Draft MCP Server",
  description: "Describe an MCP server and let the AI draft it for you",
  icon: Server,
  href: "/draft/mcp-server",
  inputPlaceholder: "Describe the MCP server you want to create...",
};

export const ALL_DRAFT_CONFIGS: DraftConfig[] = [
  SKILL_DRAFT_CONFIG,
  AGENT_DRAFT_CONFIG,
  MCP_SERVER_DRAFT_CONFIG,
];
