"use client";

import { useState } from "react";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Server,
  Globe,
  Users,
  Terminal,
  Globe2,
  Wrench,
  ChevronDown,
  BookOpen,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

function validationBadge(state: ValidationState) {
  switch (state) {
    case ValidationState.valid:
      return (
        <Badge variant="default" className="gap-1">
          <ShieldCheck className="size-3" />
          Valid
        </Badge>
      );
    case ValidationState.invalid:
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="size-3" />
          Invalid
        </Badge>
      );
    default:
      return null;
  }
}

interface McpServerDetailViewProps {
  mcpServer: McpServer;
}

export function McpServerDetailView({ mcpServer }: McpServerDetailViewProps) {
  const meta = mcpServer.metadata;
  const spec = mcpServer.spec;
  const status = mcpServer.status;
  const visibility = meta?.visibility;
  const isPublic = visibility === ApiResourceVisibility.visibility_public;
  const qualifiedSlug = meta?.org ? `${meta.org}/${meta.slug}` : meta?.slug;
  const discovered = status?.discoveredCapabilities;

  return (
    <div className="space-y-8">
      {/* Header */}
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
              <Server className="text-muted-foreground size-5" />
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
        <div className="flex flex-wrap items-center gap-2">
          {status && validationBadge(status.validationState)}
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
          {spec?.tags?.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
        {status?.validationState === ValidationState.invalid &&
          status.validationMessage && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
              {status.validationMessage}
            </div>
          )}
      </div>

      {/* Server Config */}
      {spec?.serverType.case && (
        <Section title="Server Configuration">
          {spec.serverType.case === "stdio" && (
            <div className="rounded-lg border p-4 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <Terminal className="text-muted-foreground size-4" />
                <span className="font-medium">stdio</span>
              </div>
              <div className="space-y-1 font-mono text-xs">
                <p>
                  <span className="text-muted-foreground">command:</span>{" "}
                  {spec.serverType.value.command}
                </p>
                {spec.serverType.value.args.length > 0 && (
                  <p>
                    <span className="text-muted-foreground">args:</span>{" "}
                    {spec.serverType.value.args.join(" ")}
                  </p>
                )}
                {spec.serverType.value.workingDir && (
                  <p>
                    <span className="text-muted-foreground">cwd:</span>{" "}
                    {spec.serverType.value.workingDir}
                  </p>
                )}
              </div>
            </div>
          )}
          {spec.serverType.case === "http" && (
            <div className="rounded-lg border p-4 text-sm">
              <div className="mb-2 flex items-center gap-2">
                <Globe2 className="text-muted-foreground size-4" />
                <span className="font-medium">HTTP</span>
              </div>
              <div className="space-y-1 font-mono text-xs">
                <p>
                  <span className="text-muted-foreground">url:</span>{" "}
                  {spec.serverType.value.url}
                </p>
                {spec.serverType.value.timeoutSeconds > 0 && (
                  <p>
                    <span className="text-muted-foreground">timeout:</span>{" "}
                    {spec.serverType.value.timeoutSeconds}s
                  </p>
                )}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Discovered Tools */}
      {discovered && discovered.tools.length > 0 && (
        <Section title={`Discovered Tools (${discovered.tools.length})`}>
          <div className="space-y-2">
            {discovered.tools.map((tool) => (
              <ToolRow
                key={tool.name}
                name={tool.name}
                description={tool.description}
                inputSchema={tool.inputSchema}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Default Tool Approvals */}
      {spec?.defaultToolApprovals && spec.defaultToolApprovals.length > 0 && (
        <Section title="Default Tool Approvals">
          <div className="space-y-2">
            {spec.defaultToolApprovals.map((policy) => (
              <div
                key={policy.toolName}
                className="flex items-start gap-2 rounded-lg border p-3 text-sm"
              >
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <div>
                  <span className="font-mono font-medium">
                    {policy.toolName}
                  </span>
                  {policy.message && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {policy.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Resource Templates */}
      {discovered && discovered.resourceTemplates.length > 0 && (
        <Section
          title={`Resource Templates (${discovered.resourceTemplates.length})`}
        >
          <div className="space-y-2">
            {discovered.resourceTemplates.map((tmpl) => (
              <div
                key={tmpl.uriTemplate}
                className="rounded-lg border p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="font-mono text-xs font-medium">
                    {tmpl.uriTemplate}
                  </span>
                </div>
                {tmpl.name && (
                  <p className="ml-5 text-xs font-medium">{tmpl.name}</p>
                )}
                {tmpl.description && (
                  <p className="text-muted-foreground ml-5 text-xs">
                    {tmpl.description}
                  </p>
                )}
                {tmpl.mimeType && (
                  <p className="text-muted-foreground ml-5 text-[10px]">
                    {tmpl.mimeType}
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

function ToolRow({
  name,
  description,
  inputSchema,
}: {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown> | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-start gap-2">
        <Wrench className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-mono font-medium">{name}</span>
          {description && (
            <p className="text-muted-foreground mt-0.5 text-xs">
              {description}
            </p>
          )}
        </div>
      </div>
      {inputSchema && Object.keys(inputSchema).length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-[10px]">
            <ChevronDown
              className={`size-3 transition-transform ${open ? "rotate-180" : ""}`}
            />
            Input schema
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 font-mono text-[10px] leading-relaxed">
              {JSON.stringify(inputSchema, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
