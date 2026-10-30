"use client";

import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { cn } from "@stigmer/design-tokens";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import {
  MAX_ALLOWED_ORIGINS,
  StigmerError,
  appendLinkToken,
  buildEmbedSnippet,
  chatPath,
  getUserMessage,
  validateOrigin,
  type ResourceRef,
} from "@stigmer/client";
import { create as createMessage } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { Switch } from "../switch/Switch.js";
import { Tabs, type TabItem } from "../tabs/Tabs.js";
import { toast } from "../feedback/toast.js";
import { usePublicBaseUrl } from "../public-base-url-context.js";
import { UnknownPublicAddressNotice } from "../internal/UnknownPublicAddressNotice.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { VaultPicker } from "../vault/VaultPicker.js";
import { generateSlug } from "../internal/slug.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { getFieldError, validateMessage } from "../internal/validate.js";
import { useCreateChannel } from "../channel/useCreateChannel.js";
import { useSaveChannel } from "../channel/useSaveChannel.js";
import {
  draftFromWebChannel,
  webChannelCreateInput,
  webChannelPatch,
  webLinkTokenOf,
  type WebChannelDraft,
  type ChatLinkAudience,
} from "./webChannelDraft.js";
import { useRotateChannelLink } from "./useRotateChannelLink.js";
import { useChatLinkToolReadiness } from "./useChatLinkToolReadiness.js";
import { trimTrailing } from "../internal/trim.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { agentUsesTools } from "../agent/runServers.js";

/** Maximum length of each visitor message (proto: `string.max_len = 300`). */
const MAX_MESSAGE_LENGTH = 300;

const CHAT_LINK_TABS: readonly TabItem[] = [
  { id: "link", label: "Link" },
  { id: "embed", label: "Embed" },
  { id: "developer", label: "Developer" },
];

const PRODUCT_USERS_DOCS_URL =
  "https://stigmer.ai/docs/guides/authentication/product-users";

