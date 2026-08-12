"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { MoreHorizontal, Play, Trash2 } from "lucide-react";
import { cn } from "@stigmer/theme";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useAgentInstances } from "./useAgentInstances.js";
import { ActionMenu } from "../action-menu/index.js";
import { Button } from "../button/Button.js";
import { useEnvironmentList } from "../environment/useEnvironmentList.js";
import { ResourceVisibilityControl } from "../library/ResourceVisibilityControl.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { AgentInstanceEmptyState } from "./AgentInstanceEmptyState.js";

/** Label marking a user's auto-managed personal instance. */
const PERSONAL_LABEL = "stigmer.ai/personal";

/** Props for {@link AgentInstanceList}. */
export interface AgentInstanceListProps {
  /** Agent resource ID to list instances for. */
  readonly agentId: string;
  /** The default instance ID (from agent.status.defaultInstanceId) — filtered out of the list. */
  readonly defaultInstanceId?: string;
  /**
   * The AGENT's organization slug (needed for environment resolution
   * and the create flow). Not the list scope — that is `viewerOrg`,
   * which differs from `org` when viewing another org's agent.
   */
  readonly org: string;
  /**
   * The viewer's active organization slug. Scopes the list to this
   * org's instances of the agent, so a member of several orgs sees
   * exactly the current org context's instances. Omit to default to
   * the agent's own org.
   */
  readonly viewerOrg?: string;
  /** Called when the user wants to create a new instance. */
  readonly onCreateClick?: () => void;
  /** Called when the user clicks an instance row (opens detail). */
  readonly onInstanceClick?: (instance: AgentInstance) => void;
  /** Called when the user clicks "Start session" on an instance. */
  readonly onStartSessionClick?: (instance: AgentInstance) => void;
  /** Called when the user clicks "Delete" on an instance. */
  readonly onDeleteClick?: (instance: AgentInstance) => void;
  /**
   * Increment this value to trigger a refetch of the instance list.
   * Useful after creating or deleting an instance externally.
   */
  readonly refreshKey?: number;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Agent instance list with environment badges, visibility controls, and
 * action buttons. Filters out the platform-managed default instance and
 * marks auto-managed personal instances with a badge.
 *
 * The agent analog of `WorkflowInstanceList`: because agents run through
 * Sessions, the primary row verb is **Start session** (bound to the chosen
 * instance) rather than "Run".
 *
 * This is an SDK component (DD-001) — embeddable by platform builders.
 */
export function AgentInstanceList({
  agentId,
  defaultInstanceId,
  org,
  viewerOrg,
  onCreateClick,
  onInstanceClick,
  onStartSessionClick,
  onDeleteClick,
  refreshKey,
  className,
}: AgentInstanceListProps) {
  // Scope the list to the org whose context the viewer is in; when the
  // host passes no viewerOrg the scope falls back to the agent's own org
  // (the same-org owner flow).
  const { instances, isLoading, error, refetch } = useAgentInstances(
    agentId,
    viewerOrg || org,
  );
  const { environments } = useEnvironmentList(org);

  // Refetch when refreshKey changes (signals external mutation like create/delete)
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = refreshKey;
      refetch();
    }
  }, [refreshKey, refetch]);

  const userInstances = useMemo(
    () => instances.filter((i) => i.metadata?.id !== defaultInstanceId),
    [instances, defaultInstanceId],
  );

  const resolveEnvName = useCallback(
    (slug: string): string => {
      const env = environments.find((e) => e.metadata?.slug === slug);
      return env?.metadata?.name ?? slug;
    },
    [environments],
  );

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="stg:py-8 stg:text-center stg:text-sm stg:text-destructive">
        Failed to load instances
      </div>
    );
  }

  if (userInstances.length === 0) {
    return <AgentInstanceEmptyState onCreateClick={onCreateClick} className={className} />;
  }

  return (
    <div className={cn("stg:space-y-3", className)}>
      <div className="stg:flex stg:items-center stg:justify-between">
        <h3 className="stg:text-sm stg:font-medium stg:text-foreground">
          {userInstances.length} {userInstances.length === 1 ? "instance" : "instances"}
        </h3>
        {onCreateClick && (
          <Button
            variant="outline"
            size="xs"
            icon={<PlusIcon />}
            onClick={onCreateClick}
          >
            Create instance
          </Button>
        )}
      </div>

      <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border">
        {/* table-fixed keeps the layout deterministic: Name/Environments flex
            and truncate, Visibility/Actions take fixed widths, so long
            content can never push the Actions kebab off the panel's edge. */}
        <table className="stg:w-full stg:table-fixed stg:text-sm">
          <thead>
            <tr className="stg:border-b stg:border-border stg:bg-muted-subtle">
              <th className="stg:px-4 stg:py-2 stg:text-left stg:font-medium stg:text-muted-foreground">Name</th>
              <th className="stg:px-4 stg:py-2 stg:text-left stg:font-medium stg:text-muted-foreground">Environments</th>
              <th className="stg:w-36 stg:px-4 stg:py-2 stg:text-left stg:font-medium stg:text-muted-foreground">Visibility</th>
              <th className="stg:w-16 stg:px-4 stg:py-2 stg:text-right stg:font-medium stg:text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="stg:divide-y stg:divide-border">
            {userInstances.map((inst) => (
              <InstanceRow
                key={inst.metadata?.id}
                instance={inst}
                resolveEnvName={resolveEnvName}
                onRowClick={onInstanceClick}
                onStartSessionClick={onStartSessionClick}
                onDeleteClick={onDeleteClick}
                refetch={refetch}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface InstanceRowProps {
  readonly instance: AgentInstance;
  readonly resolveEnvName: (slug: string) => string;
  readonly onRowClick?: (instance: AgentInstance) => void;
  readonly onStartSessionClick?: (instance: AgentInstance) => void;
  readonly onDeleteClick?: (instance: AgentInstance) => void;
  readonly refetch: () => void;
}

function InstanceRow({
  instance,
  resolveEnvName,
  onRowClick,
  onStartSessionClick,
  onDeleteClick,
  refetch,
}: InstanceRowProps) {
  const meta = instance.metadata;
  const id = meta?.id ?? "";
  const isPersonal = meta?.labels?.[PERSONAL_LABEL] === "true";

  const envRefs = instance.spec?.environmentRefs ?? [];

  // Delete is the only permission-gated row action (Start session is offered
  // whenever the host wires it). Resolved here so the kebab is hidden when it
  // would hold no items — never an empty overflow menu.
  const { allowed: canDelete } = useCheckPermission(
    { kind: "agent_instance", id },
    "can_delete",
  );
  const showStartSession = !!onStartSessionClick;
  const showDelete = !!onDeleteClick && canDelete;

  return (
    <tr
      className={cn(
        "stg:transition-colors",
        onRowClick && "stg:cursor-pointer stg:hover:bg-accent-hover",
      )}
      onClick={() => onRowClick?.(instance)}
    >
      <td className="stg:px-4 stg:py-2.5">
        <div className="stg:min-w-0">
          <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
            <TruncatedText
              text={meta?.name || meta?.slug || "\u2014"}
              className="stg:font-medium stg:text-foreground"
            />
            {isPersonal && (
              <span
                className={cn(
                  "stg:inline-flex stg:shrink-0 stg:items-center stg:rounded-md stg:px-1.5 stg:py-0.5",
                  "stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wide",
                  "stg:bg-muted stg:text-muted-foreground stg:border stg:border-border",
                )}
              >
                Personal
              </span>
            )}
          </div>
          {instance.spec?.description && (
            <p className="stg:text-[0.65rem] stg:text-muted-foreground stg:truncate">
              {instance.spec.description}
            </p>
          )}
        </div>
      </td>

      <td className="stg:px-4 stg:py-2.5">
        {envRefs.length === 0 ? (
          <span className="stg:text-xs stg:text-muted-foreground">None</span>
        ) : (
          <div className="stg:flex stg:flex-wrap stg:gap-1">
            {envRefs.map((ref, idx) => (
              <span
                key={`${ref.slug}-${idx}`}
                className={cn(
                  "stg:inline-flex stg:items-center stg:rounded-md stg:px-1.5 stg:py-0.5",
                  "stg:text-[0.65rem] stg:font-medium",
                  "stg:bg-muted stg:text-muted-foreground",
                  "stg:border stg:border-border",
                )}
              >
                {resolveEnvName(ref.slug)}
              </span>
            ))}
          </div>
        )}
      </td>

      <td className="stg:px-4 stg:py-2.5" onClick={(e) => e.stopPropagation()}>
        {id ? (
          <ResourceVisibilityControl
            kind="agentInstance"
            resourceId={id}
            visibility={meta?.visibility ?? ApiResourceVisibility.visibility_private}
            onChanged={refetch}
          />
        ) : (
          <span className="stg:text-xs stg:text-muted-foreground">{"\u2014"}</span>
        )}
      </td>

      {/* stopPropagation so opening the kebab never triggers the row's
          click. The menu content itself is portaled, so its items never
          bubble to the row regardless. */}
      <td className="stg:px-4 stg:py-2.5 stg:text-right" onClick={(e) => e.stopPropagation()}>
        {(showStartSession || showDelete) && (
          <ActionMenu>
            <ActionMenu.Trigger
              className="stg:ml-auto"
              aria-label={`Actions for ${meta?.name || meta?.slug}`}
            >
              <MoreHorizontal className="stg:size-4" />
            </ActionMenu.Trigger>
            <ActionMenu.Content>
              {showStartSession && (
                <ActionMenu.Item
                  icon={<Play />}
                  onSelect={() => onStartSessionClick?.(instance)}
                >
                  Start session
                </ActionMenu.Item>
              )}
              {showStartSession && showDelete && <ActionMenu.Separator />}
              {showDelete && (
                <ActionMenu.Item
                  icon={<Trash2 />}
                  variant="destructive"
                  onSelect={() => onDeleteClick?.(instance)}
                >
                  Delete
                </ActionMenu.Item>
              )}
            </ActionMenu.Content>
          </ActionMenu>
        )}
      </td>
    </tr>
  );
}

function LoadingSkeleton() {
  return (
    <div className="stg:space-y-2 stg:py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="stg:h-12 stg:animate-pulse stg:rounded-md stg:bg-muted-faint" />
      ))}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
