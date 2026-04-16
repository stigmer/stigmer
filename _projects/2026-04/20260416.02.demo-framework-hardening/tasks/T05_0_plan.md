# Task T05: New Interaction — Type (Text Input Simulation)

**Created**: 2026-04-16
**Status**: PENDING
**Type**: Feature
**Depends on**: T04

## Problem

Demos that show form input (API key entry, search fields, configuration values) currently hard-code the filled state as a separate step. There is no way to show text appearing character-by-character, which is more engaging and clearly communicates "the user is typing."

## Design

### New action type: `type`

```typescript
interface StepAction {
  atPercent: number;
  type: "scroll-to" | "set-cursor" | "clear-cursor" | "click" | "type";
  target?: string;  // data-type-target value
  text?: string;    // text to type
  typeDelay?: number; // ms between characters (default: 50)
}
```

### Behavior

1. Find `[data-type-target="<target>"]` in the container
2. Focus the element
3. Type characters one at a time with `typeDelay` ms between each
4. For `<input>` elements: update `value` property and dispatch `input` + `change` events
5. For contenteditable: insert text nodes and dispatch `input` events
6. For React controlled components: use `nativeInputValueSetter` pattern to trigger React's onChange

### Implementation

1. Add `type` to the `StepAction.type` union
2. Add `text` and `typeDelay` optional fields to `StepAction`
3. Implement `executeTypeAction` that:
   - Finds the target element
   - Sets cursor to the element (optional — can combine with `set-cursor`)
   - Iterates over characters with `setTimeout` (browser) or frame-by-frame (video)
4. Handle video export: compute which character should be visible at the current frame time
5. For React compatibility, use the `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` pattern to trigger React's synthetic onChange

### Considerations

- Character-by-character animation in video export requires careful frame math
- The `typeDelay` should scale with `playbackRate` in browser mode
- Cursor should blink at the input position during typing (may need a text cursor variant of the pointer cursor)

## Success Criteria

- `type` action types text character-by-character in both browser and video modes
- React controlled inputs update correctly (onChange fires)
- Typing speed scales with playback rate
- At least one demo scenario uses the `type` interaction (e.g., API key setup)
