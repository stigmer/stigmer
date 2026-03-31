import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { UseCasesPage } from "@/components/pages/UseCasesPage";

export const metadata: Metadata = {
  title: "Use Cases",
  description:
    "See how SaaS platforms across healthcare, HR, fintech, education, and legal use Stigmer to add AI agents that know their domain, use their tools, and follow their rules.",
  openGraph: {
    title: `Use Cases | ${SITE_CONFIG.name}`,
    description:
      "See how SaaS platforms across healthcare, HR, fintech, education, and legal use Stigmer to add AI agents.",
  },
};

export default function Page() {
  return <UseCasesPage />;
}
