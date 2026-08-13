"use client";

import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import {
  MAX_ALLOWED_ORIGINS,
  StigmerError,
  appendLinkToken,
  buildEmbedSnippet,
  chatPath,
  getUserMessage,
  validateOrigin,
  type ResourceRef,
} from "@stigmer/sdk";
import { create as createMessage } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { Switch } from "../switch/Switch.js";
import { Tabs, type TabItem } from "../tabs/Tabs.js";
import { toast } from "../feedback/toast.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { useBillingAccount } from "../billing/useBillingAccount.js";
import { formatCreditBalance } from "../billing/format.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { generateSlug } from "../internal/slug.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { getFieldError, validateMessage } from "../internal/validate.js";
import {
  draftFromShare,
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
  "https://stigmer.ai/docs/guides/authentication/platform-client/overview";

/** Props for {@link ShareAgentDialog}. */
export interface ShareAgentDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** The agent whose sharing is managed. */
  readonly agent: Agent;
  /**
   * The exact share to edit. When omitted, the dialog opens in **create
   * mode**: a name/slug step creates a new share in `shareOrg`, then the
   * dialog becomes its editor. The share's identity is immutable once
   * created (decision 011 D2) — edit mode never renames.
   */
  readonly share?: AgentShare | null;
  /**
   * The org that owns (and pays for) a share created by this dialog.
   * Defaults to the agent's own org — the owner's channel. Pass the
   * viewer's org to create a **cross-org share** of another org's
   * marketplace-public agent (decision 013): the share, its billing,
   * its credentials, and its hosted URL all belong to this org, while
   * the agent stays live in its own. Cross-org shares are
   * public-audience only, so the audience selector is hidden in that
   * mode. Ignored in edit mode — an existing share knows its org.
   */
  readonly shareOrg?: string;
  /**
   * Builds the absolute public chat URL for the shared agent. The host
   * application owns URL construction (its configured public origin may
   * differ from the rendering origin — e.g. the desktop app). When
   * omitted, falls back to the relative path `/chat/<org>/<slug>`.
   */
  readonly buildShareUrl?: (org: string, slug: string) => string;
  /**
   * Called after any sharing change is persisted. Hosts typically pass
   * the share list's `refetch`.
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
 * The Share dialog for one agent share: create it (name/slug step), then
 * toggle serving, copy the hosted chat link, copy an embeddable snippet,
 * manage allowed embed origins, bind tool credentials for visitors,
 * customize visitor refusal messages, and discover the PlatformClient
 * SDK path.
 *
 * Sharing is a distinct consent from marketplace visibility: visibility
 * governs who can *read* the blueprint; sharing governs who can *chat*
 * with the running agent — billed to the org that owns the share. The
 * dialog states who pays before creation and next to the toggle, so
 * sharing never surprises.
 *
 * Sharing lives in its own **AgentShare resource** (decision 011), and
 * an agent can carry N shares — each its own channel with its own URL,
 * audience, origins, credentials, and link token (D3). The dialog edits
 * exactly the share it is given; it never resolves "the" share of an
 * agent. Every save is an idempotent `apply` of the complete
 * configuration ({@link useSaveAgentShare}), and the local draft is
 * refreshed from every returned share, so the dialog never drifts from
 * the server.
 *
 * Built on the native `<dialog>` element for focus trapping and escape
 * handling, matching the SDK's modal convention ({@link ManageAccessDialog}).
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * Most hosts mount it via {@link AgentShareList} (the Shares tab).
 * Render it directly only when you own the open-state.
 */
export function ShareAgentDialog({
  open,
  onOpenChange,
  agent,
  share,
  shareOrg,
  buildShareUrl,
  onSharingChanged,
  modal = true,
}: ShareAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Instance-scoped title id (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

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
        "stg:w-full stg:max-w-lg stg:rounded-xl stg:border stg:border-border stg:bg-popover stg:p-0 stg:shadow-xl",
        modal ? "stg:fixed stg:inset-0 stg:m-auto stg:backdrop:bg-black/50" : "stg:relative",
      )}
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so its draft state resets per
          session — reopening the dialog never shows a stale draft. */}
      {open && (
        <ShareAgentDialogBody
          agent={agent}
          share={share ?? null}
          shareOrg={shareOrg}
          buildShareUrl={buildShareUrl}
          onSharingChanged={onSharingChanged}
          onClose={handleClose}
          titleId={titleId}
        />
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Dialog body — create step or editor, depending on the share it was given
// ---------------------------------------------------------------------------

/**
 * Renders the create step (no share yet) or the editor (share in hand).
 * A share persisted by the create step is adopted locally, so one dialog
 * session flows create → edit without remounting — and the editor's
 * draft seeding stays synchronous (`useState` initializer from the
 * share): no hydrate-on-effect, no window where the switch shows a state
 * the server never had.
 */
function ShareAgentDialogBody({
  agent,
  share,
  shareOrg,
  buildShareUrl,
  onSharingChanged,
  onClose,
  titleId,
}: {
  readonly agent: Agent;
  readonly share: AgentShare | null;
  readonly shareOrg?: string;
  readonly buildShareUrl?: (org: string, slug: string) => string;
  readonly onSharingChanged?: () => void;
  readonly onClose: () => void;
  /** Heading id minted by the outer dialog for its aria-labelledby. */
  readonly titleId: string;
}) {
  const [created, setCreated] = useState<AgentShare | null>(null);
  const activeShare = share ?? created;
  const isCreating = activeShare === null;

  const resolvedShareOrg =
    activeShare?.metadata?.org || shareOrg || (agent.metadata?.org ?? "");
  const isCrossOrg = resolvedShareOrg !== (agent.metadata?.org ?? "");

  return (
    <div className="stg:flex stg:flex-col">
      {/* Header */}
      <div className="stg:flex stg:items-start stg:justify-between stg:border-b stg:border-border stg:px-6 stg:py-4">
        <div className="stg:min-w-0">
          <h2
            id={titleId}
            className="stg:text-base stg:font-semibold stg:text-foreground"
          >
            {isCreating ? "Create share" : "Share"}
          </h2>
          <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground">
            {/* Cross-org: qualify the agent so it's clear whose blueprint
                this channel serves — the URL and billing are still yours. */}
            {isCrossOrg
              ? `${agent.metadata?.org}/${agent.metadata?.slug}`
              : agent.metadata?.name || agent.metadata?.slug}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={cn(
            "stg:rounded-md stg:p-1 stg:text-muted-foreground",
            "stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      {isCreating ? (
        <CreateShareForm
          agent={agent}
          shareOrg={resolvedShareOrg}
          onCreated={(persisted) => {
            setCreated(persisted);
            onSharingChanged?.();
          }}
        />
      ) : (
        <ShareAgentForm
          agent={agent}
          initialShare={activeShare}
          buildShareUrl={buildShareUrl}
          onSharingChanged={onSharingChanged}
        />
      )}

      {/* Footer */}
      <div className="stg:flex stg:items-center stg:justify-end stg:border-t stg:border-border stg:px-6 stg:py-3">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium",
            isCreating
              ? "stg:border stg:border-border stg:text-foreground stg:hover:bg-accent-hover"
              : "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring stg:focus:ring-offset-2",
          )}
        >
          {isCreating ? "Cancel" : "Done"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create step — the new share's identity and cost, before any channel exists
// ---------------------------------------------------------------------------

/**
 * Names the new share and creates it live (`enabled: true`, public
 * audience — the server's own defaults). Identity is set here because it
 * is immutable afterward (decision 011 D2): the slug becomes the hosted
 * URL `/chat/<org>/<slug>` in the sharing org's namespace.
 *
 * The slug auto-derives from the name until the user edits it (the
 * {@link CreateOrganizationForm} pattern), validated by the same
 * protovalidate rules the server enforces. An `(org, slug)` collision —
 * the server's ALREADY_EXISTS — surfaces inline on the slug field with a
 * pick-another-slug remedy instead of a generic failure toast.
 */
function CreateShareForm({
  agent,
  shareOrg,
  onCreated,
}: {
  readonly agent: Agent;
  readonly shareOrg: string;
  readonly onCreated: (share: AgentShare) => void;
}) {
  const agentName = agent.metadata?.name || (agent.metadata?.slug ?? "");
  const isCrossOrg = shareOrg !== (agent.metadata?.org ?? "");

  // Instance-scoped field ids (oss#593) — see the outer dialog's titleId.
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const slugId = `${baseId}-slug`;

  const [name, setName] = useState(agentName);
  const [slug, setSlug] = useState(agent.metadata?.slug ?? "");
  // Once the user manually edits the slug field, stop auto-deriving.
  const slugTouchedRef = useRef(false);
  // A server-side (org, slug) collision pins to the slug field until the
  // slug changes — the remedy is picking another slug.
  const [collisionError, setCollisionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { save, isPending } = useSaveAgentShare(agent, shareOrg);

  const trimmedName = name.trim();
  const violations =
    slug.length > 0 || trimmedName.length > 0
      ? validateMessage(
          ApiResourceMetadataSchema,
          createMessage(ApiResourceMetadataSchema, {
            ...(slug.length > 0 && { slug }),
            ...(trimmedName.length > 0 && { name: trimmedName }),
          }),
        )
      : [];
  const slugError =
    collisionError ?? (slug.length > 0 ? getFieldError(violations, "slug") : null);
  const nameError =
    trimmedName.length > 0 ? getFieldError(violations, "name") : null;
  const canSubmit =
    trimmedName !== "" && slug.length > 0 && slugError === null &&
    nameError === null && !isPending;

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    if (!slugTouchedRef.current) {
      setSlug(generateSlug(value.trim()));
      setCollisionError(null);
    }
  }, []);

  const handleSlugChange = useCallback((value: string) => {
    slugTouchedRef.current = true;
    setSlug(value);
    setCollisionError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setSubmitError(null);

      try {
        const persisted = await save(
          // The server's create defaults, made explicit: live from the
          // start (the user's one intent-click is "share it"), public
          // audience, nothing else configured yet.
          { ...draftFromShare(null), enabled: true },
          null,
          { name: trimmedName, slug },
        );
        if (persisted) {
          toast.success("Share created — the link is live");
          onCreated(persisted);
        }
      } catch (err) {
        if (err instanceof StigmerError && err.code === "already-exists") {
          setCollisionError(
            `"${slug}" is already used by another share or resource in ${shareOrg} — pick a different slug`,
          );
        } else {
          // e.g. the cross-org FAILED_PRECONDITION naming non-public
          // dependencies (decision 013 D5) — show the server's words.
          setSubmitError(getUserMessage(err));
        }
      }
    },
    [canSubmit, save, trimmedName, slug, shareOrg, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className="stg:flex stg:flex-col stg:gap-4 stg:px-6 stg:py-4">
      <p className="stg:text-xs stg:text-muted-foreground">
        A share is its own channel to this agent: a hosted chat link with
        its own audience, embed origins, tool credentials, and visitor
        messages.{" "}
        {isCrossOrg && (
          <>
            This one lives in your organization{" "}
            <span className="stg:font-medium">{shareOrg}</span> while the agent
            stays in <span className="stg:font-medium">{agent.metadata?.org}</span>{" "}
            — updates to the agent apply live.{" "}
          </>
        )}
        Visitors chat on <span className="stg:font-medium">{shareOrg}</span>&apos;s
        credits.
      </p>

      {/* ---- Name ---- */}
      <div className="stg:space-y-1">
        <label
          htmlFor={nameId}
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          Name
        </label>
        <input
          id={nameId}
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={isPending}
          required
          maxLength={63}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            nameError ? "stg:border-destructive" : "stg:border-border",
          )}
        />
        {nameError ? (
          <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
            {nameError}
          </p>
        ) : (
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            A display name for this share — e.g. the site or campaign it
            serves.
          </p>
        )}
      </div>

      {/* ---- Slug ---- */}
      <div className="stg:space-y-1">
        <label
          htmlFor={slugId}
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          Slug
        </label>
        <input
          id={slugId}
          type="text"
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          disabled={isPending}
          required
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:bg-input-bg stg:px-2.5 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            slugError ? "stg:border-destructive" : "stg:border-border",
          )}
        />
        {slugError ? (
          <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
            {slugError}
          </p>
        ) : (
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            Becomes the share&apos;s address:{" "}
            <code className="stg:font-mono">
              /chat/{shareOrg}/{slug || "…"}
            </code>
            . Can&apos;t be changed later.
          </p>
        )}
      </div>

      {submitError && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {submitError}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring stg:focus:ring-offset-2",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          {isPending ? "Creating…" : "Create share"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Form — owns the share draft for the session
// ---------------------------------------------------------------------------

function ShareAgentForm({
  agent,
  initialShare,
  buildShareUrl,
  onSharingChanged,
}: {
  readonly agent: Agent;
  readonly initialShare: AgentShare;
  readonly buildShareUrl?: (org: string, slug: string) => string;
  readonly onSharingChanged?: () => void;
}) {
  const agentName = agent.metadata?.name || (agent.metadata?.slug ?? "");

  // Instance-scoped label id (oss#593) — see the outer dialog's titleId.
  const enabledLabelId = useId();

  // The latest server share is the single baseline: the draft, the link
  // token, and the share id for rotation all derive from it.
  const [share, setShare] = useState<AgentShare>(initialShare);
  const [draft, setDraft] = useState<AgentShareDraft>(() =>
    draftFromShare(initialShare),
  );
  const [activeTab, setActiveTab] = useState("link");

  const { save, isPending } = useSaveAgentShare(agent);
  const { rotateShareLink, isPending: isRotating } = useRotateShareLink(
    share.metadata?.id ?? null,
  );

  // The share's own org/slug are the hosted URL — for a cross-org share
  // (decision 013) that org is the sharing org's, not the agent's.
  const org = share.metadata?.org ?? "";
  const slug = share.metadata?.slug ?? "";
  const linkToken = share.status?.shareLinkToken ?? "";
  // Cross-org shares are public-audience only (decision 013 D3) — the
  // audience selector disappears rather than offering a choice the
  // server would refuse.
  const isCrossOrg = org !== (agent.metadata?.org ?? "");

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
      <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
        <div className="stg:flex stg:items-start stg:justify-between stg:gap-4">
          <div className="stg:min-w-0">
            <span
              id={enabledLabelId}
              className="stg:text-sm stg:font-medium stg:text-foreground"
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
            aria-labelledby={enabledLabelId}
          />
        </div>
        {!isCrossOrg && (
          <AudienceSelector
            audience={draft.audience}
            onChange={handleAudienceChange}
            disabled={isPending}
          />
        )}
        <ToolReadinessHint agent={agent} draft={draft} />
      </div>

      {/* Tabs */}
      <div className="stg:px-6 stg:pb-2 stg:pt-3">
        <Tabs
          tabs={SHARE_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          aria-label="Sharing options"
        >
          <div className="stg:pt-4">
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
      <p className="stg:mt-2 stg:text-xs stg:text-warning" role="status">
        Visitors&apos; chats can&apos;t use this agent&apos;s tools yet: no
        credentials are bound to this share. Bind an org-shared environment
        under <span className="stg:font-medium">Tool credentials</span> in the
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
    <p className="stg:mt-2 stg:text-xs stg:text-warning" role="status">
      Visitors&apos; chats can&apos;t use this agent&apos;s tools yet: the
      environment{plural ? "s" : ""} <span className="stg:font-medium">{envList}</span>{" "}
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
      className="stg:mt-3 stg:inline-flex stg:rounded-md stg:border stg:border-border stg:p-0.5"
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
              "stg:rounded stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              selected
                ? "stg:bg-primary stg:text-primary-foreground"
                : "stg:text-muted-foreground stg:hover:text-foreground",
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
    <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
      {audience === "org" ? "Members" : "Visitors"} chat on{" "}
      <span className="stg:font-medium">{org}</span>&apos;s credits
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
    <p className="stg:text-xs stg:text-muted-foreground" role="status">
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
    <div className="stg:flex stg:flex-col stg:gap-4">
      <CopyField
        label={isOrgAudience ? "Member chat link" : "Public chat link"}
        value={shareUrl}
        copyLabel="Link"
        disabled={!enabled}
        openHref={enabled ? shareUrl : undefined}
      />
      {!enabled && <SharingOffHint subject="this link" />}

      {isOrgAudience ? (
        <p className="stg:text-xs stg:text-muted-foreground">
          Only signed-in members of <span className="stg:font-medium">{org}</span>{" "}
          can chat. Access is checked on every message, so it ends the moment
          someone leaves the organization. The link is safe to forward — it
          shows nothing to anyone else.
        </p>
      ) : (
        <p className="stg:text-xs stg:text-warning">
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
    <section className={cn(!enabled && "stg:opacity-50")}>
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-4">
        <div className="stg:min-w-0">
          <h3 className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            Reset link
          </h3>
          <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-muted-foreground">
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
            "stg:shrink-0 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:border stg:border-border stg:text-foreground stg:hover:bg-accent-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
          "stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-muted-foreground",
          "stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
        )}
      >
        <ChevronIcon
          className={cn("stg:size-3 stg:transition-transform", expanded && "stg:rotate-90")}
        />
        Tool credentials
      </button>

      {expanded && (
        <div className="stg:mt-2 stg:flex stg:flex-col stg:gap-2">
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
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
      <p className="stg:text-xs stg:text-muted-foreground" role="status">
        Embedding isn&apos;t available for org-members-only sharing: embeds
        serve anonymous visitors, and this agent requires a signed-in
        organization member. Switch the audience to{" "}
        <span className="stg:font-medium">Public link</span> to embed it on a
        site.
      </p>
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-4">
      <CopyField
        label="Embed on your site"
        value={scriptSnippet}
        copyLabel="Embed code"
        disabled={!enabled}
        multiline
      />
      {!enabled && <SharingOffHint subject="this embed" />}
      <p className="stg:text-xs stg:text-muted-foreground">
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
          "stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-muted-foreground",
          "stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
        )}
      >
        <ChevronIcon
          className={cn("stg:size-3 stg:transition-transform", expanded && "stg:rotate-90")}
        />
        No-JavaScript alternative
      </button>

      {expanded && (
        <div className="stg:mt-2 stg:flex stg:flex-col stg:gap-2">
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
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
      <h3 className="stg:text-xs stg:font-medium stg:text-muted-foreground">
        Allowed embed origins
      </h3>
      <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-muted-foreground">
        Sites allowed to embed this agent. An empty list allows any site;
        adding origins restricts embedding to those sites. The hosted link
        works either way.
      </p>

      {draft.allowedOrigins.length > 0 && (
        <ul className="stg:mt-2 stg:flex stg:flex-col stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border">
          {draft.allowedOrigins.map((origin) => (
            <li
              key={origin}
              className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:px-2.5 stg:py-1.5"
            >
              <code className="stg:truncate stg:font-mono stg:text-xs stg:text-foreground">
                {origin}
              </code>
              <button
                type="button"
                onClick={() => handleRemove(origin)}
                disabled={isPending}
                aria-label={`Remove ${origin}`}
                className={cn(
                  "stg:inline-flex stg:size-5 stg:shrink-0 stg:items-center stg:justify-center stg:rounded stg:text-muted-foreground",
                  "stg:hover:bg-destructive-subtle stg:hover:text-destructive",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                )}
              >
                <RemoveIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="stg:mt-2 stg:flex stg:items-start stg:gap-1.5">
        <div className="stg:min-w-0 stg:flex-1">
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
              "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
              "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            )}
          />
          {inputError && (
            <p role="alert" className="stg:mt-1 stg:text-xs stg:text-destructive">
              {inputError}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={isPending || !newOrigin.trim()}
          className={cn(
            "stg:shrink-0 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:border stg:border-border stg:text-foreground stg:hover:bg-accent-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
          "stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-muted-foreground",
          "stg:hover:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
        )}
      >
        <ChevronIcon
          className={cn("stg:size-3 stg:transition-transform", expanded && "stg:rotate-90")}
        />
        Customize visitor messages
      </button>

      {expanded && (
        <div className="stg:mt-2 stg:flex stg:flex-col stg:gap-3">
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
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
            <div className="stg:flex stg:items-center stg:justify-end stg:gap-1.5">
              <button
                type="button"
                onClick={() => setLocalMessages(draft.messages)}
                disabled={isPending}
                className={cn(
                  "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                  "stg:border stg:border-border stg:text-foreground stg:hover:bg-accent-hover",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className={cn(
                  "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                  "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
    <label className="stg:flex stg:flex-col stg:gap-1">
      <span className="stg:flex stg:items-center stg:justify-between stg:text-xs stg:font-medium stg:text-muted-foreground">
        {label}
        <span className="stg:tabular-nums stg:text-[0.65rem]">
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
          "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
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
    <div className="stg:flex stg:flex-col stg:gap-3">
      <p className="stg:text-xs stg:text-muted-foreground">
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
          "stg:text-xs stg:font-medium stg:text-primary stg:hover:text-primary-muted",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
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
    <section className={cn(disabled && "stg:opacity-50")}>
      <h3 className="stg:text-xs stg:font-medium stg:text-muted-foreground">{label}</h3>
      <div className="stg:mt-1.5 stg:flex stg:items-start stg:gap-1.5">
        {multiline ? (
          <pre
            className={cn(
              "stg:min-w-0 stg:flex-1 stg:overflow-x-auto stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-2.5 stg:py-2",
              "stg:font-mono stg:text-xs stg:leading-relaxed stg:text-foreground",
            )}
          >
            {value}
          </pre>
        ) : (
          <TruncatedText
            text={value}
            className={cn(
              "stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-2.5 stg:py-1.5",
              "stg:font-mono stg:text-xs stg:text-foreground",
            )}
          />
        )}
        <div className="stg:flex stg:shrink-0 stg:flex-col stg:gap-1.5">
          <button
            type="button"
            onClick={() => void copy(value, copyLabel)}
            disabled={disabled}
            className={cn(
              "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
              "stg:border stg:border-border stg:text-foreground stg:hover:bg-accent-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
                "stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-center stg:text-xs stg:font-medium",
                "stg:border stg:border-border stg:text-foreground stg:hover:bg-accent-hover",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
