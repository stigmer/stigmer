"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ErrorMessage } from "@/components/ui/error-message";
import { useSkill } from "@/hooks/skills/useSkill";
import { SkillDetailView } from "@/components/skill/SkillDetailView";

export default function SkillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: skill, isLoading, error, refetch } = useSkill(id);

  return (
    <div className="space-y-6">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-3">
        <Link
          href="/skills"
          aria-label="Back to skills"
          className="hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">
          {skill?.metadata?.name ?? "Skill"}
        </h1>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </div>
      )}

      {error && <ErrorMessage error={error} retry={refetch} />}

      {skill && <SkillDetailView skill={skill} />}
    </div>
  );
}
