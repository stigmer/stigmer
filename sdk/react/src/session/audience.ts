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
 *   never fall back to the org's default agent.
 *
 * A preset rather than individual flags: each audience is a product
 * intent, and keeping it in one place lets the SDK evolve what that
 * presentation means without breaking embedders.
 */
export type SessionAudience = "integrator" | "endUser" | "guest";
