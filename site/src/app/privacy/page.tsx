import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { PrivacyPage } from "@/components/pages/PrivacyPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Stigmer collects, uses, and protects your information across the stigmer.ai website and Stigmer Cloud.",
  openGraph: {
    title: `Privacy Policy | ${SITE_CONFIG.name}`,
    description:
      "How Stigmer collects, uses, and protects your information.",
  },
};

export default function Page() {
  return <PrivacyPage />;
}
