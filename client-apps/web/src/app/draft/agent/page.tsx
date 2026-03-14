"use client";

import { DraftPage } from "@/components/draft/DraftPage";
import { AGENT_DRAFT_CONFIG } from "@/config/draft";

export default function DraftAgentPage() {
  return <DraftPage config={AGENT_DRAFT_CONFIG} />;
}
