import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { UseCasesPage } from "@/components/pages/UseCasesPage";

const DESCRIPTION =
  "Examples of jobs Stigmer's agents can do inside a product: each customer uploads their work, the agent does the job, hands back the result, and asks before it acts.";

export const metadata: Metadata = pageMetadata({
  title: "Use Cases",
  description: DESCRIPTION,
  path: "/use-cases",
});

export default function Page() {
  return <UseCasesPage />;
}
