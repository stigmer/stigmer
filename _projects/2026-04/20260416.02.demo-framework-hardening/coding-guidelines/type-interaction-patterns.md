# Coding Guideline: Type Interaction Patterns

**Created**: 2026-04-16
**Task**: T05

## When to use the `type` action

Use the `type` action when a demo step needs to show text appearing character-by-character in an `<input>` or `<textarea>` — API key names, search queries, configuration values, agent messages. The character-by-character animation communicates "the user is typing" more effectively than an instant fill.

**Requirements**:

1. The target element has `data-cursor-target="<id>"`.
2. The target element is either an `<input>`/`<textarea>` itself, or contains one as a descendant.
3. The input is a React controlled component (or at minimum responds to `input` events).
4. The scenario uses `useStepInteractions` with a `type` action at the desired `atPercent`.

## Wiring checklist

1. Add `data-cursor-target="<id>"` to the element wrapping (or being) the input.
2. Define the `type` action in your `StepInteractions` map with `text` (the string to type) and optionally `typeDelay` (ms per character, defaults to 50ms).
3. Wire `useStepInteractions` in your scenario component with `stepIndex`, `setCursorTarget`, `containerRef`, and the interactions map.
4. Verify the timing budget: `atPercent * stepDuration + CLICK_DELAY_MS + text.length * typeDelay` must be less than the step duration. A dev-mode console warning fires if this is violated.

## Example (from `api-key-setup`)

```typescript
export const APIKEY_INTERACTIONS: StepInteractions = {
  6: [
    { atPercent: 0.15, type: "type", target: "apikey-name-input", text: "quickstart-key" },
  ],
};
```

The `create-form` step renders `CreateApiKeyForm` inside a wrapper with `data-cursor-target="apikey-name-input"`. At 15% of step 6's duration, the cursor moves to the input. After 450ms (cursor arrival), characters appear one at a time at 50ms intervals.

## Timing

The `type` action is three-phase:

1. **Phase 1** (at `atPercent`): cursor animates to the target element.
2. **Phase 2** (at `atPercent` + 450ms): first character appears in the input.
3. **Phase 3+** (every `typeDelay` ms after phase 2): subsequent characters appear.

The 450ms gap matches `CLICK_DELAY_MS` — the spring animation settle time. This mimics real behavior: the user moves the mouse to the field, pauses briefly, then starts typing.

Total duration of a `type` action: `CLICK_DELAY_MS + text.length * typeDelay`. For "quickstart-key" (14 chars) at 50ms/char: 450 + 700 = 1150ms.

## Target resolution

The `type` action targets `[data-cursor-target="<id>"]` — the same attribute used by `click` and `set-cursor`. If the target element is not itself an `<input>` or `<textarea>`, the engine finds the first descendant `input` or `textarea` inside it. This lets you wrap an SDK component (like `CreateApiKeyForm`) in a div with `data-cursor-target` without modifying the SDK component.

## React compatibility

The engine uses the `nativeInputValueSetter` pattern to update controlled inputs:

1. Gets the native `value` setter from `HTMLInputElement.prototype` (or `HTMLTextAreaElement.prototype`).
2. Calls the setter with the partial text.
3. Dispatches a bubbling `input` event.

This triggers React's synthetic `onChange` handler, so controlled components update their state correctly. The same pattern is used by `TypingComposer` in `ComposerView.tsx`.

## Clearing the cursor after typing

The engine does not automatically clear the cursor after typing completes. If the cursor should disappear, add an explicit `clear-cursor` action timed after the typing finishes:

```typescript
const INTERACTIONS: StepInteractions = {
  6: [
    { atPercent: 0.15, type: "type", target: "apikey-name-input", text: "quickstart-key" },
    { atPercent: 0.85, type: "clear-cursor" },
  ],
};
```

## Custom typing speed

Override the default 50ms/char delay with `typeDelay`:

```typescript
{ atPercent: 0.1, type: "type", target: "api-key-field", text: "sk_live_abc123", typeDelay: 30 }
```

Lower values = faster typing. The delay scales with `playbackRate` in browser mode (divided by the rate), so 2x playback makes typing twice as fast.

## Video export

All phases of the `type` action work in Remotion video export. The frame-driven path computes the character count from elapsed time on each render frame. No additional wiring needed — if it works in the browser, it works in the video.

## Combining with `click`

A common pattern: click an input to show "focusing," then type into it:

```typescript
const INTERACTIONS: StepInteractions = {
  3: [
    { atPercent: 0.1, type: "click", target: "search-field" },
    { atPercent: 0.35, type: "type", target: "search-field", text: "order status" },
  ],
};
```

The `click` moves the cursor and dispatches a DOM click (which may focus the input). The `type` action's cursor move is a no-op since the cursor is already at the target — only the typing phase fires.

## Limitations (V1)

- **`<input>` and `<textarea>` only.** Contenteditable elements are not supported. Defer to a future task when a real use case arises.
- **No text cursor variant.** The pointer cursor stays during typing. The input's native caret provides the text cursor visual. A custom blinking-caret cursor is a future enhancement.
