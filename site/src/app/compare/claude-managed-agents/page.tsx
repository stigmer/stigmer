import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { CompareManagedAgentsPage } from "@/components/pages/CompareManagedAgentsPage";

const DESCRIPTION =
  "How Stigmer and Claude Managed Agents compare: who runs each, where the agent's computer runs, models, approvals and the session events API, each from its own docs.";

export const metadata: Metadata = {
  title: "Stigmer and Claude Managed Agents",
  description: DESCRIPTION,
  openGraph: {
    title: `Stigmer and Claude Managed Agents | ${SITE_CONFIG.name}`,
    description: DESCRIPTION,
  },
};

export default function Page() {
  return <CompareManagedAgentsPage />;
}
