import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { PricingPage } from "@/components/pages/PricingPage";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Stigmer pricing for every edition: Stigmer Cloud's flat plans (Free, Team at $99 a month, Business at $499 a month, and Enterprise Cloud), Stigmer open source at no cost, and Stigmer Enterprise on an annual license. Your agents run on your own model provider keys; Stigmer never charges for tokens.",
  openGraph: {
    title: `Pricing | ${SITE_CONFIG.name}`,
    description:
      "Stigmer Cloud's flat monthly plans, open source at no cost, or Stigmer Enterprise on your own infrastructure. Models run on your own provider keys, and your provider bills you directly.",
  },
};

export default function Page() {
  return <PricingPage />;
}
