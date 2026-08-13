/**
 * Who the session organisms (`SessionViewer` / `NewSessionViewer`) are
 * presented to.
 *
 * - `"integrator"` (default) — the full configuration surface: agent
 *   picker, MCP servers, skills, and session variables. The presentation
 *   used by the Stigmer Console, where the person at the keyboard is
 *   composing the session's configuration.
 * - `"endUser"` — a curated, product-embedded chat. The agent (and its
 *   MCP servers, skills, and identity) is configured upstream by the
 *   embedding platform; the end user chats, picks a model, toggles
 *   Agent/Plan mode, and attaches workspaces, but never reconfigures
 *   the agent. The organisms lock the agent and hide the integrator
 *   pickers, in both the composer and the inspector's Setup tab.
 * - `"guest"` — an anonymous visitor of a shared agent's public page or
 *   embed, authenticated by a guest token. Pure chat: everything
 *   `"endUser"` hides plus the model, harness, and Agent/Plan pickers,
 *   attachments, the workspace picker, and the session panel. Guest is
 *   behavioral, not just cosmetic — the organisms also skip the
 *   org-level reads a guest principal cannot make (default-agent
 *   resolution, session→agent derivation, personal environments) and
 *   never fall back to the org's default agent. Approval mechanics are
 *   also withheld (DD-014): the HITL gate protects the ORG's tools and
 *   an anonymous visitor is not its trustee — guest executions run in
 *   unattended approval mode server-side (gated tools auto-skip and the
 *   agent explains in plain language), so tool-approval vocabulary never
 *   reaches a guest.
 * - `"observer"` — a read-only transcript for someone watching a
 *   conversation they cannot participate in, e.g. a channel connector
 *   or org admin reviewing a Slack/WhatsApp conversation the channel
 *   runtime owns. No composer, no approval/edit/retry/build
 *   affordances, no access management — the server enforces the same
 *   boundary (channel viewers hold `can_view` only, never
 *   `can_create_execution_in`), so the presentation simply never
 *   offers what the caller could not do. The session panel stays
 *   available read-only: usage, artifacts, and setup inspection are
 *   the point of observability. `SessionViewer` also self-selects this
 *   audience for channel-originated sessions (the
 *   `stigmer.ai/channel-id` label), so every entry point — a
 *   conversations list, a pasted URL — renders read-only without host
 *   wiring.
 *
 * A preset rather than individual flags: each audience is a product
 * intent, and keeping it in one place lets the SDK evolve what that
 * presentation means without breaking embedders.
 */
export type SessionAudience = "integrator" | "endUser" | "guest" | "observer";

/**
 * Whether the session organisms offer the session panel surface.
 *
 * - `"auto"` (default) — the panel and its toggle chip are available
 *   whenever the audience allows them (every audience except `"guest"`).
 * - `"none"` — the panel and chip are absent entirely: plan-mode
 *   auto-open is suppressed and transcript file paths keep their default
 *   copy behavior. For hosts whose surrounding surface already renders
 *   the workspace — the composer keeps every capability the audience
 *   allows, which is what separates this from `audience="guest"`.
 *
 * Orthogonal to {@link SessionAudience} on purpose: audience is who is
 * looking, panel mode is what the host's geometry has room for. A union
 * (not a boolean) so a future mode — e.g. a host-rendered panel fed by
 * the SDK's controller — extends the vocabulary instead of breaking it.
 */
export type SessionPanelMode = "auto" | "none";
