import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { CompareManagedAgentsPage } from "@/components/pages/CompareManagedAgentsPage";

const DESCRIPTION =
  "How Stigmer and Claude Managed Agents compare: who runs each, where the agent's computer runs, models, approvals and the session events API, each from its own docs.";

export const metadata: Metadata = pageMetadata({
  title: "Stigmer and Claude Managed Agents",
  description: DESCRIPTION,
  path: "/compare/claude-managed-agents",
});

export default function Page() {
  return <CompareManagedAgentsPage />;
}
