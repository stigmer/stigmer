"use client";

import { cn } from "@stigmer/theme";
import type { DeploymentMode } from "@stigmer/sdk";
import type { McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { useDeploymentMode } from "../deployment-mode.js";

/** The `server_type` oneof discriminator from an MCP server's spec. */
type McpServerType = McpServerSpec["serverType"];

/**
 * Whether an MCP server's transport is stdio while connected to Stigmer Cloud.
 *
 * stdio servers run as a subprocess inside an isolated Daytona sandbox in the
 * cloud — not on the user's own computer. This predicate identifies exactly
 * that combination so the connect UI can set accurate expectations. HTTP
 * servers and any transport in local mode return `false`.
 *
 * Pure and framework-free so it can be unit-tested without rendering.
 */
export function isStdioInCloud(
  mode: DeploymentMode,
  serverType: McpServerType | undefined,
): boolean {
  return mode === "cloud" && serverType?.case === "stdio";
}

/** Props for {@link StdioSandboxNotice}. */
export interface StdioSandboxNoticeProps {
  /** The MCP server's `spec.serverType` oneof. */
  readonly serverType: McpServerType | undefined;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Sets accurate expectations for connecting an **stdio** MCP server from
 * **Stigmer Cloud**.
 *
 * stdio servers are a supported cloud capability — Stigmer runs them in an
 * isolated Daytona sandbox. But that sandbox is not the user's own machine,
 * so a server that expects access to local files, applications, or a private
 * network (e.g. a filesystem server) won't behave as the user intends. This
 * notice explains that up front; Connect itself stays enabled because
 * self-contained servers work fine.
 *
 * Self-gating: reads the deployment mode from context and renders `null`
 * unless the server is stdio and the backend is cloud. Callers render it
 * unconditionally next to their Connect action.
 *
 * All visual properties flow through `--stgm-*` design tokens. No
 * Console-specific dependencies — safe for platform-builder embedding.
 */
export function StdioSandboxNotice({
  serverType,
  className,
}: StdioSandboxNoticeProps) {
  const mode = useDeploymentMode();
  if (!isStdioInCloud(mode, serverType)) return null;

  return (
    <div
      role="status"
      className={cn(
        "bg-muted-subtle text-muted-foreground flex items-start gap-2.5 rounded-lg border border-transparent px-4 py-3",
        className,
      )}
    >
      <SandboxIcon className="mt-0.5 size-4 shrink-0" />
      <p className="text-xs leading-relaxed">
        This stdio server runs in an isolated cloud sandbox, not on your own
        computer. Tools that need access to your local files, applications, or
        private network won&apos;t be available here.
      </p>
    </div>
  );
}

function SandboxIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 5.5 8 2.5l6 3-6 3-6-3Z" />
      <path d="M2 5.5v5l6 3 6-3v-5" />
      <path d="M8 8.5v5" />
    </svg>
  );
}
