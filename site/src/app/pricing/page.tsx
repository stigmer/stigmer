import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { PricingPage } from "@/components/pages/PricingPage";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Stigmer Cloud pricing — pay only for what you use. Purchase credits, run AI agents, and scale on demand. Free trial included.",
  openGraph: {
    title: `Pricing | ${SITE_CONFIG.name}`,
    description:
      "Stigmer Cloud pricing — prepaid credits for AI agent execution. Transparent per-model token pricing.",
  },
};

export default function Page() {
  return <PricingPage />;
}
