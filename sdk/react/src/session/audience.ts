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
 *
 * A preset rather than individual flags: "end user" is a product intent,
 * and keeping it in one place lets the SDK evolve what that presentation
 * means without breaking embedders.
 */
export type SessionAudience = "integrator" | "endUser";
