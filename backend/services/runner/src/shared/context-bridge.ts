/**
 * The rollover context bridge (stigmer-cloud DD-013).
 *
 * When a channel conversation's session hits its bounds (turn cap or
 * inactivity window), the cloud broker rolls it over into a fresh session
 * and stamps a compact digest of the previous conversation — subject plus
 * the newest user/assistant exchanges — into the fresh session's
 * `SessionSpec.metadata` under {@link CONTEXT_BRIDGE_METADATA_KEY}. Both
 * harnesses read it here and present it as prompt context, so the user
 * does not experience total amnesia at the rotation.
 *
 * The cloud composes the CONTENT; this module owns the PRESENTATION
 * framing. Each harness wraps {@link formatContextBridgeText} in its own
 * section syntax (XML tag for cursor's first-message prompt, markdown
 * heading for the native system prompt).
 */

/**
 * `SessionSpec.metadata` key carrying the bridge digest. Pinned verbatim
 * to `ChannelRuntimeConstants.CONTEXT_BRIDGE_METADATA_KEY` in
 * stigmer-cloud, with mirror guard tests on both sides — a drift degrades
 * to a plain context reset (the bridge is simply never read), never worse.
 */
export const CONTEXT_BRIDGE_METADATA_KEY = "stigmer.ai/context-bridge";

/**
 * How the digest is introduced to the model, shared by both harnesses so
 * the behavioral contract ("known background, don't announce it") cannot
 * drift between them.
 */
const CONTEXT_BRIDGE_PREAMBLE =
  "Background from your previous conversation with this user, carried over " +
  "when the conversation was rotated. Treat it as context you already " +
  "know; the user may continue as if nothing changed. Do not repeat it " +
  "back or mention the rotation unless asked.";

/**
 * Read the bridge digest from a session's spec metadata map. Returns
 * undefined when absent or blank — the caller renders no section.
 */
export function readContextBridge(
  metadata: Record<string, string> | undefined,
): string | undefined {
  const value = metadata?.[CONTEXT_BRIDGE_METADATA_KEY]?.trim();
  return value ? value : undefined;
}

/** The framed bridge body (preamble + digest), ready for section wrapping. */
export function formatContextBridgeText(bridge: string): string {
  return `${CONTEXT_BRIDGE_PREAMBLE}\n\n${bridge.trim()}`;
}
