import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillState } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { FileCode2, Globe, Users, GitBranch, Hash, ExternalLink } from "lucide-react";

function skillStateBadge(state: SkillState) {
  switch (state) {
    case SkillState.READY:
      return <Badge variant="default">Ready</Badge>;
    case SkillState.UPLOADING:
      return <Badge variant="secondary">Uploading</Badge>;
    case SkillState.FAILED:
      return <Badge variant="destructive">Failed</Badge>;
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
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <FileCode2 className="size-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{meta?.name}</h2>
            <p className="font-mono text-xs text-muted-foreground">
              {qualifiedSlug}
            </p>
          </div>
        </div>
        {spec?.description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {spec.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {status && skillStateBadge(status.state)}
          {spec?.tag && (
            <Badge variant="outline" className="font-mono">
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
            <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_code]:before:content-none [&_code]:after:content-none [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {spec.skillMd}
              </ReactMarkdown>
            </div>
          </div>
        </Section>
      )}

      {/* Git Provenance */}
      {git && git.remoteUrl && (
        <Section title="Provenance">
          <div className="space-y-2 rounded-lg border p-4 text-sm">
            <div className="flex items-center gap-2">
              <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              <a
                href={git.remoteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary hover:underline"
              >
                {git.remoteUrl}
              </a>
            </div>
            {git.ref && (
              <div className="flex items-center gap-2">
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs">{git.ref}</span>
              </div>
            )}
            {git.commit && (
              <div className="flex items-center gap-2">
                <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs">
                  {git.commit.slice(0, 12)}
                </span>
              </div>
            )}
            {git.subdir && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="ml-5">subdir: {git.subdir}</span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Version Metadata */}
      {status?.versionHash && (
        <Section title="Version">
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Hash:</span>{" "}
              <span className="font-mono">{status.versionHash.slice(0, 16)}...</span>
            </p>
            {status.artifactStorageKey && (
              <p>
                <span className="font-medium text-foreground">
                  Storage key:
                </span>{" "}
                <span className="font-mono">{status.artifactStorageKey}</span>
              </p>
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
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      {children}
    </section>
  );
}
