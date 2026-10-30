"use client";

// <AgentChat>: Stigmer's chat as one component, in three frames. It is the
// two session views composed once (the launcher until a conversation
// exists, then the conversation), so an embedder no longer hand-wires the
// swap. The frames:
//
// - page: fills the box it is given.
// - panel: fills the box the host docks it in, under a header naming the
//   agent; the host owns the docking, because the kit never lays out the
//   host's page.
// - popup: a button in the corner and, when open, the kit's dialog shell
//   in its non-modal mode beside it, inside the provider's portal
//   container so the kit's styles stay scoped. Closed, the button says
//   what the agent is doing in the conversation's own words. Focus is
//   never trapped and no global key is taken: Escape closes it only while
//   focus is inside, and closing returns focus to the button.
//
// The conversation view loads as its own chunk, fetched on mount, so the
// composer is usable before the thread's renderers arrive. The state
// rules live in `agent-chat-state.ts`.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LoaderCircle, MessageCircle, SquarePen, X } from "lucide-react";
import type { ResourceRef } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { useAgent } from "../agent/useAgent.js";
import { DialogShell } from "../internal/DialogShell.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useStigmerPortalContainer } from "../portal-container.js";
import type { MessageThreadSlots } from "../run/MessageThread.js";
import type { SessionAudience } from "../session/audience.js";
import type { SessionInspectorProps } from "../session/inspector/SessionInspector.js";
import { NewSessionViewer } from "../session/NewSessionViewer.js";
import type { SessionRunConfig } from "../session/run-config.js";
import {
  agentChatReducer,
  initialAgentChatState,
  launcherView,
  parseAgent,
  type AgentChatState,
  type LauncherView,
} from "./agent-chat-state.js";
import { ChatActivityReporterContext, type ChatActivity } from "./chat-activity.js";
import { LazySessionViewer, preloadSessionViewer } from "./LazySessionViewer.js";

/** Where {@link AgentChat} draws itself. */
export type AgentChatVariant = "page" | "panel" | "popup";

/** Props for {@link AgentChat}. */
export interface AgentChatProps {
  /**
   * The agent to chat with: `"org/slug"` (for example
   * `"acme/variance-reporter"`), or a reference. Pass an object reference
   * memoized: the launcher pins the agent it mounted with.
   */
  readonly agent: string | ResourceRef;
  /**
   * The organization the conversation lives in. Defaults to the agent's;
   * set it when the person chats in another organization than the one
   * that owns the agent.
   */
  readonly org?: string;
  /**
   * The frame: `"page"` (default) fills its box; `"panel"` fills the box
   * you dock it in, under a header; `"popup"` is a button in the corner
   * that opens the chat beside it.
   */
  readonly variant?: AgentChatVariant;
  /**
   * Who is chatting. Defaults to `"endUser"`: a person signed in to your
   * product, held to the agent you named.
   */
  readonly audience?: SessionAudience;
  /**
   * The conversation to show (controlled): `null` for a new one. Pair it
   * with {@link onSessionChange}. Leave it unset to let the chat keep its
   * own.
   */
  readonly sessionId?: string | null;
  /** The conversation to show first, when {@link sessionId} is not controlled. */
  readonly defaultSessionId?: string | null;
  /**
   * Called when a conversation starts (with its id) or the person starts a
   * new one (with `null`). Keep the id to reopen the conversation after a
   * reload: the chat writes no storage of its own.
   */
  readonly onSessionChange?: (sessionId: string | null) => void;
  /** Whether the panel or popup is open (controlled). The page is always shown. */
  readonly open?: boolean;
  /** Whether the panel or popup starts open, when {@link open} is not controlled. Defaults to `false` for the popup, `true` for the panel. */
  readonly defaultOpen?: boolean;
  /**
   * Called when the person opens or closes the popup, or closes the panel.
   * The panel shows its close button only when this is set.
   */
  readonly onOpenChange?: (open: boolean) => void;
  /** The agent's name in the frame's header and the popup's button. Defaults to the agent's own name. */
  readonly title?: string;
  /** The inspector, for the page frame only (see `SessionInspector`). */
  readonly inspector?: ReactElement<SessionInspectorProps>;
  /** How new turns run (see `SessionRunConfig`). */
  readonly runConfig?: SessionRunConfig;
  /** Content placed in the conversation's thread (see `MessageThreadSlots`). */
  readonly threadSlots?: MessageThreadSlots;
  /** The heading above the first message's box. */
  readonly heading?: string;
  /** The first message box's placeholder. */
  readonly placeholder?: string;
  /** Whether a conversation can work on GitHub repositories. @default true */
  readonly enableGitHub?: boolean;
  /** Whether the conversation reads the sender's own My vault (see `NewSessionViewer`). */
  readonly includeMyVault?: boolean;
  /**
   * Called when the first message could not be sent, after the chat shows
   * the message under its box.
   */
  readonly onError?: (message: string, error: Error) => void;
  readonly className?: string;
}

