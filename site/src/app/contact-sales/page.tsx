import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { ContactSalesPage } from "@/components/pages/ContactSalesPage";

export const metadata: Metadata = {
  title: "Contact Sales",
  description:
    "Talk to the Stigmer team about Stigmer Enterprise on your own infrastructure, or Enterprise Cloud run by us, on an annual contract.",
  openGraph: {
    title: `Contact Sales | ${SITE_CONFIG.name}`,
    description:
      "Talk to the Stigmer team about Stigmer Enterprise or Enterprise Cloud.",
  },
};

export default function Page() {
  return <ContactSalesPage />;
}
