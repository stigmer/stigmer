"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  SkillEditor,
  useSkill,
  useBreadcrumbOverride,
  createEditorOptionsFromSkillMd,
} from "@stigmer/react";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

/**
 * Console page for editing an existing skill.
 *
 * Mounted at `/library/skills/[org]/[slug]/edit`. Loads the skill via
 * `useSkill`, parses its SKILL.md content into metadata + body, and
 * renders the `SkillEditor` in edit mode.
 */
export function SkillEditPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <SkillEditPageInner org={org} slug={slug} />;
}

function SkillEditPageInner({ org, slug }: { readonly org: string; readonly slug: string }) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const { skill, isLoading, error } = useSkill(org, slug);

  useEffect(() => {
    if (skill?.metadata?.name) {
      setLabel(`Edit ${skill.metadata.name}`);
    }
  }, [skill, setLabel]);

  const editorOptions = useMemo(() => {
    if (!skill?.spec?.skillMd) return null;
    return createEditorOptionsFromSkillMd(skill.spec.skillMd);
  }, [skill]);

  if (isLoading) {
    return <EditSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm font-medium text-destructive">
          Failed to load skill
        </p>
        <p className="text-xs text-muted-foreground">
          {error.message}
        </p>
      </div>
    );
  }

  if (!skill || !editorOptions) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          Skill not found
        </p>
      </div>
    );
  }

  return (
    <SkillEditor
      org={org}
      initialContent={editorOptions.initialContent}
      initialMeta={editorOptions.initialMeta}
      onComplete={(updatedSkill) =>
        router.push(
          `/library/skills/${updatedSkill.metadata?.org}/${updatedSkill.metadata?.slug}`,
        )
      }
      onCancel={() => router.push(`/library/skills/${org}/${slug}`)}
      className="min-h-[480px]"
    />
  );
}

function EditSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      aria-busy="true"
      aria-label="Loading skill editor"
    >
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full animate-pulse rounded bg-muted" />
      </div>
      <div className="h-[300px] animate-pulse rounded bg-muted" />
    </div>
  );
}
