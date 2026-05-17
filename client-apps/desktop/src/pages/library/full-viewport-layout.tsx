import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface FullViewportLayoutValue {
  readonly isFullViewport: boolean;
  readonly setFullViewport: (active: boolean) => void;
}

const FullViewportLayoutContext =
  createContext<FullViewportLayoutValue | null>(null);

export function FullViewportLayoutProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isFullViewport, setIsFullViewport] = useState(false);

  const setFullViewport = useCallback((active: boolean) => {
    setIsFullViewport(active);
  }, []);

  const value = useMemo<FullViewportLayoutValue>(
    () => ({ isFullViewport, setFullViewport }),
    [isFullViewport, setFullViewport],
  );

  return (
    <FullViewportLayoutContext.Provider value={value}>
      {children}
    </FullViewportLayoutContext.Provider>
  );
}

export function useFullViewportLayout(): FullViewportLayoutValue {
  const ctx = useContext(FullViewportLayoutContext);
  if (!ctx) {
    throw new Error(
      "useFullViewportLayout must be used within <FullViewportLayoutProvider>",
    );
  }
  return ctx;
}

export function useRequestFullViewport(active: boolean): void {
  const { setFullViewport } = useFullViewportLayout();

  useEffect(() => {
    setFullViewport(active);
    return () => setFullViewport(false);
  }, [active, setFullViewport]);
}