/**
 * Stigmer's chat as one component: the first message, then the
 * conversation, as a page, a docked panel or a corner popup.
 *
 * @example
 * ```tsx
 * import { AgentChat, StigmerProvider } from "@stigmer/react-sdk/chat";
 * import "@stigmer/react-sdk/styles.css";
 *
 * <StigmerProvider client={stigmer}>
 *   <AgentChat agent="acme/variance-reporter" variant="popup" />
 * </StigmerProvider>
 * ```
 */
export function AgentChat({
  agent,
  org: orgProp,
  variant = "page",
  audience = "endUser",
  sessionId: sessionIdProp,
  defaultSessionId = null,
  onSessionChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  title,
  inspector,
  runConfig,
  threadSlots,
  heading,
  placeholder,
  enableGitHub,
  includeMyVault,
  onError,
  className,
}: AgentChatProps) {
  const agentRef = useMemo(() => parseAgent(agent), [agent]);
  const org = orgProp ?? agentRef.org;
  const [state, dispatch] = useReducer(agentChatReducer, undefined, () =>
    initialAgentChatState(defaultOpen ?? variant === "panel", defaultSessionId),
  );
  const sessionId = sessionIdProp !== undefined ? sessionIdProp : state.sessionId;
  // A controlled conversation that changed resets the reported activity
  // before its view reports its own (a child's effects run before ours).
  if (state.sessionId !== sessionId) dispatch({ type: "set-session", sessionId });
  const open = variant === "page" || (openProp ?? state.open);

  const { agent: agentResource } = useAgent(
    title === undefined ? agentRef.org : null,
    title === undefined ? agentRef.slug : null,
  );
  const name = title ?? (agentResource?.metadata?.name || agentRef.slug);

  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) dispatch({ type: "set-open", open: next });
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const setSession = useCallback(
    (next: string | null) => {
      if (sessionIdProp === undefined) dispatch({ type: "set-session", sessionId: next });
      onSessionChange?.(next);
    },
    [sessionIdProp, onSessionChange],
  );

  // Fetch the conversation view now, while the person writes.
  useEffect(() => {
    preloadSessionViewer().catch(() => {
      // The view retries on mount and says so if it still cannot load.
    });
  }, []);

  // Whatever ends while the conversation is on screen is seen.
  useEffect(() => {
    if (open) dispatch({ type: "seen" });
  }, [open, state.activity]);

  const report = useCallback((activity: ChatActivity) => dispatch({ type: "activity", activity }), []);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const handleCreated = useCallback(
    (id: string) => {
      setSubmitError(null);
      setSession(id);
    },
    [setSession],
  );
  const handleError = useCallback(
    (message: string, error: Error) => {
      setSubmitError(message);
      onError?.(message, error);
    },
    [onError],
  );

  const pageInspector = variant === "page" ? inspector : undefined;
  const body =
    sessionId !== null ? (
      <ChatActivityReporterContext.Provider value={report}>
        <LazySessionViewer
          key={sessionId}
          sessionId={sessionId}
          org={org}
          audience={audience}
          runConfig={runConfig}
          inspector={pageInspector}
          threadSlots={threadSlots}
          enableGitHub={enableGitHub}
        />
      </ChatActivityReporterContext.Provider>
    ) : (
      <NewSessionViewer
        org={org}
        audience={audience}
        initialAgentRef={agentRef}
        runConfig={runConfig}
        inspector={pageInspector}
        heading={heading}
        placeholder={placeholder}
        enableGitHub={enableGitHub}
        includeMyVault={includeMyVault}
        // A panel or popup never takes focus from the host's page by itself.
        autoFocus={variant === "page"}
        onSessionCreated={handleCreated}
        onError={handleError}
        footerContent={
          submitError ? (
            <p role="alert" className="stg:text-center stg:text-xs stg:text-destructive">
              {submitError}
            </p>
          ) : undefined
        }
      />
    );

  if (variant === "page") {
    return <div className={cn("stg:h-full stg:w-full", className)}>{body}</div>;
  }

  const newConversation = sessionId === null ? undefined : () => setSession(null);

  if (variant === "panel") {
    return (
      <AgentChatPanel
        name={name}
        open={open}
        onNewConversation={newConversation}
        onClose={onOpenChange ? () => setOpen(false) : undefined}
        className={className}
      >
        {body}
      </AgentChatPanel>
    );
  }

  return (
    <AgentChatPopup
      name={name}
      open={open}
      onOpenChange={setOpen}
      state={state}
      onNewConversation={newConversation}
      className={className}
    >
      {body}
    </AgentChatPopup>
  );
}