/** Props for {@link ChatLinkDialog}. */
export interface ChatLinkDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** The agent the chat link reaches. */
  readonly agent: Agent;
  /**
   * The exact chat link (a web channel) to edit. When omitted, the dialog
   * opens in **create mode**: a name/slug step creates a new chat link in
   * the agent's own organization (its URL, billing and credentials belong
   * to that organization), then the dialog becomes its editor. Edit mode
   * never renames; a rename is the Channel kind's own act.
   */
  readonly channel?: Channel | null;
  /**
   * Builds the absolute public chat URL for the chat link. The host
   * application owns URL construction (its configured public origin may
   * differ from the rendering origin — e.g. the desktop app). It receives
   * the web channel's id (`metadata.id`), the one identity a link
   * carries. When omitted, falls back to the relative path
   * `/chat/<channel id>`.
   */
  readonly buildChatLinkUrl?: (channelId: string) => string;
  /**
   * Called after any change to the chat link is persisted. Hosts
   * typically pass the channel list's `refetch`.
   */
  readonly onChannelsChanged?: () => void;
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
 * The dialog for one chat link of an agent: create it (name/slug step), then
 * toggle serving, copy the hosted chat link, copy an embeddable snippet,
 * manage allowed embed origins, bind tool credentials for visitors,
 * customize visitor refusal messages, and discover how to sign a
 * product's own users in through the SDK.
 *
 * A chat link is a distinct consent from marketplace visibility:
 * visibility governs who can *read* the blueprint; a chat link governs who
 * can *chat* with the running agent — billed to the org that owns the
 * link. The dialog states who pays before creation and next to the
 * toggle, so a link never surprises.
 *
 * A chat link is a **web Channel** (the `web` type of the Channel kind), and
 * an agent can carry N of them — each with its own URL, audience,
 * origins, credentials, and link token. The dialog edits exactly the
 * channel it is given; it never resolves "the" chat link of an agent. A
 * create is a strict create (`useCreateChannel`); every later save names
 * the complete draft on the channel as loaded (`useSaveChannel`), and
 * the local draft is refreshed from every returned channel, so the
 * dialog never drifts from the server.
 *
 * Built on the native `<dialog>` element for focus trapping and escape
 * handling, matching the SDK's modal convention ({@link ManageAccessDialog}).
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * Most hosts mount it via {@link ChannelsPanel} (the agent's Channels tab).
 * Render it directly only when you own the open-state.
 */
export function ChatLinkDialog({
  open,
  onOpenChange,
  agent,
  channel,
  buildChatLinkUrl,
  onChannelsChanged,
  modal = true,
}: ChatLinkDialogProps) {
  // Instance-scoped title id (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      width="lg"
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so its draft state resets per
          session — reopening the dialog never shows a stale draft. */}
      {open && (
        <ChatLinkDialogBody
          agent={agent}
          channel={channel ?? null}
          buildChatLinkUrl={buildChatLinkUrl}
          onChannelsChanged={onChannelsChanged}
          onClose={handleClose}
          titleId={titleId}
        />
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Dialog body — create step or editor, depending on the channel it was given
// ---------------------------------------------------------------------------

/**
 * Renders the create step (no chat link yet) or the editor (link in hand).
 * A chat link persisted by the create step is adopted locally, so one dialog
 * session flows create → edit without remounting — and the editor's
 * draft seeding stays synchronous (`useState` initializer from the
 * channel): no hydrate-on-effect, no window where the switch shows a state
 * the server never had.
 */
function ChatLinkDialogBody({
  agent,
  channel,
  buildChatLinkUrl,
  onChannelsChanged,
  onClose,
  titleId,
}: {
  readonly agent: Agent;
  readonly channel: Channel | null;
  readonly buildChatLinkUrl?: (channelId: string) => string;
  readonly onChannelsChanged?: () => void;
  readonly onClose: () => void;
  /** Heading id minted by the outer dialog for its aria-labelledby. */
  readonly titleId: string;
}) {
  const [created, setCreated] = useState<Channel | null>(null);
  const activeChannel = channel ?? created;
  const isCreating = activeChannel === null;

  return (
    <div className="stg:flex stg:flex-col">
      {/* Header */}
      <div className="stg:flex stg:items-start stg:justify-between stg:border-b stg:border-border stg:px-6 stg:py-4">
        <div className="stg:min-w-0">
          <h2
            id={titleId}
            className="stg:text-base stg:font-semibold stg:text-foreground"
          >
            {isCreating ? "Create a chat link" : "Chat link"}
          </h2>
          <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground">
            {agent.metadata?.name || agent.metadata?.slug}
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
        <CreateChatLinkForm
          agent={agent}
          onCreated={(persisted) => {
            setCreated(persisted);
            onChannelsChanged?.();
          }}
        />
      ) : (
        <ChatLinkForm
          agent={agent}
          initialChannel={activeChannel}
          buildChatLinkUrl={buildChatLinkUrl}
          onChannelsChanged={onChannelsChanged}
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
// Create step — the new chat link's identity and cost, before any channel exists
// ---------------------------------------------------------------------------

/**
 * Names the new chat link, asks who can chat, and creates it live
 * (`enabled: true`). The audience starts at "Organization members", the
 * server's own default: a link reaches the internet only when the owner
 * picks "Anyone with the link". Identity is set here: the slug names the
 * chat link in the agent's organization for the CLI and API. The hosted
 * link names the channel by its id, so it exists only once the channel
 * does.
 *
 * The slug auto-derives from the name until the user edits it (the
 * {@link CreateOrganizationForm} pattern), validated by the same
 * protovalidate rules the server enforces. An `(org, slug)` collision —
 * the server's ALREADY_EXISTS — surfaces inline on the slug field with a
 * pick-another-slug remedy instead of a generic failure toast.
 */
function CreateChatLinkForm({
  agent,
  onCreated,
}: {
  readonly agent: Agent;
  readonly onCreated: (channel: Channel) => void;
}) {
  const agentName = agent.metadata?.name || (agent.metadata?.slug ?? "");
  const linkOrg = agent.metadata?.org ?? "";

  // Instance-scoped field ids (oss#593) — see the outer dialog's titleId.
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const slugId = `${baseId}-slug`;

  const [name, setName] = useState(agentName);
  const [slug, setSlug] = useState(agent.metadata?.slug ?? "");
  const [audience, setAudience] = useState<ChatLinkAudience>("org");
  // Once the user manually edits the slug field, stop auto-deriving.
  const slugTouchedRef = useRef(false);
  // A server-side (org, slug) collision pins to the slug field until the
  // slug changes — the remedy is picking another slug.
  const [collisionError, setCollisionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { createChannel, isPending } = useCreateChannel();

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
        // A strict create: the agent organization's channels of every
        // type share one slug namespace, so a slug another channel holds
        // is refused (ALREADY_EXISTS), never applied over that channel.
        const persisted = await createChannel(
          webChannelCreateInput(
            agent,
            // Live from the start (the user's one intent-click is "make a
            // link"), for the audience chosen above, nothing else configured
            // yet.
            { ...draftFromWebChannel(null), enabled: true, audience },
            { name: trimmedName, slug },
          ),
        );
        toast.success("Chat link created — the link is live");
        onCreated(persisted);
      } catch (err) {
        if (err instanceof StigmerError && err.code === "already-exists") {
          setCollisionError(
            `"${slug}" is already used by another channel in ${linkOrg} — pick a different slug`,
          );
        } else {
          // Any other refusal (a permission the caller lacks, a
          // precondition the server names) — show the server's words.
          setSubmitError(getUserMessage(err));
        }
      }
    },
    [canSubmit, createChannel, agent, trimmedName, slug, audience, linkOrg, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className="stg:flex stg:flex-col stg:gap-4 stg:px-6 stg:py-4">
      <p className="stg:text-xs stg:text-muted-foreground">
        A chat link is its own channel to this agent: a hosted link with
        its own audience, embed origins, tool credentials, and visitor
        messages. Visitors chat on{" "}
        <span className="stg:font-medium">{linkOrg}</span>&apos;s own provider keys.
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
          <p className="stg:text-2xs stg:text-destructive" role="alert">
            {nameError}
          </p>
        ) : (
          <p className="stg:text-2xs stg:text-muted-foreground">
            A display name for this chat link — e.g. the site or campaign it
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
          <p className="stg:text-2xs stg:text-destructive" role="alert">
            {slugError}
          </p>
        ) : (
          <p className="stg:text-2xs stg:text-muted-foreground">
            Names this chat link in the CLI and API. The link itself is made
            when you create it.
          </p>
        )}
      </div>

      {/* ---- Who can chat ---- */}
      <div className="stg:space-y-1">
        <span className="stg:block stg:text-xs stg:font-medium stg:text-foreground">
          Who can chat
        </span>
        <AudienceSelector audience={audience} onChange={setAudience} disabled={isPending} />
        <p className="stg:text-2xs stg:text-muted-foreground">
          {audience === "org"
            ? "Only signed-in members of the organization can chat. You can change this later."
            : "Anyone who has the link can chat, without signing in. You can change this later."}
        </p>
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
          {isPending ? "Creating…" : "Create chat link"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Form — owns the chat link's draft for the session
// ---------------------------------------------------------------------------

function ChatLinkForm({
  agent,
  initialChannel,
  buildChatLinkUrl,
  onChannelsChanged,
}: {
  readonly agent: Agent;
  readonly initialChannel: Channel;
  readonly buildChatLinkUrl?: (channelId: string) => string;
  readonly onChannelsChanged?: () => void;
}) {
  const agentName = agent.metadata?.name || (agent.metadata?.slug ?? "");

  // Instance-scoped label id (oss#593) — see the outer dialog's titleId.
  const enabledLabelId = useId();

  // The latest server channel is the single baseline: the draft, the link
  // token, and the channel id for rotation all derive from it.
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [draft, setDraft] = useState<WebChannelDraft>(() =>
    draftFromWebChannel(initialChannel),
  );
  const [activeTab, setActiveTab] = useState("link");

  const { update, isPending } = useSaveChannel();
  const { rotateLink, isPending: isRotating } = useRotateChannelLink(
    channel.metadata?.id ?? null,
  );

  // The hosted link names the channel by its id; org and slug are its
  // billing organization and its name there.
  const channelId = channel.metadata?.id ?? "";
  const org = channel.metadata?.org ?? "";
  const slug = channel.metadata?.slug ?? "";
  const linkToken = webLinkTokenOf(channel);

  // Single commit path: save every draft field on the channel as loaded,
  // adopt the server's returned channel as the new baseline, notify the
  // host.
  const commit = useCallback(
    async (next: WebChannelDraft, successMessage: string): Promise<boolean> => {
      try {
        const persisted = await update(channel, webChannelPatch(next));
        setChannel(persisted);
        setDraft(draftFromWebChannel(persisted));
        toast.success(successMessage);
        onChannelsChanged?.();
        return true;
      } catch (err) {
        toast.error(getUserMessage(err));
        return false;
      }
    },
    [update, channel, onChannelsChanged],
  );

  const handleRotateLink = useCallback(async () => {
    try {
      const updated = await rotateLink();
      if (updated) {
        setChannel(updated);
      }
      toast.success("Link reset — the old link no longer works");
      onChannelsChanged?.();
    } catch (err) {
      toast.error(getUserMessage(err));
    }
  }, [rotateLink, onChannelsChanged]);

  const handleToggle = useCallback(
    (enabled: boolean) => {
      void commit(
        { ...draft, enabled },
        enabled ? "Chat link resumed" : "Chat link paused",
      );
    },
    [commit, draft],
  );

  const handleAudienceChange = useCallback(
    (audience: ChatLinkAudience) => {
      if (audience === draft.audience) return;
      // Credential bindings are public-audience only (the proto CEL rule
      // rejects them on org chat links), so switching
      // to org drops them, and the toast says so: silent config loss is
      // worse than a wordier confirmation.
      const dropsBindings =
        audience === "org" && draft.vaults.length > 0;
      void commit(
        {
          ...draft,
          audience,
          vaults: dropsBindings ? [] : draft.vaults,
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
  // Hosts build the base URL; the token rides it only on public chat links
  // (org-audience access is gated by membership, not the link token).
  const baseLinkUrl = buildChatLinkUrl
    ? buildChatLinkUrl(channelId)
    : chatPath(channelId);
  const linkUrl = isOrgAudience
    ? baseLinkUrl
    : appendLinkToken(baseLinkUrl, linkToken);

  return (
    <>
      {/* The link's on/off switch — governs every tab, so it sits above them. */}
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
        <AudienceSelector
          audience={draft.audience}
          onChange={handleAudienceChange}
          disabled={isPending}
          className="stg:mt-3"
        />
        <ToolReadinessHint agent={agent} draft={draft} />
      </div>

      {/* Tabs */}
      <div className="stg:px-6 stg:pb-2 stg:pt-3">
        <Tabs
          tabs={CHAT_LINK_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          aria-label="Chat link options"
        >
          <div className="stg:pt-4">
            {activeTab === "link" && (
              <LinkTab
                linkUrl={linkUrl}
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
                linkUrl={linkUrl}
                channelId={channelId}
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
// Tool readiness — visitors' tool use needs a vault named on the chat link
// ---------------------------------------------------------------------------

/**
 * Pre-flight hint for tool-using agents: visitors' chats use only the
 * chat link's own vaults, so a tool-using agent naming none
 * (`needs-credentials`) or naming one that cannot serve (`blocked`) will
 * fail at the visitor's first message. Renders nothing when there is nothing to fix — a chat link stays
 * one toggle; this only catches the misconfiguration when the link is made.
 */
function ToolReadinessHint({
  agent,
  draft,
}: {
  readonly agent: Agent;
  readonly draft: WebChannelDraft;
}) {
  const readiness = useChatLinkToolReadiness(agent, draft);

  if (readiness.status === "needs-credentials") {
    return (
      <p className="stg:mt-2 stg:text-xs stg:text-status-degraded" role="status">
        Visitors&apos; chats can&apos;t use this agent&apos;s tools yet: this
        chat link names no vault. Name a shared vault under{" "}
        <span className="stg:font-medium">Tool credentials</span> in the Link
        tab below.
      </p>
    );
  }

  if (readiness.status !== "blocked") {
    return null;
  }

  const vaultList = readiness.unusableVaults.join(", ");
  const plural = readiness.unusableVaults.length > 1;

  return (
    <p className="stg:mt-2 stg:text-xs stg:text-status-degraded" role="status">
      Visitors&apos; chats can&apos;t use this agent&apos;s tools yet: the
      vault{plural ? "s" : ""} <span className="stg:font-medium">{vaultList}</span>{" "}
      {plural ? "are" : "is"} not a shared vault you can read. Name a shared
      vault instead (Settings &rarr; Vaults). Saved values stay hidden either way.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Audience — who can chat over the hosted link
// ---------------------------------------------------------------------------

const AUDIENCE_OPTIONS: readonly {
  readonly value: ChatLinkAudience;
  readonly label: string;
}[] = [
  { value: "org", label: "Organization members" },
  { value: "public", label: "Anyone with the link" },
];

/**
 * Segmented control choosing between the two chat-link audiences. Mutually
 * exclusive by nature, so a radio group (not toggles); the master switch
 * above stays the single on/off.
 */
function AudienceSelector({
  audience,
  onChange,
  disabled,
  className,
}: {
  readonly audience: ChatLinkAudience;
  readonly onChange: (audience: ChatLinkAudience) => void;
  readonly disabled: boolean;
  readonly className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Who can chat"
      className={cn(
        "stg:inline-flex stg:rounded-md stg:border stg:border-border stg:p-0.5",
        className,
      )}
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
// Who pays — the chat link's own org (metadata.org), whose provider keys serve
// every chat
// ---------------------------------------------------------------------------

function WhoPaysLine({
  org,
  audience,
}: {
  readonly org: string;
  readonly audience: ChatLinkAudience;
}) {
  const slugForOrg = useOrgSlugForId();

  return (
    <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
      {audience === "org" ? "Members" : "Visitors"} chat on{" "}
      <span className="stg:font-medium">{slugForOrg(org)}</span>&apos;s own provider keys.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Link tab
// ---------------------------------------------------------------------------

/**
 * Names the reason the copy fields above are grayed out: the link is paused, so
 * the link/embed would lead to NOT_FOUND (the fields stay disabled — handing
 * out a dead link is worse than a disabled button). Points at the master
 * switch as the remedy.
 */
function PausedLinkHint({ subject }: { readonly subject: string }) {
  return (
    <p className="stg:text-xs stg:text-muted-foreground" role="status">
      This chat link is paused, so {subject} doesn&apos;t work yet — turn on
      the switch above to resume it.
    </p>
  );
}

function LinkTab({
  linkUrl,
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
  readonly linkUrl: string;
  readonly org: string;
  readonly agent: Agent;
  readonly enabled: boolean;
  readonly draft: WebChannelDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: WebChannelDraft,
    successMessage: string,
  ) => Promise<boolean>;
  readonly hasLinkToken: boolean;
  readonly isRotating: boolean;
  readonly onResetLink: () => void;
}) {
  const slugForOrg = useOrgSlugForId();
  const isOrgAudience = draft.audience === "org";

  return (
    <div className="stg:flex stg:flex-col stg:gap-4">
      <CopyField
        label={isOrgAudience ? "Member chat link" : "Public chat link"}
        value={linkUrl}
        copyLabel="Link"
        disabled={!enabled}
        openHref={enabled ? linkUrl : undefined}
      />
      {!enabled && <PausedLinkHint subject="this link" />}

      {isOrgAudience ? (
        <p className="stg:text-xs stg:text-muted-foreground">
          Only signed-in members of <span className="stg:font-medium">{slugForOrg(org)}</span>{" "}
          can chat. Access is checked on every message, so it ends the moment
          someone leaves the organization. The link is safe to forward — it
          shows nothing to anyone else.
        </p>
      ) : (
        <p className="stg:text-xs stg:text-status-degraded">
          Public links can be forwarded and indexed by search engines.
          Don&apos;t make public links to agents that know internal or confidential
          information — or switch the audience to organization members.
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
 * so the old URL stops working immediately — the link stays on, the agent
 * keeps its name. Public audience only; org chat links revoke via membership.
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
          <p className="stg:mt-0.5 stg:text-2xs stg:text-muted-foreground">
            {hasLinkToken
              ? "Generates a new link and kills the current one immediately — even mid-conversation. Send the new link to the people who should keep access."
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
// Tool credentials — shared vaults named on the chat link for visitors
// ---------------------------------------------------------------------------

/**
 * Names shared vaults on the chat link's `vaults` — the consent act that makes
 * a tool-using agent work for visitors (credentials belong to the chat link,
 * never to the agent itself; a visitor brings none of their own).
 * Public audience only; the section disappears for
 * org chat links, whose members run on their own keys.
 *
 * Expanded by default when the agent dials MCP servers, its own or its plugins' — for those agents
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
  readonly draft: WebChannelDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: WebChannelDraft,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const usesTools = agentUsesTools(agent.spec);
  const [expanded, setExpanded] = useState(
    usesTools || draft.vaults.length > 0,
  );

  const handleChange = useCallback(
    (refs: ResourceRef[]) => {
      const added = refs.length > draft.vaults.length;
      void commit(
        { ...draft, vaults: refs },
        added ? "Vault added" : "Vaults updated",
      );
    },
    [commit, draft],
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
          <p className="stg:text-2xs stg:text-muted-foreground">
            Shared vaults whose keys visitors&apos; chats use — name one
            holding the keys this agent&apos;s tools need (a read-only token is
            safest). You can name only vaults you may use; create one in
            Settings &rarr; Vaults. Saved values stay hidden from visitors.
          </p>
          <VaultPicker
            org={org}
            value={draft.vaults}
            onChange={handleChange}
            disabled={isPending}
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
 * The app origin the loader is served from — derived from the chat link URL
 * the host built. Empty when the host never wired `buildChatLinkUrl` (a
 * relative chat link URL), which degrades {@link buildEmbedSnippet} to a
 * relative `/embed.js` — same degradation as the relative link itself.
 */
function appOriginFrom(linkUrl: string): string {
  try {
    return new URL(linkUrl).origin;
  } catch {
    return "";
  }
}

/** The no-JavaScript alternative: a plain iframe onto the hosted page. */
function buildIframeSnippet(linkUrl: string, agentName: string): string {
  return [
    `<iframe`,
    `  src="${linkUrl}"`,
    `  title="${agentName}"`,
    `  width="400"`,
    `  height="600"`,
    `  style="border: 0; border-radius: 12px;"`,
    `></iframe>`,
  ].join("\n");
}

function EmbedTab({
  linkUrl,
  channelId,
  agentName,
  linkToken,
  enabled,
  draft,
  isPending,
  commit,
}: {
  readonly linkUrl: string;
  readonly channelId: string;
  readonly agentName: string;
  readonly linkToken: string;
  readonly enabled: boolean;
  readonly draft: WebChannelDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: WebChannelDraft,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const scriptSnippet = useMemo(
    () =>
      buildEmbedSnippet(appOriginFrom(linkUrl), channelId, linkToken || undefined),
    [linkUrl, channelId, linkToken],
  );

  // Embedding serves anonymous visitors via guest tokens, which an
  // org-audience chat link refuses by design — a sign-in flow inside a
  // third-party iframe is its own project. Say so instead of showing
  // snippets that would render nothing.
  if (draft.audience === "org") {
    return (
      <p className="stg:text-xs stg:text-muted-foreground" role="status">
        Embedding isn&apos;t available while only organization members can
        chat: embeds serve anonymous visitors, and this link requires a
        signed-in organization member. Switch the audience to{" "}
        <span className="stg:font-medium">Anyone with the link</span> to embed
        it on a site.
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
      {!enabled && <PausedLinkHint subject="this embed" />}
      <p className="stg:text-xs stg:text-muted-foreground">
        The widget hides itself on sites that aren&apos;t allowed to embed
        this agent. Free embeds show a &quot;Powered by Stigmer&quot; badge.
      </p>

      <OriginsEditor draft={draft} isPending={isPending} commit={commit} />

      <IframeAlternative
        linkUrl={linkUrl}
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
  linkUrl,
  agentName,
  enabled,
}: {
  readonly linkUrl: string;
  readonly agentName: string;
  readonly enabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const snippet = useMemo(
    () => buildIframeSnippet(linkUrl, agentName),
    [linkUrl, agentName],
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
          <p className="stg:text-2xs stg:text-muted-foreground">
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
  readonly draft: WebChannelDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: WebChannelDraft,
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
      <p className="stg:mt-0.5 stg:text-2xs stg:text-muted-foreground">
        Sites allowed to embed this agent. An empty list allows any site;
        adding origins restricts embedding to those sites. The hosted link
        works either way.
      </p>

      {draft.allowedOrigins.length > 0 && (
        <ul className={cn(UNSTYLED_LIST, "stg:mt-2 stg:flex stg:flex-col stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border")}>
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
  readonly draft: WebChannelDraft;
  readonly isPending: boolean;
  readonly commit: (
    next: WebChannelDraft,
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
          <p className="stg:text-2xs stg:text-muted-foreground">
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
        <span className="stg:tabular-nums stg:text-2xs">
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

/**
 * The user-token snippet, aimed at the server the console is connected
 * to — a self-hosted admin copies code for their own server, not Stigmer
 * Cloud. `apiBaseUrl` is the server's public base URL (`usePublicBaseUrl`),
 * the address the channel-app webhook URLs are built from too, JSON-quoted
 * so the line is always a valid string literal.
 */
function buildDeveloperSnippet(
  apiBaseUrl: string,
  org: string,
  slug: string,
): string {
  const baseUrl = JSON.stringify(trimTrailing(apiBaseUrl, "/"));
  return [
    `import { createNodeClient } from "@stigmer/client/node";`,
    ``,
    `// A key of a service account with the admin role in ${org}`,
    `const stigmer = createNodeClient({`,
    `  baseUrl: ${baseUrl},`,
    `  apiKey: process.env.STIGMER_API_KEY,`,
    `});`,
    ``,
    `// Mint tokens for your own users, then chat with ${org}/${slug}`,
    `const { accessToken } = await stigmer.tokens.mintUserToken({`,
    `  org: ${JSON.stringify(org)},`,
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
  const publicBaseUrl = usePublicBaseUrl();
  // `null` while the server's public address is unknown: the field says so.
  const snippet = useMemo(
    () =>
      publicBaseUrl === null
        ? null
        : buildDeveloperSnippet(publicBaseUrl, org, slug),
    [publicBaseUrl, org, slug],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-3">
      <p className="stg:text-xs stg:text-muted-foreground">
        Need your own auth, branding, or UI? Sign your product's users in
        with a service account's key and integrate this agent with the
        Stigmer SDK — the same runtime, full control.
      </p>
      {snippet !== null ? (
        <CopyField
          label="SDK integration"
          value={snippet}
          copyLabel="Code"
          multiline
        />
      ) : (
        <section>
          <h3 className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            SDK integration
          </h3>
          <div className="stg:mt-1.5">
            <UnknownPublicAddressNotice subject="the integration code" />
          </div>
        </section>
      )}
      <a
        href={PRODUCT_USERS_DOCS_URL}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "stg:text-xs stg:font-medium stg:text-primary stg:hover:text-primary-muted",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
        )}
      >
        Read the guide to signing your users in →
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
