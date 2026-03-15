"use client";

import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillState } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import {
  FileCode2,
  Globe,
  Users,
  GitBranch,
  Hash,
  ExternalLink,
  FolderOpen,
  Tag,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

function skillStateBadge(state: SkillState) {
  switch (state) {
    case SkillState.READY:
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle2 className="size-3" />
          Ready
        </Badge>
      );
    case SkillState.UPLOADING:
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          Uploading
        </Badge>
      );
    case SkillState.FAILED:
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="size-3" />
          Failed
        </Badge>
      );
    default:
      return null;
  }
}

interface SkillDetailViewProps {
  skill: Skill;
}

export function SkillDetailView({ skill }: SkillDetailViewProps) {
  const meta = skill.metadata;
  const spec = skill.spec;
  const status = skill.status;
  const visibility = meta?.visibility;
  const isPublic = visibility === ApiResourceVisibility.visibility_public;
  const qualifiedSlug = meta?.org ? `${meta.org}/${meta.slug}` : meta?.slug;
  const git = status?.gitProvenance;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
            <FileCode2 className="text-muted-foreground size-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{meta?.name}</h2>
            <p className="text-muted-foreground font-mono text-xs">
              {qualifiedSlug}
            </p>
          </div>
        </div>
        {spec?.description && (
          <p className="text-muted-foreground max-w-prose text-sm">
            {spec.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {status && skillStateBadge(status.state)}
          {spec?.tag && (
            <Badge variant="outline" className="gap-1 font-mono">
              <Tag className="size-2.5" />
              {spec.tag}
            </Badge>
          )}
          {isPublic ? (
            <Badge variant="outline" className="gap-1">
              <Globe className="size-3" />
              Public
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <Users className="size-3" />
              Private
            </Badge>
          )}
          {meta?.tags?.map((tag: string) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* SKILL.md Content */}
      {spec?.skillMd && (
        <Section title="Skill Content">
          <div className="rounded-lg border p-6">
            <div className="prose prose-sm dark:prose-invert [&_pre]:bg-muted [&_code]:bg-muted max-w-none break-words [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:before:content-none [&_code]:after:content-none [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_table]:text-xs [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {spec.skillMd}
              </ReactMarkdown>
            </div>
          </div>
        </Section>
      )}

      {/* Git Provenance + Version (combined section for related metadata) */}
      {(git?.remoteUrl || status?.versionHash) && (
        <Section title="Provenance">
          <div className="divide-y rounded-lg border">
            {git?.remoteUrl && (
              <div className="space-y-2 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <ExternalLink className="text-muted-foreground size-3.5 shrink-0" />
                  <a
                    href={git.remoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary truncate font-mono text-xs hover:underline"
                  >
                    {git.remoteUrl}
                  </a>
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {git.ref && (
                    <span className="flex items-center gap-1.5">
                      <GitBranch className="size-3" />
                      <span className="font-mono">{git.ref}</span>
                    </span>
                  )}
                  {git.commit && (
                    <span className="flex items-center gap-1.5">
                      <Hash className="size-3" />
                      <span className="font-mono">
                        {git.commit.slice(0, 12)}
                      </span>
                    </span>
                  )}
                  {git.subdir && (
                    <span className="flex items-center gap-1.5">
                      <FolderOpen className="size-3" />
                      <span className="font-mono">{git.subdir}</span>
                    </span>
                  )}
                </div>
              </div>
            )}
            {status?.versionHash && (
              <div className="text-muted-foreground flex items-center gap-4 p-4 text-xs">
                <span>
                  <span className="text-foreground font-medium">Hash:</span>{" "}
                  <span className="font-mono">
                    {status.versionHash.slice(0, 16)}
                  </span>
                </span>
                {status.artifactStorageKey && (
                  <span>
                    <span className="text-foreground font-medium">
                      Storage:
                    </span>{" "}
                    <span className="font-mono">
                      {status.artifactStorageKey}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
