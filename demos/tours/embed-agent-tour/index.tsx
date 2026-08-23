import type { CSSProperties, ReactNode } from "react";
import type { ResourceRef } from "@stigmer/sdk";
import { BrowserView, CodeEditorView } from "@scenar/react";
import { SessionView } from "../_shared/SessionView";
import { DEMO_ORG } from "../_shared/fixtures";
import {
  EMBED_CODE,
  EMBED_CODE_HIGHLIGHTS,
  TYPING_MESSAGE,
  type EmbedAgentTourStep,
} from "./steps";

/**
 * The depicted host product's address — a third-party app, deliberately NOT
 * `app.stigmer.ai`. The whole point of the tour is that the chat lives in
 * someone else's product.
 */
const HOST_URL = "acme.dev/support";

/** The agent the depicted product pinned its embed to. */
const SUPPORT_AGENT_REF: ResourceRef = { org: DEMO_ORG, slug: "support-agent" };

// ---------------------------------------------------------------------------
// Host page chrome — tour-local, drawn with --scenar-* tokens (Tailwind
// no-ops under `scenar pack`). Only the page framing is hand-drawn; the
// chat inside the embed card is the real SDK surface via `SessionView`
// (sdk-console DD-020).
// ---------------------------------------------------------------------------

const page: CSSProperties = {
  display: "flex",
  height: "100%",
  flexDirection: "column",
  background: "var(--scenar-surface)",
};

const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.875rem 2rem",
  borderBottom: "1px solid var(--scenar-border)",
  background: "var(--scenar-card)",
};

const brand: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.9375rem",
  fontWeight: 700,
  color: "var(--scenar-foreground)",
};

const brandMark: CSSProperties = {
  height: "1.125rem",
  width: "1.125rem",
  borderRadius: "0.3125rem",
  background: "var(--scenar-primary)",
};

const nav: CSSProperties = {
  display: "flex",
  gap: "1.5rem",
  fontSize: "0.8125rem",
  color: "var(--scenar-muted-foreground)",
};

const navActive: CSSProperties = {
  color: "var(--scenar-foreground)",
  fontWeight: 600,
};

const content: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "1.5rem 2rem",
};

const contentInner: CSSProperties = {
  display: "flex",
  height: "100%",
  margin: "0 auto",
  maxWidth: "56rem",
  minHeight: 0,
  flexDirection: "column",
  gap: "0.75rem",
};

const pageTitle: CSSProperties = {
  margin: 0,
  fontSize: "1.25rem",
  fontWeight: 700,
  color: "var(--scenar-foreground)",
};

const pageSubtitle: CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--scenar-muted-foreground)",
};

/** The embed region: a bordered card the host page gives the chat. */
const embedCard: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  borderRadius: "0.625rem",
  border: "1px solid var(--scenar-border)",
};

/**
 * The fictional product page with the chat embedded. `data-cursor-target`
 * on the embed card gives the timeline its cursor and camera anchor.
 */
function hostPage(contentKey: string, chat: ReactNode) {
  return (
    <BrowserView url={HOST_URL} contentKey={contentKey}>
      <div style={page}>
        <div style={header}>
          <div style={brand}>
            <span style={brandMark} />
            Acme
          </div>
          <div style={nav}>
            <span>Products</span>
            <span>Orders</span>
            <span style={navActive}>Support</span>
          </div>
        </div>
        <div style={content}>
          <div style={contentInner}>
            <h1 style={pageTitle}>Support</h1>
            <p style={pageSubtitle}>
              Ask about orders, returns, and exchanges — an agent answers
              right away.
            </p>
            <div data-cursor-target="embed-chat" style={embedCard}>
              {chat}
            </div>
          </div>
        </div>
      </div>
    </BrowserView>
  );
}

/**
 * Pure `renderStep`: maps step data to the depicted surface. The player,
 * cursor, narration, and viewport are supplied by `scenar pack` — this
 * stays declarative.
 */
export function renderStep(data: EmbedAgentTourStep): ReactNode {
  switch (data.view) {
    case "host-launcher":
      return hostPage("launcher", <SessionView agentRef={SUPPORT_AGENT_REF} />);

    case "host-typing":
      return hostPage(
        "typing",
        <SessionView
          agentRef={SUPPORT_AGENT_REF}
          typingMessage={TYPING_MESSAGE}
        />,
      );

    case "host-reply":
      return hostPage(
        "reply",
        <SessionView execution={data.execution} agentRef={SUPPORT_AGENT_REF} />,
      );

    case "host-code":
      return (
        <CodeEditorView
          filename="src/App.tsx"
          lines={EMBED_CODE}
          highlightLines={EMBED_CODE_HIGHLIGHTS}
          fileTree={EMBED_FILE_TREE}
          workspaceName="my-app"
          contentKey="code"
        />
      );
  }
}

/** File explorer for the code beat — a minimal Vite React project. */
const EMBED_FILE_TREE = [
  { name: "src", type: "folder", depth: 0 },
  { name: "App.tsx", type: "file", depth: 1 },
  { name: "main.tsx", type: "file", depth: 1 },
  { name: "package.json", type: "file", depth: 0 },
] as const;
