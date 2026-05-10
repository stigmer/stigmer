"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Stigmer, DeploymentMode } from "@stigmer/sdk";
import { cn, resolvePresetClass } from "@stigmer/theme";
import type { ThemePresetId } from "@stigmer/theme";
import { StigmerContext } from "./context";
import { DeploymentModeContext } from "./deployment-mode";
import type { ColorMode, ResolvedColorMode } from "./color-mode";
import { ColorModeContext, useSystemColorMode } from "./color-mode";
import { PortalContainerContext } from "./portal-container";
import { ModelRegistryContext } from "./models/ModelRegistryContext";
import type { ModelRegistryState } from "./models/ModelRegistryContext";
import { fetchModelRegistry } from "./models/registry";

/** Props for {@link StigmerProvider}. */
export interface StigmerProviderProps {
  /** A configured {@link Stigmer} client instance. */
  readonly client: Stigmer;
  /** React children rendered inside the provider scope. */
  readonly children: ReactNode;
  /**
   * Deployment mode of the connected Stigmer backend.
   *
   * - `"local"` — local Go CLI server (OSS). Cloud-only resources
   *   (API keys, IAM, identity management) are unavailable.
   * - `"cloud"` — Stigmer Cloud. All resources are available.
   *
   * Defaults to `"cloud"` so existing consumers see no change.
   * The Stigmer Console derives this from the API URL hostname.
   * Platform builders pass it based on their deployment context.
   */
  readonly deploymentMode?: DeploymentMode;
  /**
   * Built-in theme preset to apply.
   *
   * Maps to a CSS class on the scoping container so the preset's
   * design tokens take effect for all descendant Stigmer components.
   * Omit (or pass `"default"`) to use the base Stigmer palette.
   *
   * @example
   * ```tsx
   * <StigmerProvider client={client} preset="corporate">
   *   <ChatWidget />
   * </StigmerProvider>
   * ```
   */
  readonly preset?: ThemePresetId;
  /**
   * Additional CSS class names applied to the scoping container element.
   * The container always includes the `stgm` class for style isolation.
   */
  readonly className?: string;
  /**
   * Controls the color mode for all descendant Stigmer components.
   *
   * - `"light"` — light design tokens (default).
   * - `"dark"`  — dark design tokens.
   * - `"system"` — follows the user's OS preference via
   *   `prefers-color-scheme`. Resolved to `"light"` or `"dark"`
   *   before reaching CSS or React context.
   *
   * The resolved value is set as `data-stgm-color-mode` on the
   * scoping container and exposed via {@link useColorMode}.
   * Host applications pass their own theme state directly —
   * no ancestor CSS class conventions are required.
   *
   * @default "light"
   *
   * @example
   * ```tsx
   * // Explicit dark mode
   * <StigmerProvider client={client} colorMode="dark">
   *   <ChatWidget />
   * </StigmerProvider>
   *
   * // Bridge from MUI
   * const muiMode = useTheme().palette.mode;
   * <StigmerProvider client={client} colorMode={muiMode}>
   *   <ChatWidget />
   * </StigmerProvider>
   * ```
   */
  readonly colorMode?: ColorMode;
}

/**
 * React provider that distributes a {@link Stigmer} SDK client to
 * descendant components via {@link StigmerContext}.
 *
 * Renders a `<div class="stgm">` container that scopes Stigmer's
 * CSS reset and design tokens. External consumers importing
 * `@stigmer/react/styles.css` get isolated styles that do not
 * leak into the host application.
 *
 * The `colorMode` prop controls dark/light appearance via a
 * `data-stgm-color-mode` attribute on the scoping container.
 * Host applications pass their theme state directly — no ancestor
 * `.dark` class or Tailwind convention is required.
 *
 * Pass {@link StigmerProviderProps.preset | preset} to apply a
 * built-in theme, or use {@link StigmerProviderProps.className | className}
 * for custom styling.
 *
 * @example
 * ```tsx
 * const client = useMemo(
 *   () => new Stigmer({ baseUrl, getAccessToken }),
 *   [getAccessToken],
 * );
 *
 * <StigmerProvider client={client} preset="fintech" colorMode="dark">
 *   <App />
 * </StigmerProvider>
 * ```
 */
