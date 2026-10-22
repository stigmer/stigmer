import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { ContactSalesPage } from "@/components/pages/ContactSalesPage";

export const metadata: Metadata = pageMetadata({
  title: "Contact Sales",
  path: "/contact-sales",
  description:
    "Talk to the Stigmer team about Stigmer Enterprise on your own infrastructure, or Enterprise Cloud run by us, on an annual contract.",
  preview: {
    description: "Talk to the Stigmer team about Stigmer Enterprise or Enterprise Cloud.",
  },
});

export default function Page() {
  return <ContactSalesPage />;
}
