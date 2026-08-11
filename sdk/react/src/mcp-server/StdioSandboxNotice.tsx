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
 * stdio is local-runner-only: cloud-hosted sessions refuse stdio servers at
 * execution create, and the cloud connect flow refuses to spawn them. This
 * predicate identifies exactly that combination so the UI can explain the
 * policy and its remediation (run the session on a local runner). HTTP
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
 * Explains the local-runner-only policy for an **stdio** MCP server viewed
 * from **Stigmer Cloud**.
 *
 * stdio servers spawn subprocesses on the machine that runs the agent, so
 * they run only on local runners — Stigmer-managed cloud compute refuses
 * them (at execution create, and in the connect flow). The server remains
 * fully usable on sessions that execute on a local runner (desktop app,
 * `stigmer server`), where tools are discovered automatically at session
 * start. This notice states that up front so the refusal never surprises.
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
        "stg:bg-muted-subtle stg:text-muted-foreground stg:flex stg:items-start stg:gap-2.5 stg:rounded-lg stg:border stg:border-transparent stg:px-4 stg:py-3",
        className,
      )}
    >
      <SandboxIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0" />
      <p className="stg:text-xs stg:leading-relaxed">
        This stdio server runs only on local runners — it won&apos;t be
        available to sessions on Stigmer-managed cloud compute. Run the
        session on a local runner (desktop app or CLI) to use it, or choose
        a remote (HTTP) server instead.
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
