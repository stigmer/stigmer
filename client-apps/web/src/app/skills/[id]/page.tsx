"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import { useSkillDetail } from "@/hooks/useSkillDetail";
import { SkillDetailView } from "@/components/skill/SkillDetailView";

export const dynamic = "force-dynamic";

export default function SkillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { skill, isLoading, error } = useSkillDetail(id);

  return (
    <div className="space-y-6">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-3">
        <Link
          href="/skills"
          aria-label="Back to skills"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">
          {skill?.metadata?.name ?? "Skill"}
        </h1>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Content */}
      {skill && <SkillDetailView skill={skill} />}
    </div>
  );
}
