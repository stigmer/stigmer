"use client";

import { DraftPage } from "@/components/draft/DraftPage";
import { SKILL_DRAFT_CONFIG } from "@/config/draft";

export default function DraftSkillPage() {
  return <DraftPage config={SKILL_DRAFT_CONFIG} />;
}