// ---------------------------------------------------------------------------
// The frames
// ---------------------------------------------------------------------------

interface FrameHeaderProps {
  readonly name: string;
  readonly headingId: string;
  readonly onNewConversation: (() => void) | undefined;
  readonly onClose: (() => void) | undefined;
  readonly closeIcon: ReactNode;
}

const ICON_BUTTON =
  "stg:flex stg:size-10 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground stg:transition-colors stg:hover:bg-muted stg:hover:text-foreground stg:disabled:pointer-events-none stg:disabled:opacity-40 stg:focus-visible:outline-2 stg:focus-visible:outline-ring";

/** The panel's and popup's header: the agent, a new conversation, close. */
function FrameHeader({ name, headingId, onNewConversation, onClose, closeIcon }: FrameHeaderProps) {
  return (
    <header className="stg:flex stg:h-13 stg:shrink-0 stg:items-center stg:gap-2.5 stg:border-b stg:border-border stg:pr-2 stg:pl-4">
      <span
        aria-hidden="true"
        className="stg:flex stg:size-7 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-foreground stg:text-xs stg:font-semibold stg:text-background"
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <h2 id={headingId} className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
        {name}
      </h2>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="New conversation"
              disabled={onNewConversation === undefined}
              onClick={onNewConversation}
              className={ICON_BUTTON}
            >
              <SquarePen className="stg:size-4.5" aria-hidden="true" />
            </button>
          }
        />
        <TooltipContent>New conversation</TooltipContent>
      </Tooltip>
      {onClose && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button type="button" aria-label="Close the chat" onClick={onClose} className={ICON_BUTTON}>
                {closeIcon}
              </button>
            }
          />
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      )}
    </header>
  );
}

interface AgentChatPanelProps {
  readonly name: string;
  readonly open: boolean;
  readonly onNewConversation: (() => void) | undefined;
  readonly onClose: (() => void) | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

/** The docked frame: hidden, not unmounted, while closed, so a working turn keeps streaming. */
function AgentChatPanel({ name, open, onNewConversation, onClose, className, children }: AgentChatPanelProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(open ? "stg:flex" : "stg:hidden", "stg:h-full stg:w-full stg:flex-col stg:bg-background", className)}
    >
      <FrameHeader
        name={name}
        headingId={headingId}
        onNewConversation={onNewConversation}
        onClose={onClose}
        closeIcon={<X className="stg:size-4.5" aria-hidden="true" />}
      />
      <div className="stg:min-h-0 stg:flex-1">{children}</div>
    </section>
  );
}