export function StigmerProvider({
  client,
  children,
  deploymentMode = "cloud",
  preset,
  className,
  colorMode = "light",
}: StigmerProviderProps) {
  const systemMode = useSystemColorMode();
  const resolvedMode: ResolvedColorMode =
    colorMode === "system" ? systemMode : colorMode;

  const presetClass = preset ? resolvePresetClass(preset) : "";

  const portalContainer = usePortalContainer(resolvedMode, presetClass);
  const registryState = useModelRegistryFetch(client);

  return (
    <StigmerContext.Provider value={client}>
      <DeploymentModeContext.Provider value={deploymentMode}>
        <ColorModeContext.Provider value={resolvedMode}>
          <ModelRegistryContext.Provider value={registryState}>
            <PortalContainerContext.Provider value={portalContainer}>
              <div
                className={cn("stgm", presetClass, className)}
                data-stgm-color-mode={resolvedMode}
              >
                {children}
              </div>
            </PortalContainerContext.Provider>
          </ModelRegistryContext.Provider>
        </ColorModeContext.Provider>
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>
  );
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const TOKEN_POLL_INTERVAL_MS = 500;
const TOKEN_POLL_MAX_MS = 10_000;

/**
 * Fetches the model registry from the authenticated API and caches
 * the result for the lifetime of the provider.
 *
 * Handles the auth race condition where `StigmerProvider` mounts before
 * PKCE authentication is established (e.g. desktop release builds with
 * a fresh localStorage). When the initial token is `null`, polls for
 * a valid token before giving up. Retries on transient failures with
 * exponential backoff. Exposes `refetch` for manual retry from the UI.
 */
function useModelRegistryFetch(client: Stigmer): ModelRegistryState {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Omit<ModelRegistryState, "refetch">>({
    models: [],
    isLoading: true,
    error: null,
  });

  const clientRef = useRef(client);
  clientRef.current = client;

  const fetchAttemptRef = useRef(0);

  const doFetch = useCallback(async (signal: AbortSignal) => {
    const c = clientRef.current;
    let token = await c.getAuthCredential();

    if (!token) {
      const start = Date.now();
      while (!token && Date.now() - start < TOKEN_POLL_MAX_MS) {
        if (signal.aborted) return;
        await new Promise((r) => setTimeout(r, TOKEN_POLL_INTERVAL_MS));
        if (signal.aborted) return;
        token = await c.getAuthCredential();
      }
    }

    return fetchModelRegistry(c.baseUrl, token, c.fetch);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    fetchAttemptRef.current = 0;

    const attempt = async () => {
      if (signal.aborted) return;

      setState((prev) => (prev.isLoading ? prev : { ...prev, isLoading: true }));

      try {
        const models = await doFetch(signal);
        if (!signal.aborted && models) {
          setState({ models, isLoading: false, error: null });
          fetchAttemptRef.current = 0;
        }
      } catch (err: unknown) {
        if (signal.aborted) return;

        const retryIdx = fetchAttemptRef.current;
        fetchAttemptRef.current = retryIdx + 1;

        if (retryIdx < RETRY_DELAYS_MS.length) {
          setTimeout(() => { if (!signal.aborted) attempt(); }, RETRY_DELAYS_MS[retryIdx]);
        } else {
          setState({
            models: [],
            isLoading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }
    };

    attempt();

    return () => { controller.abort(); };
  }, [doFetch, version]);

  const refetch = useCallback(() => {
    setState((prev) => {
      if (prev.isLoading) return prev;
      return { ...prev, isLoading: true, error: null };
    });
    setVersion((v) => v + 1);
  }, []);

  return { ...state, refetch };
}

/**
 * Creates and manages a portal container `<div>` appended to
 * `document.body` that mirrors the scoping attributes of the main
 * provider container.
 *
 * Portaled content (popovers, dialogs, menus) that targets this
 * element will inherit the correct `--stgm-*` token values —
 * including dark-mode overrides — because the container carries
 * `data-stgm-color-mode` and the preset class.
 *
 * The element is created once on mount and removed on unmount.
 * Attribute values are kept in sync with prop changes via a
 * separate effect.
 *
 * Returns `null` during SSR (no `document`).
 */
function usePortalContainer(
  colorMode: ResolvedColorMode,
  presetClass: string,
): HTMLElement | null {
  const elRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.className = cn("stgm", presetClass);
    el.setAttribute("data-stgm-color-mode", colorMode);
    el.setAttribute("data-stgm-portal", "");
    document.body.appendChild(el);
    elRef.current = el;
    setContainer(el);

    return () => {
      document.body.removeChild(el);
      elRef.current = null;
    };
  // Intentionally empty deps: create once on mount, remove on unmount.
  // Attribute syncing is handled by the effect below.
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    el.className = cn("stgm", presetClass);
    el.setAttribute("data-stgm-color-mode", colorMode);
  }, [colorMode, presetClass]);

  return container;
}
