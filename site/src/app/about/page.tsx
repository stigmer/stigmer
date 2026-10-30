import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { AboutPage } from "@/components/pages/AboutPage";

const DESCRIPTION =
  "Stigmer started inside Planton, the DevOps product we also build: what its customers asked for, what we tried first, and why the agent machinery became its own open-source product.";

export const metadata: Metadata = pageMetadata({
  title: "Why we built Stigmer",
  description: DESCRIPTION,
  path: "/about",
});

export default function Page() {
  return <AboutPage />;
}
