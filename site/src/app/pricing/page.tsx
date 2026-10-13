import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { PricingPage } from "@/components/pages/PricingPage";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Stigmer Cloud pricing — four flat plans: Free, Team at $99 a month, Business at $499 a month, and Enterprise. Your agents run on your own model provider keys; Stigmer never charges for tokens.",
  openGraph: {
    title: `Pricing | ${SITE_CONFIG.name}`,
    description:
      "Stigmer Cloud pricing — flat monthly plans. Models run on your own provider keys, and your provider bills you directly.",
  },
};

export default function Page() {
  return <PricingPage />;
}
