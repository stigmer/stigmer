/**
 * Shared timing constants for the demo engine.
 *
 * These values coordinate animation timing between Cursor (visual
 * ripple) and useStepInteractions (action dispatch). Both modules
 * must agree on when the cursor has "arrived" at its target so the
 * click ripple and the DOM click event fire in sync.
 */

/**
 * Milliseconds after a cursor target is set before the cursor is
 * considered "arrived" and the click ripple appears.
 *
 * Derived from the Cursor spring parameters (stiffness 170,
 * damping 22, mass 0.6) — the spring visually settles within
 * this window for typical travel distances in the demo viewport.
 */
export const CLICK_DELAY_MS = 450;

/**
 * Default milliseconds between characters for the `type` action.
 *
 * 50ms per character = 20 characters/second — fast enough to feel
 * like confident typing, slow enough that each character is readable
 * in both browser playback and video export. Overridable per-action
 * via `StepAction.typeDelay`.
 */
export const TYPE_CHAR_DELAY_MS = 50;

/**
 * Default milliseconds to hold the cursor in place during a `hover`
 * action, between the enter-event dispatch and the leave-event
 * dispatch.
 *
 * 1500ms gives viewers enough time to read a tooltip or notice a
 * hover-state change in both browser playback and video export.
 * Overridable per-action via `StepAction.hoverDuration`.
 */
export const HOVER_HOLD_MS = 1500;

/**
 * Milliseconds to pause at the drag source after pressing before
 * starting the drag movement to the destination.
 *
 * 200ms mimics the brief human hesitation between mousedown and the
 * start of a deliberate drag gesture. Without this pause the cursor
 * would begin moving immediately after the press, which looks
 * robotic rather than intentional.
 */
export const DRAG_SETTLE_MS = 200;

/**
 * Expected milliseconds for the viewport transition spring to settle
 * after a zoom or pan change.
 *
 * The ViewportTransformLayer uses a softer spring (stiffness 100,
 * damping 20, mass 0.8) than the cursor spring, so it takes longer
 * to settle. Used for dev-mode warnings when a subsequent cursor
 * action is scheduled too close to a viewport transition — the
 * cursor would target an element mid-animation, landing at an
 * intermediate position.
 */
export const VIEWPORT_SETTLE_MS = 500;
