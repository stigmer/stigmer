/**
 * The `<stigmer-agent>` custom element — the widget a site owner pastes next
 * to the one-line loader script:
 *
 * ```html
 * <script src="https://app.stigmer.ai/embed.js" async></script>
 * <stigmer-agent org="acme" agent="support-bot"></stigmer-agent>
 * ```
 *
 * The element renders a cross-origin iframe onto the hosted chat page — the
 * iframe is the isolation boundary; no Stigmer UI code runs in the host page.
 * It hides itself when the platform refuses the embed context (origin not in
 * the agent's allowed list), re-dispatching lifecycle signals as
 * `stigmer:ready` / `stigmer:refused` CustomEvents for host-page scripting.
 */

import { createEmbedHost, type EmbedHost } from "./host.js";

/** Attribute-driven configuration of `<stigmer-agent>`. */
const OBSERVED_ATTRIBUTES = [
  "org",
  "agent",
  "theme",
  "width",
  "height",
  "app-origin",
] as const;

/** Matches the T03 iframe snippet's default footprint. */
const DEFAULT_WIDTH = "400px";
const DEFAULT_HEIGHT = "600px";

/**
 * App origin the IIFE loader derives from its own `<script src>` (see
 * `global.ts`). ESM consumers either call {@link setDefaultAppOrigin} or set
 * the `app-origin` attribute per element.
 */
let defaultAppOrigin: string | null = null;

/** Sets the fallback origin used when an element has no `app-origin` attribute. */
export function setDefaultAppOrigin(origin: string): void {
  defaultAppOrigin = origin;
}

export class StigmerAgentElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  private iframe: HTMLIFrameElement | null = null;
  private host: EmbedHost | null = null;

  connectedCallback(): void {
    this.attach();
  }

  disconnectedCallback(): void {
    this.detach();
  }

  attributeChangedCallback(): void {
    // Identity/config changes rebuild the frame; a chat conversation cannot
    // survive a change of agent, theme, or origin anyway.
    if (this.isConnected) {
      this.attach();
    }
  }

  private attach(): void {
    this.detach();

    const org = this.getAttribute("org");
    const agent = this.getAttribute("agent");
    const appOrigin = this.getAttribute("app-origin") ?? defaultAppOrigin;
    if (!org || !agent) {
      console.error("[stigmer-agent] the org and agent attributes are required");
      return;
    }
    if (!appOrigin) {
      console.error(
        "[stigmer-agent] no app origin: load embed.js from your Stigmer app " +
          'origin, or set the app-origin attribute (e.g. app-origin="https://app.stigmer.ai")',
      );
      return;
    }

    this.style.display = "inline-block";
    this.style.width = cssLength(this.getAttribute("width"), DEFAULT_WIDTH);
    this.style.height = cssLength(this.getAttribute("height"), DEFAULT_HEIGHT);

    const iframe = document.createElement("iframe");
    iframe.src = buildChatUrl(appOrigin, org, agent, this.getAttribute("theme"));
    iframe.title = `Chat with ${agent}`;
    iframe.setAttribute("loading", "lazy");
    iframe.style.cssText =
      "width:100%;height:100%;border:0;border-radius:12px";
    this.appendChild(iframe);

    this.iframe = iframe;
    this.host = createEmbedHost(iframe, appOrigin, {
      onReady: () => {
        this.dispatchEvent(new CustomEvent("stigmer:ready"));
      },
      onRefused: () => {
        // Hide gracefully rather than erroring — the requirement for embeds
        // on sites the agent owner has not allowed.
        this.style.display = "none";
        this.dispatchEvent(new CustomEvent("stigmer:refused"));
      },
    });
  }

  private detach(): void {
    this.host?.destroy();
    this.host = null;
    this.iframe?.remove();
    this.iframe = null;
  }
}

function buildChatUrl(
  appOrigin: string,
  org: string,
  agent: string,
  theme: string | null,
): string {
  const url = new URL(
    `/chat/${encodeURIComponent(org)}/${encodeURIComponent(agent)}`,
    appOrigin,
  );
  const resolved = resolveTheme(theme);
  if (resolved) {
    url.searchParams.set("theme", resolved);
  }
  return url.toString();
}

/**
 * Resolves the theme attribute once, at mount. Deliberately not live-tracked:
 * a theme flip mid-conversation would reload the iframe and destroy the
 * visitor's chat, which is worse than a stale theme.
 */
function resolveTheme(theme: string | null): "light" | "dark" | null {
  if (theme === "light" || theme === "dark") return theme;
  if (theme === "auto") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  // No attribute: let the hosted page use its own default.
  return null;
}

function cssLength(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return /^\d+$/.test(value) ? `${value}px` : value;
}

/** Registers `<stigmer-agent>`; safe to call more than once. */
export function defineStigmerAgent(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("stigmer-agent")) {
    customElements.define("stigmer-agent", StigmerAgentElement);
  }
}