interface AgentChatPopupProps {
  readonly name: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The chat's state, which the closed button reads its words from. */
  readonly state: AgentChatState;
  readonly onNewConversation: (() => void) | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Redraws once a second while `active`. */
function useTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

/** The corner frame: the button, and the non-modal dialog it opens. */
function AgentChatPopup({ name, open, onOpenChange, state, onNewConversation, className, children }: AgentChatPopupProps) {
  // The closed button's time ticks on: its words are worked out here, on
  // every redraw the tick makes.
  useTick(!open && state.activity.kind === "working");
  const view = launcherView(state, name, Date.now());
  const headingId = useId();
  const container = useStigmerPortalContainer();
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // Where focus goes after the next open or close the person made.
  const moveFocusRef = useRef(false);
  // Portals need the document: nothing renders on the server or before mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!moveFocusRef.current) return;
    moveFocusRef.current = false;
    (open ? panelRef.current : launcherRef.current)?.focus();
  }, [open]);

  const change = useCallback(
    (next: boolean) => {
      moveFocusRef.current = true;
      onOpenChange(next);
    },
    [onOpenChange],
  );

  // Escape closes the popup only while focus is inside it. A menu open in
  // the composer lives in the provider's portal, outside this element, and
  // closes itself first.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape" || event.defaultPrevented || !open) return;
      if (!panelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      change(false);
    },
    [open, change],
  );

  if (!mounted || container === null) return null;
  return createPortal(
    <div
      onKeyDown={handleKeyDown}
      className={cn("stg:fixed stg:right-6 stg:bottom-6 stg:z-50 stg:flex stg:flex-col stg:items-end stg:gap-4", className)}
    >
      <DialogShell
        open={open}
        onOpenChange={change}
        modal={false}
        aria-labelledby={headingId}
        className={cn(
          "stg:m-0 stg:h-[min(52rem,calc(100dvh-7.5rem))] stg:w-[24.375rem] stg:max-w-[calc(100vw-3rem)] stg:overflow-hidden stg:rounded-2xl stg:bg-background stg:text-foreground stg:open:flex",
          // A phone's screen is the popup.
          "stg:max-sm:fixed stg:max-sm:inset-0 stg:max-sm:h-dvh stg:max-sm:w-full stg:max-sm:max-w-none stg:max-sm:rounded-none stg:max-sm:border-0",
        )}
      >
        <div ref={panelRef} tabIndex={-1} className="stg:flex stg:h-full stg:w-full stg:flex-col stg:outline-none">
          <FrameHeader
            name={name}
            headingId={headingId}
            onNewConversation={onNewConversation}
            onClose={() => change(false)}
            closeIcon={<ChevronDown className="stg:size-5" aria-hidden="true" />}
          />
          <div className="stg:min-h-0 stg:flex-1">{children}</div>
        </div>
      </DialogShell>
      <LauncherButton
        buttonRef={launcherRef}
        name={name}
        open={open}
        view={view}
        onClick={() => change(!open)}
      />
      <span className="stg:sr-only" aria-live="polite">
        {open ? "" : view.announcement}
      </span>
    </div>,
    container ?? document.body,
  );
}

interface LauncherButtonProps {
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly name: string;
  readonly open: boolean;
  readonly view: LauncherView;
  readonly onClick: () => void;
}

/** The popup's corner button: what the agent is doing while closed, close while open. */
function LauncherButton({ buttonRef, name, open, view, onClick }: LauncherButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-label={open ? `Close the chat with ${name}` : view.ariaLabel}
      onClick={onClick}
      className={cn(
        "stg:flex stg:h-12 stg:items-center stg:gap-2.5 stg:rounded-full stg:bg-foreground stg:text-background stg:shadow-lg stg:transition-opacity stg:hover:opacity-90 stg:focus-visible:outline-2 stg:focus-visible:outline-offset-2 stg:focus-visible:outline-ring",
        // Open, it closes the chat; on a phone the popup's header does.
        open ? "stg:size-14 stg:justify-center stg:max-sm:hidden" : "stg:max-w-[calc(100vw-3rem)] stg:pr-5 stg:pl-4",
      )}
    >
      {open ? (
        <ChevronDown className="stg:size-5" aria-hidden="true" />
      ) : (
        <>
          <LauncherIcon icon={view.icon} />
          <span className="stg:truncate stg:text-sm stg:font-semibold">{view.label}</span>
          {view.detail !== undefined && (
            <span className="stg:shrink-0 stg:text-sm stg:opacity-60">{view.detail}</span>
          )}
        </>
      )}
    </button>
  );
}

function LauncherIcon({ icon }: { readonly icon: LauncherView["icon"] }) {
  switch (icon) {
    case "working":
      return <LoaderCircle className="stg:size-4.5 stg:shrink-0 stg:motion-safe:animate-spin" aria-hidden="true" />;
    case "waiting":
      return <span aria-hidden="true" className="stg:mx-1 stg:size-2.5 stg:shrink-0 stg:rounded-full stg:bg-background" />;
    case "done":
      return <Check className="stg:size-4.5 stg:shrink-0" aria-hidden="true" />;
    case "ended":
      return <span aria-hidden="true" className="stg:mx-1 stg:size-2.5 stg:shrink-0 stg:rounded-full stg:border-2 stg:border-background" />;
    case "chat":
      return <MessageCircle className="stg:size-4.5 stg:shrink-0" aria-hidden="true" />;
  }
}
