import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { UseCasesPage } from "@/components/pages/UseCasesPage";

const DESCRIPTION =
  "Examples of jobs Stigmer's agents can do inside a product: each customer uploads their work, the agent does the job, hands back the result, and asks before it acts.";

export const metadata: Metadata = {
  title: "Use Cases",
  description: DESCRIPTION,
  openGraph: {
    title: `Use Cases | ${SITE_CONFIG.name}`,
    description: DESCRIPTION,
  },
};

export default function Page() {
  return <UseCasesPage />;
}
