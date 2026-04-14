/**
 * Module-level singleton that enforces "single active player" across all
 * ScenarioPlayer instances on the same page. When a player starts, it
 * calls {@link notifyPlaying} which pauses every other registered player.
 *
 * No React dependency — the coordinator is a plain Map of pause callbacks.
 * Each ScenarioPlayer registers on mount and unregisters on unmount.
 */

type PauseCallback = () => void;

const players = new Map<string, PauseCallback>();
let nextId = 0;

/**
 * Register a player's pause callback. Returns a stable id and an
 * unregister function to call on unmount.
 */
export function register(onPause: PauseCallback): {
  id: string;
  unregister: () => void;
} {
  const id = `sp-${nextId++}`;
  players.set(id, onPause);
  return { id, unregister: () => players.delete(id) };
}

/**
 * Signal that a player has started playing. Every other registered
 * player receives its pause callback.
 */
export function notifyPlaying(activeId: string): void {
  for (const [id, pause] of players) {
    if (id !== activeId) pause();
  }
}
