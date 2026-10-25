/**
 * What each customer's agent gets, in the vocabulary's order, each with the
 * page that shows it. The homepage's "What each customer's agent gets" cards
 * render the list; the hero's picture of the job labels its parts with the
 * same titles, looked up by id, so a reorder here never mislabels it. The
 * titles themselves live in brand/agent-gets.ts, which the films read too.
 */
import type { IconName } from "@/components/ui/icon";
import { AGENT_GET_TITLES } from "../../../brand/agent-gets";

export interface AgentGet {
  icon: IconName;
  title: string;
  description: string;
  cta: string;
  href: string;
}

/** The order the cards show them in. */
export const AGENT_GET_IDS = ["own-computer", "hours", "asks-first", "walls", "keys"] as const;

export type AgentGetId = (typeof AGENT_GET_IDS)[number];

export const AGENT_GETS: Readonly<Record<AgentGetId, AgentGet>> = {
  "own-computer": {
    icon: "cpu",
    title: AGENT_GET_TITLES["own-computer"],
    description: "A sandbox that keeps its files between turns, and hands back what it made.",
    cta: "Environments",
    href: "/docs/concepts/environments",
  },
  hours: {
    icon: "clock",
    title: AGENT_GET_TITLES[hours],
    description:
      "A job, not one request: it keeps going through restarts and reads what you send while it works.",
    cta: "A job that runs for hours",
    href: "/docs/concepts/sessions#a-job-that-runs-for-hours",
  },
  "asks-first": {
    icon: "shield",
    title: AGENT_GET_TITLES["asks-first"],
    description:
      "Before a step your own tools mark as risky, it stops, shows what it wants to do, and waits for a yes.",
    cta: "Approval flows",
    href: "/docs/concepts/approval-flows",
  },
  walls: {
    icon: "lock",
    title: AGENT_GET_TITLES[walls],
    description: "Each customer's agents, files and keys stay apart. The editions say how.",
    cta: "Give each customer their own organization",
    href: "/docs/getting-started/one-organization-per-customer",
  },
  keys: {
    icon: "network",
    title: AGENT_GET_TITLES[keys],
    description:
      "Runs on your own model keys: Anthropic or Cursor anywhere, OpenAI too on Stigmer Cloud. On your servers or ours.",
    cta: "Open source, Enterprise and Cloud",
    href: "/docs/guides/self-hosting/cloud-vs-self-hosted",
  },
};
