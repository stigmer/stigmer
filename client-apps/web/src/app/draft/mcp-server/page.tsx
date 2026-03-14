"use client";

import { DraftPage } from "@/components/draft/DraftPage";
import { MCP_SERVER_DRAFT_CONFIG } from "@/config/draft";

export const dynamic = "force-dynamic";

export default function DraftMcpServerPage() {
  return <DraftPage config={MCP_SERVER_DRAFT_CONFIG} />;
}
