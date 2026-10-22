import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { PrivacyPage } from "@/components/pages/PrivacyPage";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  path: "/privacy",
  description:
    "How Stigmer collects, uses, and protects your information across the stigmer.ai website and Stigmer Cloud.",
  preview: {
    description: "How Stigmer collects, uses, and protects your information.",
  },
});

export default function Page() {
  return <PrivacyPage />;
}
