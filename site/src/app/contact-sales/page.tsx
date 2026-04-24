import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { ContactSalesPage } from "@/components/pages/ContactSalesPage";

export const metadata: Metadata = {
  title: "Contact Sales",
  description:
    "Talk to the Stigmer team about Enterprise plans — dedicated infrastructure, SSO, SLAs, and custom contracts.",
  openGraph: {
    title: `Contact Sales | ${SITE_CONFIG.name}`,
    description:
      "Talk to the Stigmer team about Enterprise plans.",
  },
};

export default function Page() {
  return <ContactSalesPage />;
}
