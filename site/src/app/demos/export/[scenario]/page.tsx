import { notFound } from "next/navigation";
import {
  PLAYBACK_SCENARIO_IDS,
  SCENARIO_REGISTRY,
} from "@/components/docs/demos/scenarios/registry";
import { ExportShell } from "./ExportShell";

export function generateStaticParams() {
  return PLAYBACK_SCENARIO_IDS.map((scenario) => ({ scenario }));
}

export default async function ExportPage({
  params,
}: {
  params: Promise<{ scenario: string }>;
}) {
  const { scenario } = await params;
  const Component = SCENARIO_REGISTRY[scenario];
  if (!Component) return notFound();

  return <ExportShell scenario={scenario} />;
}
