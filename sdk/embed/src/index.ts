/**
 * @stigmer/embed — the one-line script embed for shared Stigmer agents.
 *
 * Three consumption forms:
 * - `<script src=".../embed.js">` — the IIFE loader (`./loader` export),
 *   auto-registers `<stigmer-agent>` and derives the app origin from its URL.
 * - `import "@stigmer/embed/define"` — bundler-side auto-registration.
 * - `import { ... } from "@stigmer/embed"` — this side-effect-free API, also
 *   used by the hosted chat page itself for the frame half of the protocol.
 */

export {
  EMBED_SOURCE,
  EMBED_PROTOCOL_VERSION,
  parseFrameMessage,
  parseHostMessage,
  toWire,
  type FrameToHostMessage,
  type HostToFrameMessage,
} from "./protocol.js";

export {
  OPAQUE_ORIGIN,
  isEmbedded,
  notifyParent,
  resolveParentOrigin,
} from "./frame.js";

export {
  createEmbedHost,
  type EmbedHost,
  type EmbedHostHandlers,
} from "./host.js";

export {
  StigmerAgentElement,
  defineStigmerAgent,
  setDefaultAppOrigin,
} from "./element.js";
