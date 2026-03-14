"use client";

import { useState } from "react";
import Link from "next/link";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Bot,
  Play,
  Server,
  FileCode2,
  ChevronDown,
  Globe,
  Users,
  Wrench,
} from "lucide-react";

const INSTRUCTIONS_COLLAPSE_THRESHOLD = 300;

interface AgentDetailViewProps {
  agent: Agent;
}

export function AgentDetailView({ agent }: AgentDetailViewProps) {
  const meta = agent.metadata;
  const spec = agent.spec;
  const visibility = meta?.visibility;
  const isPublic = visibility === ApiResourceVisibility.visibility_public;
  const qualifiedSlug = meta?.org ? `${meta.org}/${meta.slug}` : meta?.slug;
  const hasLongInstructions =
    (spec?.instructions?.length ?? 0) > INSTRUCTIONS_COLLAPSE_THRESHOLD;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {spec?.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={spec.iconUrl}
                alt=""
                className="size-10 rounded-lg object-cover"
              />
            ) : (
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <Bot className="size-5 text-muted-foreground" />
              </div>
            )}
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
          <div className="flex items-center gap-2">
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
        <Link
          href={`/run?agentId=${meta?.id ?? ""}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Play className="size-3.5" />
          Run Agent
        </Link>
      </div>

      {/* Instructions */}
      {spec?.instructions && (
        <Section title="Instructions">
          {hasLongInstructions ? (
            <CollapsibleInstructions instructions={spec.instructions} />
          ) : (
            <pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed">
              {spec.instructions}
            </pre>
          )}
        </Section>
      )}

      {/* MCP Server Usages */}
      {spec?.mcpServerUsages && spec.mcpServerUsages.length > 0 && (
        <Section title="MCP Servers">
          <div className="space-y-3">
            {spec.mcpServerUsages.map((usage, i) => {
              const ref = usage.mcpServerRef;
              const slug = ref
                ? ref.org
                  ? `${ref.org}/${ref.slug}`
                  : ref.slug
                : `server-${i}`;
              return (
                <div
                  key={slug}
                  className="rounded-lg border p-3 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Server className="size-4 shrink-0 text-muted-foreground" />
                    <span className="font-mono font-medium">{slug}</span>
                  </div>
                  {usage.enabledTools.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {usage.enabledTools.map((tool) => (
                        <Badge key={tool} variant="secondary" className="text-[10px]">
                          <Wrench className="mr-0.5 size-2.5" />
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {usage.toolApprovalOverrides.length > 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {usage.toolApprovalOverrides.length} approval override
                      {usage.toolApprovalOverrides.length !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Skill Refs */}
      {spec?.skillRefs && spec.skillRefs.length > 0 && (
        <Section title="Skills">
          <div className="space-y-2">
            {spec.skillRefs.map((ref, i) => {
              const slug = ref.org ? `${ref.org}/${ref.slug}` : ref.slug;
              return (
                <div
                  key={slug || i}
                  className="flex items-center gap-2 rounded-lg border p-3 text-sm"
                >
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-mono font-medium">{slug}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Sub-Agents */}
      {spec?.subAgents && spec.subAgents.length > 0 && (
        <Section title="Sub-Agents">
          <div className="space-y-3">
            {spec.subAgents.map((sub) => (
              <div
                key={sub.name}
                className="rounded-lg border p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Bot className="size-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{sub.name}</span>
                  {sub.modelOverride && (
                    <Badge variant="outline" className="text-[10px]">
                      {sub.modelOverride}
                    </Badge>
                  )}
                </div>
                {sub.description && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {sub.description}
                  </p>
                )}
              </div>
            ))}
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

function CollapsibleInstructions({
  instructions,
}: {
  instructions: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed">
        {open
          ? instructions
          : instructions.slice(0, INSTRUCTIONS_COLLAPSE_THRESHOLD) + "..."}
      </pre>
      <CollapsibleContent>
        {/* CollapsibleContent wraps nothing extra; full text is shown in pre above when open */}
      </CollapsibleContent>
      <CollapsibleTrigger className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {open ? "Show less" : "Show full instructions"}
      </CollapsibleTrigger>
    </Collapsible>
  );
}
