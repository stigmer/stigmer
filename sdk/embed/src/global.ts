/**
 * IIFE entry for the one-line `<script>` loader (`dist/embed.global.js`,
 * served as `embed.js` from the Stigmer app origin).
 *
 * Derives the app origin from its own script URL — the loader is served from
 * the same origin as the hosted chat page, so the snippet needs zero
 * configuration and self-hosted OSS installs work unchanged. If the loader is
 * ever served from a dedicated CDN host instead, embedders set the
 * `app-origin` attribute on `<stigmer-agent>` (or the CDN build bakes in
 * {@link setDefaultAppOrigin}).
 *
 * Must stay a classic script (not `type="module"`): `document.currentScript`
 * is `null` inside module scripts, and it is the only zero-config way to know
 * where the loader came from.
 */

import {
  StigmerAgentElement,
  defineStigmerAgent,
  setDefaultAppOrigin,
} from "./element.js";

const script = document.currentScript;
if (script instanceof HTMLScriptElement && script.src) {
  setDefaultAppOrigin(new URL(script.src).origin);
}

defineStigmerAgent();

export { StigmerAgentElement, defineStigmerAgent, setDefaultAppOrigin };
