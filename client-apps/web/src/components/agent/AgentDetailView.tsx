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
              <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
                <Bot className="text-muted-foreground size-5" />
              </div>
            )}
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
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
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
            <pre className="bg-muted rounded-lg p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
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
                <div key={slug} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Server className="text-muted-foreground size-4 shrink-0" />
                    <span className="font-mono font-medium">{slug}</span>
                  </div>
                  {usage.enabledTools.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {usage.enabledTools.map((tool) => (
                        <Badge
                          key={tool}
                          variant="secondary"
                          className="text-[10px]"
                        >
                          <Wrench className="mr-0.5 size-2.5" />
                          {tool}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {usage.toolApprovalOverrides.length > 0 && (
                    <div className="text-muted-foreground mt-2 text-xs">
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
                  <FileCode2 className="text-muted-foreground size-4 shrink-0" />
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
              <div key={sub.name} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Bot className="text-muted-foreground size-4 shrink-0" />
                  <span className="font-medium">{sub.name}</span>
                  {sub.modelOverride && (
                    <Badge variant="outline" className="text-[10px]">
                      {sub.modelOverride}
                    </Badge>
                  )}
                </div>
                {sub.description && (
                  <p className="text-muted-foreground mt-1 text-xs">
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
      <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CollapsibleInstructions({ instructions }: { instructions: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <pre className="bg-muted rounded-lg p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {open
          ? instructions
          : instructions.slice(0, INSTRUCTIONS_COLLAPSE_THRESHOLD) + "..."}
      </pre>
      <CollapsibleContent>
        {/* CollapsibleContent wraps nothing extra; full text is shown in pre above when open */}
      </CollapsibleContent>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-xs">
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
        {open ? "Show less" : "Show full instructions"}
      </CollapsibleTrigger>
    </Collapsible>
  );
}
