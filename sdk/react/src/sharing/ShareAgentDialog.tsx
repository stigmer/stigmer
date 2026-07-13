"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  MAX_ALLOWED_ORIGINS,
  appendLinkToken,
  buildEmbedSnippet,
  chatPath,
  getUserMessage,
  validateOrigin,
  type ResourceRef,
} from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Switch } from "../switch/Switch.js";
import { Tabs, type TabItem } from "../tabs/Tabs.js";
import { toast } from "../feedback/toast.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { useBillingAccount } from "../billing/useBillingAccount.js";
import { formatCreditBalance } from "../billing/format.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { useAgentShare } from "./useAgentShare.js";
import {
  sharingAudienceFromProto,
  useSaveAgentShare,
  type AgentShareDraft,
  type SharingAudience,
} from "./useSaveAgentShare.js";
import { useRotateShareLink } from "./useRotateShareLink.js";
import { useShareToolReadiness } from "./useShareToolReadiness.js";

/** Maximum length of each visitor message (proto: `string.max_len = 300`). */
const MAX_MESSAGE_LENGTH = 300;

const SHARE_TABS: readonly TabItem[] = [
  { id: "link", label: "Link" },
  { id: "embed", label: "Embed" },
  { id: "developer", label: "Developer" },
];

const PLATFORM_CLIENT_DOCS_URL =
  "https://docs.stigmer.ai/guides/authentication/platform-client/overview";

/** Props for {@link ShareAgentDialog}. */
export interface ShareAgentDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** The agent whose sharing is managed. */
  readonly agent: Agent;
  /**
   * Builds the absolute public chat URL for the shared agent. The host
   * application owns URL construction (its configured public origin may
   * differ from the rendering origin — e.g. the desktop app). When
   * omitted, falls back to the relative path `/chat/<org>/<slug>`.
   */
  readonly buildShareUrl?: (org: string, slug: string) => string;
  /**
   * Called after any sharing change is persisted. Hosts typically pass
   * the agent data hook's `refetch`.
   */
  readonly onSharingChanged?: () => void;
  /**
   * When `false`, renders as an in-flow open dialog instead of a
   * top-layer modal — no `showModal()`, no backdrop, no focus trap.
   * For embedding the dialog in a constrained surface (documentation
   * demos, visual tests). Interactive hosts keep the default.
   * @default true
   */
  readonly modal?: boolean;
}

/**
 * The Share dialog for an agent: toggle sharing, copy the hosted chat
 * link, copy an embeddable snippet, manage allowed embed origins, bind
 * tool credentials for visitors, customize visitor refusal messages,
 * and discover the PlatformClient SDK path.
 *
 * Sharing is a distinct consent from marketplace visibility: visibility
 * governs who can *read* the blueprint; sharing governs who can *chat*
 * with the running agent — billed to the owning org. The dialog states
 * who pays next to the toggle so enabling sharing never surprises.
 *
 * Sharing lives in its own **AgentShare resource** (decision 011), so
 * the dialog loads the agent's canonical share when it opens and every
 * save is an idempotent `apply` of the complete configuration — the
 * first enable creates the share, later edits update it, one code path
 * (see {@link useSaveAgentShare}). The local draft is refreshed from
 * every returned share, so the dialog never drifts from the server.
 *
 * Built on the native `<dialog>` element for focus trapping and escape
 * handling, matching the SDK's modal convention ({@link ManageAccessDialog}).
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * Most hosts mount it via {@link useShareAgent} (a kebab-menu action).
 * Render it directly only when you own the open-state.
 */
