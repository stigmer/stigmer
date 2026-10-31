/**
 * What each customer's agent gets, as the site shows it: each one's title
 * and the docs page that says more. The homepage's "hard parts" section
 * links each row's page; the hero's picture of the job labels its parts with
 * the titles, looked up by id, so a reorder never mislabels it. The titles,
 * the order, the worries and their proofs live in brand/agent-gets.ts, which
 * the films, the video and the demo read too.
 */
import { AGENT_GET_ORDER, AGENT_GET_TITLES, type AgentGetId } from "../../../brand/agent-gets";

export type { AgentGetId };

export interface AgentGet {
  title: string;
  /** The docs link's words. */
  cta: string;
  href: string;
}

/** The order every list shows them in: the brand's. */
export const AGENT_GET_IDS = AGENT_GET_ORDER;

export const AGENT_GETS: Readonly<Record<AgentGetId, AgentGet>> = {
  "own-computer": {
    title: AGENT_GET_TITLES["own-computer"],
    cta: "Environments",
    href: "/docs/concepts/environments",
  },
  hours: {
    title: AGENT_GET_TITLES.hours,
    cta: "A job that runs for hours",
    href: "/docs/concepts/sessions#a-job-that-runs-for-hours",
  },
  "asks-first": {
    title: AGENT_GET_TITLES["asks-first"],
    cta: "Approval flows",
    href: "/docs/concepts/approval-flows",
  },
  walls: {
    title: AGENT_GET_TITLES.walls,
    cta: "Give each customer their own organization",
    href: "/docs/getting-started/one-organization-per-customer",
  },
  keys: {
    title: AGENT_GET_TITLES.keys,
    cta: "Open source, Enterprise and Cloud",
    href: "/docs/guides/self-hosting/cloud-vs-self-hosted",
  },
};
