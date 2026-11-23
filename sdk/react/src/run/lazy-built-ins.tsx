"use client";

// The light chat entry's slot built-ins (`@stigmer/react-sdk/chat`). A host
// that restyles one part of the chat hands every other case back to ours,
// and importing our part from the root's very value would put the whole
// message renderer in the page's first download (stigmer/stigmer#3438). So
// the light entry exports thin components instead, one per slot, named like
// the built-in and taking its props, that draw the real one:
//
//   - inside a thread, from the thread's context (`built-ins-context.ts`):
//     the thread already holds the real components, so the part draws on the
//     first frame, on the server too, with no Suspense and no blink;
//   - outside any thread (a host drawing `TodoCard` in its own sidebar), from
//     one import of the built-ins per page, started on first mount and kept
//     for every later one, with nothing drawn until it lands; a failed import
//     is forgotten, so the next mount tries again (the shape
//     `agent-chat/LazySessionViewer.tsx` loads the conversation with).
//
// The root entry keeps the real components: a page importing it holds the
// whole kit at once. A thin component is not memoized; the real one it draws
// keeps its own memo. Tests: `__tests__/lazy-built-ins.test.tsx`; the page
// budget, `test/install/smoke-budgets.mjs` (KIT-02).

import { useContext, useEffect, useState, type ComponentType } from "react";
import { BuiltInsContext, type SlotBuiltIns } from "./built-ins-context.js";
import type { SlotName } from "./slot-guard.js";

/** Where a thin built-in finds the real ones outside a thread. */
export interface BuiltInsLoader {
  /** Starts the import, unless one is under way or done; a failed one is forgotten. */
  readonly load: () => Promise<SlotBuiltIns>;
  /** The built-ins once imported. */
  readonly loaded: () => SlotBuiltIns | undefined;
}

/**
 * One import of the built-ins, shared by every thin built-in it serves.
 *
 * @internal
 */
export function builtInsLoader(importBuiltIns: () => Promise<SlotBuiltIns>): BuiltInsLoader {
  let pending: Promise<SlotBuiltIns> | null = null;
  let loaded: SlotBuiltIns | undefined;
  return {
    load: () =>
      (pending ??= importBuiltIns().then(
        (builtIns) => (loaded = builtIns),
        (error: unknown) => {
          pending = null;
          throw error;
        },
      )),
    loaded: () => loaded,
  };
}

/**
 * A slot's props left opaque: the thin component hands the real one the very
 * props it was given, so the slot's props type holds by construction.
 */
type AnySlot = ComponentType<object>;

function thinBuiltIn<K extends SlotName>(loader: BuiltInsLoader, name: K): SlotBuiltIns[K] {
  function ThinBuiltIn(props: object) {
    const fromThread = useContext(BuiltInsContext);
    const [own, setOwn] = useState(loader.loaded);
    const builtIns = fromThread ?? own;

    useEffect(() => {
      if (builtIns !== undefined) return;
      let live = true;
      loader.load().then(
        (loaded) => {
          if (live) setOwn(loaded);
        },
        // Nothing is drawn, as before the import landed; the next mount retries.
        () => undefined,
      );
      return () => {
        live = false;
      };
    }, [builtIns]);

    if (builtIns === undefined) return null;
    const BuiltIn = builtIns[name] as unknown as AnySlot;
    return <BuiltIn {...props} />;
  }
  ThinBuiltIn.displayName = name;
  return ThinBuiltIn as unknown as SlotBuiltIns[K];
}

/**
 * A thin built-in for every slot. A slot added to `MessageThreadSlots`
 * without one here fails to compile.
 *
 * @internal
 */
export function thinBuiltIns(loader: BuiltInsLoader): SlotBuiltIns {
  return {
    MessageEntry: thinBuiltIn(loader, "MessageEntry"),
    ApprovalCard: thinBuiltIn(loader, "ApprovalCard"),
    TodoCard: thinBuiltIn(loader, "TodoCard"),
    TodoRow: thinBuiltIn(loader, "TodoRow"),
    PlanFileCard: thinBuiltIn(loader, "PlanFileCard"),
    PlanCompletionCard: thinBuiltIn(loader, "PlanCompletionCard"),
    PlanStreamingCard: thinBuiltIn(loader, "PlanStreamingCard"),
    SetupProgress: thinBuiltIn(loader, "SetupProgress"),
    RecalledMemoriesCard: thinBuiltIn(loader, "RecalledMemoriesCard"),
    RunErrorNotice: thinBuiltIn(loader, "RunErrorNotice"),
    LivenessStatusLine: thinBuiltIn(loader, "LivenessStatusLine"),
  };
}

/**
 * The light entry's built-ins: the real ones, imported with the conversation.
 *
 * @internal
 */
export const LAZY_BUILT_INS: SlotBuiltIns = thinBuiltIns(
  builtInsLoader(() => import("./slot-guard.js").then((module) => module.SLOT_BUILT_INS)),
);

// One export per slot, for the light entry. Each is the root's built-in to a
// reader, documented there; the reference leaves these out (`@hidden`), so a
// page names each built-in once.
/** @hidden */
export const MessageEntry = LAZY_BUILT_INS.MessageEntry;
/** @hidden */
export const ApprovalCard = LAZY_BUILT_INS.ApprovalCard;
/** @hidden */
export const TodoCard = LAZY_BUILT_INS.TodoCard;
/** @hidden */
export const TodoRow = LAZY_BUILT_INS.TodoRow;
/** @hidden */
export const PlanFileCard = LAZY_BUILT_INS.PlanFileCard;
/** @hidden */
export const PlanCompletionCard = LAZY_BUILT_INS.PlanCompletionCard;
/** @hidden */
export const PlanStreamingCard = LAZY_BUILT_INS.PlanStreamingCard;
/** @hidden */
export const SetupProgress = LAZY_BUILT_INS.SetupProgress;
/** @hidden */
export const RecalledMemoriesCard = LAZY_BUILT_INS.RecalledMemoriesCard;
/** @hidden */
export const RunErrorNotice = LAZY_BUILT_INS.RunErrorNotice;
/** @hidden */
export const LivenessStatusLine = LAZY_BUILT_INS.LivenessStatusLine;
