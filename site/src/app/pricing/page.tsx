import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { PricingPage } from "@/components/pages/PricingPage";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Stigmer pricing — Free tier for getting started, Pro for production workloads, Enterprise for teams that need dedicated support and SLAs.",
  openGraph: {
    title: `Pricing | ${SITE_CONFIG.name}`,
    description:
      "Stigmer pricing — Free, Pro, and Enterprise tiers for AI agent workloads.",
  },
};

export default function Page() {
  return <PricingPage />;
}