export function ShareAgentDialog({
  open,
  onOpenChange,
  agent,
  buildShareUrl,
  onSharingChanged,
  modal = true,
}: ShareAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    onOpenChange(false);
  }, [onOpenChange]);

  // Sync native dialog open state (matches the SDK dialog convention).
  // Non-modal hosts pass `open` as a plain attribute instead — the dialog
  // renders in-flow with no top layer to manage.
  const prevOpenRef = useRef(false);
  if (modal && open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (open) {
      requestAnimationFrame(() => {
        if (dialogRef.current && !dialogRef.current.open) {
          dialogRef.current.showModal();
        }
      });
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      open={modal ? undefined : open}
      onClose={handleClose}
      className={cn(
        "w-full max-w-lg rounded-xl border border-border bg-popover p-0 shadow-xl",
        modal ? "fixed inset-0 m-auto backdrop:bg-black/50" : "relative",
      )}
      aria-labelledby="share-agent-title"
    >
      {/* Body mounts only while open so the share is re-read per session
          (the draft resets with it) and no fetch fires on a closed dialog. */}
      {open && (
        <ShareAgentDialogBody
          agent={agent}
          buildShareUrl={buildShareUrl}
          onSharingChanged={onSharingChanged}
          onClose={handleClose}
        />
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Dialog body — resolves the canonical share, then hands off to the form
// ---------------------------------------------------------------------------

/**
 * Loads the agent's canonical share and mounts the form once resolved.
 * The split keeps the form's draft seeding synchronous (`useState`
 * initializer from the loaded share) — no hydrate-on-effect, no window
 * where the switch shows a state the server never had.
 */
function ShareAgentDialogBody({
  agent,
  buildShareUrl,
  onSharingChanged,
  onClose,
}: {
  readonly agent: Agent;
  readonly buildShareUrl?: (org: string, slug: string) => string;
  readonly onSharingChanged?: () => void;
  readonly onClose: () => void;
}) {
  const { share, isLoading, error, refetch } = useAgentShare(agent);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2
            id="share-agent-title"
            className="text-base font-semibold text-foreground"
          >
            Share
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {agent.metadata?.name || agent.metadata?.slug}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={cn(
            "rounded-md p-1 text-muted-foreground",
            "hover:text-foreground hover:bg-accent-hover",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      {isLoading ? (
        <div
          className="px-6 py-10 text-center"
          aria-busy="true"
          aria-label="Loading sharing settings"
        >
          <div className="mx-auto h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mx-auto mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      ) : error ? (
        <div className="px-6 py-8 text-center" role="alert">
          <p className="text-sm text-foreground">
            Couldn&apos;t load this agent&apos;s sharing settings.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {getUserMessage(error)}
          </p>
          <button
            type="button"
            onClick={refetch}
            className={cn(
              "mt-3 rounded-md px-3 py-1.5 text-xs font-medium",
              "border border-border text-foreground hover:bg-accent-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Try again
          </button>
        </div>
      ) : (
        <ShareAgentForm
          agent={agent}
          initialShare={share}
          buildShareUrl={buildShareUrl}
          onSharingChanged={onSharingChanged}
        />
      )}

      {/* Footer */}
      <div className="flex items-center justify-end border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          )}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form — owns the share draft for the session
// ---------------------------------------------------------------------------

/**
 * The dialog's editable projection of a share. `null` (never shared)
 * seeds the same defaults the server would apply on first create, so
 * the form needs no "no share yet" special case beyond the disabled
 * copy fields that `enabled: false` already produces.
 */
function draftFromShare(share: AgentShare | null): AgentShareDraft {
  const spec = share?.spec;
  return {
    enabled: spec?.enabled ?? false,
    audience: sharingAudienceFromProto(spec?.audience),
    allowedOrigins: spec?.allowedOrigins ?? [],
    messages: {
      rateLimited: spec?.messages?.rateLimited ?? "",
      unavailable: spec?.messages?.unavailable ?? "",
      conversationEnded: spec?.messages?.conversationEnded ?? "",
    },
    environmentRefs: (spec?.environmentRefs ?? []).map((ref) => ({
      org: ref.org,
      slug: ref.slug,
    })),
  };
}

function ShareAgentForm({
  agent,
  initialShare,
  buildShareUrl,
  onSharingChanged,
}: {
  readonly agent: Agent;
  readonly initialShare: AgentShare | null;
  readonly buildShareUrl?: (org: string, slug: string) => string;
  readonly onSharingChanged?: () => void;
}) {
  const agentName = agent.metadata?.name || (agent.metadata?.slug ?? "");

  // The latest server share is the single baseline: the draft, the link
  // token, and the share id for rotation all derive from it. `null`
  // until the first save creates the share.
  const [share, setShare] = useState<AgentShare | null>(initialShare);
  const [draft, setDraft] = useState<AgentShareDraft>(() =>
    draftFromShare(initialShare),
  );
  const [activeTab, setActiveTab] = useState("link");

  const { save, isPending } = useSaveAgentShare(agent);
  const { rotateShareLink, isPending: isRotating } = useRotateShareLink(
    share?.metadata?.id ?? null,
  );

  // The share's own org/slug form the hosted URL. Before the first save
  // the agent's stand in — exactly the identity the server will assign
  // on create (D2: share slug defaults to the agent's).
  const org = share?.metadata?.org || (agent.metadata?.org ?? "");
  const slug = share?.metadata?.slug || (agent.metadata?.slug ?? "");
  const linkToken = share?.status?.shareLinkToken ?? "";

  // Single commit path: apply the complete draft, adopt the server's
  // returned share as the new baseline, notify the host.
  const commit = useCallback(
    async (next: AgentShareDraft, successMessage: string): Promise<boolean> => {
      try {
        const persisted = await save(next, share);
        if (persisted) {
          setShare(persisted);
          setDraft(draftFromShare(persisted));
        } else {
          setDraft(next);
        }
        toast.success(successMessage);
        onSharingChanged?.();
        return true;
      } catch (err) {
        toast.error(getUserMessage(err));
        return false;
      }
    },
    [save, share, onSharingChanged],
  );

  const handleRotateLink = useCallback(async () => {
    try {
      const updated = await rotateShareLink();
      if (updated) {
        setShare(updated);
      }
      toast.success("Link reset — the old link no longer works");
      onSharingChanged?.();
    } catch (err) {
      toast.error(getUserMessage(err));
    }
  }, [rotateShareLink, onSharingChanged]);

  const handleToggle = useCallback(
    (enabled: boolean) => {
      void commit(
        { ...draft, enabled },
        enabled ? "Sharing enabled" : "Sharing disabled",
      );
    },
    [commit, draft],
  );

  const handleAudienceChange = useCallback(
    (audience: SharingAudience) => {
      if (audience === draft.audience) return;
      // Credential bindings are public-audience only (the proto CEL rule
      // rejects them on org shares — decision 011 addendum), so switching
      // to org drops them, and the toast says so: silent config loss is
      // worse than a wordier confirmation.
      const dropsBindings =
        audience === "org" && draft.environmentRefs.length > 0;
      void commit(
        {
          ...draft,
          audience,
          environmentRefs: dropsBindings ? [] : draft.environmentRefs,
        },
        audience === "org"
          ? dropsBindings
            ? "Only organization members can chat now — tool credential bindings were removed (they apply to public links only)"
            : "Only organization members can chat now"
          : "Anyone with the link can chat now",
      );
    },
    [commit, draft],
  );

  const isOrgAudience = draft.audience === "org";
  // Hosts build the base URL; the token rides it only on public shares
  // (org-audience access is gated by membership, not the link token).
  const baseShareUrl = buildShareUrl
    ? buildShareUrl(org, slug)
    : chatPath(org, slug);
  const shareUrl = isOrgAudience
    ? baseShareUrl
    : appendLinkToken(baseShareUrl, linkToken);

  return (
    <>
      {/* Sharing master switch — governs every tab, so it sits above them. */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span
              id="share-enabled-label"
              className="text-sm font-medium text-foreground"
            >
              {isOrgAudience
                ? "Organization members can chat"
                : "Anyone with the link can chat"}
            </span>
            <WhoPaysLine org={org} audience={draft.audience} />
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
            aria-labelledby="share-enabled-label"
          />
        </div>
        <AudienceSelector
          audience={draft.audience}
          onChange={handleAudienceChange}
          disabled={isPending}
        />
        <ToolReadinessHint agent={agent} draft={draft} />
      </div>

      {/* Tabs */}
      <div className="px-6 pb-2 pt-3">
        <Tabs
          tabs={SHARE_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          aria-label="Sharing options"
        >
          <div className="pt-4">
            {activeTab === "link" && (
              <LinkTab
                shareUrl={shareUrl}
                org={org}
                agent={agent}
                enabled={draft.enabled}
                draft={draft}
                isPending={isPending}
                commit={commit}
                hasLinkToken={linkToken !== ""}
                isRotating={isRotating}
                onResetLink={handleRotateLink}
              />
            )}
            {activeTab === "embed" && (
              <EmbedTab
                shareUrl={shareUrl}
                org={org}
                slug={slug}
                agentName={agentName}
                linkToken={linkToken}
                enabled={draft.enabled}
                draft={draft}
                isPending={isPending}
                commit={commit}
              />
            )}
            {activeTab === "developer" && <DeveloperTab org={org} slug={slug} />}
          </div>
        </Tabs>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tool readiness — visitors' tool use needs credentials bound to the share
// ---------------------------------------------------------------------------

/**
 * Pre-flight hint for tool-using agents: visitors' chats receive
 * credentials only from the share's own environment bindings, so a
 * tool-using agent with no bindings (`needs-credentials`) or a binding
 * that is still private (`blocked`) will fail at the visitor's first
 * message. Renders nothing when there is nothing to fix — sharing stays
 * one toggle; this only catches the misconfiguration at share time.
 */
function ToolReadinessHint({
  agent,
  draft,
}: {
  readonly agent: Agent;
  readonly draft: AgentShareDraft;
}) {
  const readiness = useShareToolReadiness(agent, draft);

  if (readiness.status === "needs-credentials") {
    return (
      <p className="mt-2 text-xs text-warning" role="status">
        Visitors&apos; chats can&apos;t use this agent&apos;s tools yet: no
        credentials are bound to this share. Bind an org-shared environment
        under <span className="font-medium">Tool credentials</span> in the
        Link tab below.
      </p>
    );
  }

  if (readiness.status !== "blocked") {
    return null;
  }

  const envList = readiness.privateEnvironments.join(", ");
  const plural = readiness.privateEnvironments.length > 1;

  return (
    <p className="mt-2 text-xs text-warning" role="status">
      Visitors&apos; chats can&apos;t use this agent&apos;s tools yet: the
      environment{plural ? "s" : ""} <span className="font-medium">{envList}</span>{" "}
      {plural ? "are" : "is"} private. Share {plural ? "them" : "it"} with your
      organization (Settings &rarr; Environments) so visitor runs can use the
      credentials. Secret values stay hidden either way.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Audience — who can chat over the hosted link
// ---------------------------------------------------------------------------

const AUDIENCE_OPTIONS: readonly {
  readonly value: SharingAudience;
  readonly label: string;
}[] = [
  { value: "public", label: "Public link" },
  { value: "org", label: "Org members" },
];

/**
 * Segmented control choosing between the two sharing audiences. Mutually
 * exclusive by nature, so a radio group (not toggles); the master switch
 * above stays the single on/off.
 */
function AudienceSelector({
  audience,
  onChange,
  disabled,
}: {
  readonly audience: SharingAudience;
  readonly onChange: (audience: SharingAudience) => void;
  readonly disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Who can chat"
      className="mt-3 inline-flex rounded-md border border-border p-0.5"
    >
      {AUDIENCE_OPTIONS.map(({ value, label }) => {
        const selected = audience === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(value)}
            disabled={disabled}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Who pays — cost attribution is always the org in the share URL
// ---------------------------------------------------------------------------

function WhoPaysLine({
  org,
  audience,
}: {
  readonly org: string;
  readonly audience: SharingAudience;
}) {
  const mode = useDeploymentMode();
  // An Organization's id equals its slug (see ApiResourceMetadata.id), so
  // the share's org reference is directly usable as the billing org id.
  // Cloud-only: local mode has no billing accounts.
  const { account } = useBillingAccount(mode === "cloud" ? org : null);

  const balance =
    account?.balance !== undefined
      ? formatCreditBalance(account.balance?.availableMicros)
      : null;

  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {audience === "org" ? "Members" : "Visitors"} chat on{" "}
      <span className="font-medium">{org}</span>&apos;s credits
      {balance !== null && <> ({balance} available)</>}.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Link tab
// ---------------------------------------------------------------------------

/**
 * Names the reason the copy fields above are grayed out: sharing is off, so
 * the link/embed would lead to NOT_FOUND (the fields stay disabled — handing
 * out a dead link is worse than a disabled button). Points at the master
 * switch as the remedy.
 */
function SharingOffHint({ subject }: { readonly subject: string }) {
  return (
    <p className="text-xs text-muted-foreground" role="status">
      Sharing is off, so {subject} doesn&apos;t work yet — turn on the switch
      above to activate it.
    </p>
  );
}

function LinkTab({
  shareUrl,
  org,
  agent,
  enabled,
  draft,
  isPending,
  commit,
  hasLinkToken,
  isRotating,
  onResetLink,
}: {
  readonly shareUrl: string;
  readonly org: string;
  readonly agent: Agent;
  readonly enabled: boolean;
  readonly draft: AgentShareDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: AgentShareDraft,
    successMessage: string,
  ) => Promise<boolean>;
  readonly hasLinkToken: boolean;
  readonly isRotating: boolean;
  readonly onResetLink: () => void;
}) {
  const isOrgAudience = draft.audience === "org";

  return (
    <div className="flex flex-col gap-4">
      <CopyField
        label={isOrgAudience ? "Member chat link" : "Public chat link"}
        value={shareUrl}
        copyLabel="Link"
        disabled={!enabled}
        openHref={enabled ? shareUrl : undefined}
      />
      {!enabled && <SharingOffHint subject="this link" />}

      {isOrgAudience ? (
        <p className="text-xs text-muted-foreground">
          Only signed-in members of <span className="font-medium">{org}</span>{" "}
          can chat. Access is checked on every message, so it ends the moment
          someone leaves the organization. The link is safe to forward — it
          shows nothing to anyone else.
        </p>
      ) : (
        <p className="text-xs text-warning">
          Public links can be forwarded and indexed by search engines.
          Don&apos;t share agents that know internal or confidential
          information — or switch the audience to org members.
        </p>
      )}

      {!isOrgAudience && (
        <ResetLinkControl
          enabled={enabled}
          hasLinkToken={hasLinkToken}
          isRotating={isRotating}
          onResetLink={onResetLink}
        />
      )}

      {!isOrgAudience && (
        <ToolCredentialsSection
          org={org}
          agent={agent}
          draft={draft}
          isPending={isPending}
          commit={commit}
        />
      )}

      <MessagesEditor draft={draft} isPending={isPending} commit={commit} />
    </div>
  );
}

/**
 * The "kill a leaked link" lever: rotating generates a fresh `?k=` token
 * so the old URL stops working immediately — sharing stays on, the agent
 * keeps its name. Public audience only; org shares revoke via membership.
 */
function ResetLinkControl({
  enabled,
  hasLinkToken,
  isRotating,
  onResetLink,
}: {
  readonly enabled: boolean;
  readonly hasLinkToken: boolean;
  readonly isRotating: boolean;
  readonly onResetLink: () => void;
}) {
  return (
    <section className={cn(!enabled && "opacity-50")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xs font-medium text-muted-foreground">
            Reset link
          </h3>
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
            {hasLinkToken
              ? "Generates a new link and kills the current one immediately — even mid-conversation. Re-share the new link with the people who should keep access."
              : "Got forwarded further than you wanted? Resetting locks the link behind a secret and kills the plain address immediately."}
          </p>
        </div>
        <button
          type="button"
          onClick={onResetLink}
          disabled={!enabled || isRotating}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
            "border border-border text-foreground hover:bg-accent-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isRotating ? "Resetting…" : "Reset link"}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tool credentials — org-shared environments bound to the share for visitors
// ---------------------------------------------------------------------------

/**
 * Binds org-shared environments to the share's `environment_refs` — the
 * consent act that makes a tool-using agent work for visitors (decision
 * 011: credentials belong to the channel, never to the agent's pristine
 * default instance). Public audience only; the section disappears for
 * org shares, whose member sessions carry no share linkage in Phase A.
 *
 * Expanded by default when the agent uses MCP tools — for those agents
 * this is essential configuration, not an advanced option.
 */
function ToolCredentialsSection({
  org,
  agent,
  draft,
  isPending,
  commit,
}: {
  readonly org: string;
  readonly agent: Agent;
  readonly draft: AgentShareDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: AgentShareDraft,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const hasMcpTools = (agent.spec?.mcpServerUsages?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(
    hasMcpTools || draft.environmentRefs.length > 0,
  );

  const handleChange = useCallback(
    (refs: ResourceRef[]) => {
      const added = refs.length > draft.environmentRefs.length;
      void commit(
        { ...draft, environmentRefs: refs },
        added ? "Credentials bound" : "Credential bindings updated",
      );
    },
    [commit, draft],
  );

  // Only org-shared environments are guest-usable (the runtime merge
  // skips private ones — decision 006), so offering others would bind
  // credentials that silently never apply.
  const onlyOrgShared = useCallback(
    (env: Environment) =>
      env.metadata?.visibility === ApiResourceVisibility.visibility_org,
    [],
  );

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        )}
      >
        <ChevronIcon
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
        Tool credentials
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[0.65rem] text-muted-foreground">
            Environments whose values visitors&apos; chats can use — bind one
            holding the credentials this agent&apos;s tools need (a read-only
            token is safest). Only environments shared with your organization
            can be bound; share one first in Settings &rarr; Environments.
            Secret values stay hidden from visitors either way.
          </p>
          <EnvironmentPicker
            org={org}
            value={draft.environmentRefs}
            onChange={handleChange}
            disabled={isPending}
            filterEnvironment={onlyOrgShared}
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Embed tab
// ---------------------------------------------------------------------------

/**
 * The app origin the loader is served from — derived from the share URL
 * the host built. Empty when the host never wired `buildShareUrl` (a
 * relative share URL), which degrades {@link buildEmbedSnippet} to a
 * relative `/embed.js` — same degradation as the relative link itself.
 */
function appOriginFrom(shareUrl: string): string {
  try {
    return new URL(shareUrl).origin;
  } catch {
    return "";
  }
}

/** The no-JavaScript alternative: a plain iframe onto the hosted page. */
function buildIframeSnippet(shareUrl: string, agentName: string): string {
  return [
    `<iframe`,
    `  src="${shareUrl}"`,
    `  title="${agentName}"`,
    `  width="400"`,
    `  height="600"`,
    `  style="border: 0; border-radius: 12px;"`,
    `></iframe>`,
  ].join("\n");
}

function EmbedTab({
  shareUrl,
  org,
  slug,
  agentName,
  linkToken,
  enabled,
  draft,
  isPending,
  commit,
}: {
  readonly shareUrl: string;
  readonly org: string;
  readonly slug: string;
  readonly agentName: string;
  readonly linkToken: string;
  readonly enabled: boolean;
  readonly draft: AgentShareDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: AgentShareDraft,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const scriptSnippet = useMemo(
    () =>
      buildEmbedSnippet(appOriginFrom(shareUrl), org, slug, linkToken || undefined),
    [shareUrl, org, slug, linkToken],
  );

  // Embedding serves anonymous visitors via guest tokens, which an
  // org-audience share refuses by design — a sign-in flow inside a
  // third-party iframe is its own project. Say so instead of showing
  // snippets that would render nothing.
  if (draft.audience === "org") {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Embedding isn&apos;t available for org-members-only sharing: embeds
        serve anonymous visitors, and this agent requires a signed-in
        organization member. Switch the audience to{" "}
        <span className="font-medium">Public link</span> to embed it on a
        site.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CopyField
        label="Embed on your site"
        value={scriptSnippet}
        copyLabel="Embed code"
        disabled={!enabled}
        multiline
      />
      {!enabled && <SharingOffHint subject="this embed" />}
      <p className="text-xs text-muted-foreground">
        The widget hides itself on sites that aren&apos;t allowed to embed
        this agent. Free embeds show a &quot;Powered by Stigmer&quot; badge.
      </p>

      <OriginsEditor draft={draft} isPending={isPending} commit={commit} />

      <IframeAlternative
        shareUrl={shareUrl}
        agentName={agentName}
        enabled={enabled}
      />
    </div>
  );
}

/**
 * Collapsible fallback for hosts that cannot run scripts (locked-down CMSes,
 * strict sanitizers). Same widget, same origin enforcement — minus the
 * hide-on-refusal behavior the loader provides.
 */
function IframeAlternative({
  shareUrl,
  agentName,
  enabled,
}: {
  readonly shareUrl: string;
  readonly agentName: string;
  readonly enabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const snippet = useMemo(
    () => buildIframeSnippet(shareUrl, agentName),
    [shareUrl, agentName],
  );

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        )}
      >
        <ChevronIcon
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
        No-JavaScript alternative
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[0.65rem] text-muted-foreground">
            For sites that can&apos;t run scripts. A blocked embed shows an
            empty frame instead of hiding.
          </p>
          <CopyField
            label="Iframe embed"
            value={snippet}
            copyLabel="Iframe code"
            disabled={!enabled}
            multiline
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Allowed origins editor
// ---------------------------------------------------------------------------

function OriginsEditor({
  draft,
  isPending,
  commit,
}: {
  readonly draft: AgentShareDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: AgentShareDraft,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [newOrigin, setNewOrigin] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    const value = newOrigin.trim();
    const validationError = validateOrigin(value);
    if (validationError) {
      setInputError(validationError);
      return;
    }
    if (draft.allowedOrigins.includes(value)) {
      setInputError("That origin is already in the list");
      return;
    }
    if (draft.allowedOrigins.length >= MAX_ALLOWED_ORIGINS) {
      setInputError(`At most ${MAX_ALLOWED_ORIGINS} origins are allowed`);
      return;
    }
    setInputError(null);
    const ok = await commit(
      { ...draft, allowedOrigins: [...draft.allowedOrigins, value] },
      "Origin added",
    );
    if (ok) setNewOrigin("");
  }, [newOrigin, draft, commit]);

  const handleRemove = useCallback(
    (origin: string) => {
      void commit(
        {
          ...draft,
          allowedOrigins: draft.allowedOrigins.filter((o) => o !== origin),
        },
        "Origin removed",
      );
    },
    [draft, commit],
  );

  return (
    <section>
      <h3 className="text-xs font-medium text-muted-foreground">
        Allowed embed origins
      </h3>
      <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
        Sites allowed to embed this agent. An empty list allows any site;
        adding origins restricts embedding to those sites. The hosted link
        works either way.
      </p>

      {draft.allowedOrigins.length > 0 && (
        <ul className="mt-2 flex flex-col divide-y divide-border rounded-md border border-border">
          {draft.allowedOrigins.map((origin) => (
            <li
              key={origin}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5"
            >
              <code className="truncate font-mono text-xs text-foreground">
                {origin}
              </code>
              <button
                type="button"
                onClick={() => handleRemove(origin)}
                disabled={isPending}
                aria-label={`Remove ${origin}`}
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground",
                  "hover:bg-destructive-subtle hover:text-destructive",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <RemoveIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={newOrigin}
            onChange={(e) => {
              setNewOrigin(e.target.value);
              if (inputError) setInputError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
            placeholder="https://example.com"
            aria-label="Add allowed origin"
            aria-invalid={inputError != null}
            className={cn(
              "w-full rounded-md border border-border bg-input-bg px-2 py-1.5 font-mono text-xs text-foreground",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          />
          {inputError && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {inputError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={isPending || !newOrigin.trim()}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
            "border border-border text-foreground hover:bg-accent-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Add
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Visitor messages editor (collapsible)
// ---------------------------------------------------------------------------

const MESSAGE_FIELDS = [
  {
    key: "rateLimited",
    label: "Rate limited",
    placeholder: "Shown when a visitor sends messages too quickly",
  },
  {
    key: "unavailable",
    label: "Unavailable",
    placeholder: "Shown when the agent is temporarily unavailable",
  },
  {
    key: "conversationEnded",
    label: "Conversation ended",
    placeholder: "Shown when a conversation reaches its limit",
  },
] as const;

function MessagesEditor({
  draft,
  isPending,
  commit,
}: {
  readonly draft: AgentShareDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: AgentShareDraft,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [localMessages, setLocalMessages] = useState(draft.messages);

  const isDirty =
    localMessages.rateLimited !== draft.messages.rateLimited ||
    localMessages.unavailable !== draft.messages.unavailable ||
    localMessages.conversationEnded !== draft.messages.conversationEnded;

  const handleSave = useCallback(() => {
    void commit({ ...draft, messages: localMessages }, "Messages saved");
  }, [commit, draft, localMessages]);

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        )}
      >
        <ChevronIcon
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
        Customize visitor messages
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-[0.65rem] text-muted-foreground">
            Shown to visitors when a limit is reached. Leave empty to use the
            platform defaults.
          </p>
          {MESSAGE_FIELDS.map(({ key, label, placeholder }) => (
            <MessageField
              key={key}
              label={label}
              placeholder={placeholder}
              value={localMessages[key]}
              onChange={(value) =>
                setLocalMessages((prev) => ({ ...prev, [key]: value }))
              }
            />
          ))}
          {isDirty && (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setLocalMessages(draft.messages)}
                disabled={isPending}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  "border border-border text-foreground hover:bg-accent-hover",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  "bg-primary text-primary-foreground hover:bg-primary-hover",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                Save messages
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MessageField({
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        <span className="tabular-nums text-[0.65rem]">
          {value.length}/{MAX_MESSAGE_LENGTH}
        </span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
        placeholder={placeholder}
        rows={2}
        maxLength={MAX_MESSAGE_LENGTH}
        className={cn(
          "w-full resize-y rounded-md border border-border bg-input-bg px-2 py-1.5 text-xs text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring",
        )}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Developer tab — the graduation ladder to the full SDK
// ---------------------------------------------------------------------------

function buildDeveloperSnippet(org: string, slug: string): string {
  return [
    `import { createPlatformClientAuth } from "@stigmer/sdk/node";`,
    ``,
    `const auth = createPlatformClientAuth({`,
    `  baseUrl: "https://api.stigmer.ai",`,
    `  clientId: process.env.STIGMER_CLIENT_ID,`,
    `  clientSecret: process.env.STIGMER_CLIENT_SECRET,`,
    `});`,
    ``,
    `// Mint tokens for your own users, then chat with ${org}/${slug}`,
    `const { accessToken } = await auth.mintUserToken({`,
    `  userId: "user-123",`,
    `});`,
  ].join("\n");
}

function DeveloperTab({
  org,
  slug,
}: {
  readonly org: string;
  readonly slug: string;
}) {
  const snippet = useMemo(() => buildDeveloperSnippet(org, slug), [org, slug]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Need your own auth, branding, or UI? Create a platform client and
        integrate this agent with the Stigmer SDK — the same runtime, full
        control.
      </p>
      <CopyField
        label="Platform client integration"
        value={snippet}
        copyLabel="Code"
        multiline
      />
      <a
        href={PLATFORM_CLIENT_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "text-xs font-medium text-primary hover:text-primary-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        )}
      >
        Read the platform client guide →
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy field — labeled value with copy (and optional open) affordances
// ---------------------------------------------------------------------------

function CopyField({
  label,
  value,
  copyLabel,
  disabled,
  multiline,
  openHref,
}: {
  readonly label: string;
  readonly value: string;
  readonly copyLabel: string;
  readonly disabled?: boolean;
  readonly multiline?: boolean;
  readonly openHref?: string;
}) {
  const { copy } = useCopyResource();

  return (
    <section className={cn(disabled && "opacity-50")}>
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="mt-1.5 flex items-start gap-1.5">
        {multiline ? (
          <pre
            className={cn(
              "min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted-subtle px-2.5 py-2",
              "font-mono text-xs leading-relaxed text-foreground",
            )}
          >
            {value}
          </pre>
        ) : (
          <code
            className={cn(
              "min-w-0 flex-1 truncate rounded-md border border-border bg-muted-subtle px-2.5 py-1.5",
              "font-mono text-xs text-foreground",
            )}
            title={value}
          >
            {value}
          </code>
        )}
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={() => void copy(value, copyLabel)}
            disabled={disabled}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium",
              "border border-border text-foreground hover:bg-accent-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Copy
          </button>
          {openHref && (
            <a
              href={openHref}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "rounded-md px-2.5 py-1.5 text-center text-xs font-medium",
                "border border-border text-foreground hover:bg-accent-hover",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              Open
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function ChevronIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}
