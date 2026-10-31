// One owner of the keyboard at a time. Ink delivers every key to every
// mounted `useInput`, so a surface that needs Esc or the arrows for itself
// (an open command or completion menu, the deny reason being typed, the file
// review's per-file view, a picker) claims the keyboard while it does, and the
// session's own keys (Esc stops, Ctrl+T and Shift+Tab switch the mode, Ctrl+O
// expands) act only while nothing holds a claim.
//
// Claims stack: each surface holds its own until it lets go, so two nested
// surfaces release in any order. Outside a `KeyOwnerProvider` a claim is a
// no-op and the keys always read as free, so a component used on its own
// behaves as before.
//
// Proven by __tests__/key-owner.test.tsx.

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

interface KeyOwner {
  /** Whether no surface holds the keyboard. */
  readonly free: boolean;
  readonly claim: (id: string) => void;
  readonly release: (id: string) => void;
}

const NO_OWNER: KeyOwner = { free: true, claim: () => {}, release: () => {} };

const KeyOwnerContext = createContext<KeyOwner>(NO_OWNER);

/** Holds the claims of the surfaces below it. */
export function KeyOwnerProvider({ children }: { readonly children: ReactNode }): React.ReactElement {
  const [claims, setClaims] = useState<ReadonlySet<string>>(new Set());
  const claim = useCallback((id: string) => setClaims((held) => (held.has(id) ? held : new Set([...held, id]))), []);
  const release = useCallback(
    (id: string) =>
      setClaims((held) => {
        if (!held.has(id)) return held;
        const next = new Set(held);
        next.delete(id);
        return next;
      }),
    [],
  );
  const owner = useMemo(() => ({ free: claims.size === 0, claim, release }), [claims, claim, release]);
  return React.createElement(KeyOwnerContext.Provider, { value: owner }, children);
}

/** Holds the keyboard while `active`, and lets go when it is not or the component unmounts. */
export function useKeyClaim(active: boolean): void {
  const id = useId();
  const { claim, release } = useContext(KeyOwnerContext);
  useEffect(() => {
    if (!active) return;
    claim(id);
    return () => release(id);
  }, [active, claim, release, id]);
}

/** Whether no surface holds the keyboard, so the session's own keys may act. */
export function useKeysFree(): boolean {
  return useContext(KeyOwnerContext).free;
}
