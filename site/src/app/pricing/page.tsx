import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { PricingPage } from "@/components/pages/PricingPage";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  path: "/pricing",
  description:
    "Stigmer pricing for every edition: Stigmer Cloud's flat monthly plans with agent hours included (Free, Team at $99 a month, Business at $499 a month, and Enterprise Cloud), Stigmer open source at no cost, and Stigmer Enterprise on an annual license. Your agents run on your own model provider keys; Stigmer never charges for tokens.",
  preview: {
    description:
      "Stigmer Cloud's flat monthly plans with agent hours included, open source at no cost, or Stigmer Enterprise on your own infrastructure. Models run on your own provider keys, and your provider bills you directly.",
  },
});

export default function Page() {
  return <PricingPage />;
}
