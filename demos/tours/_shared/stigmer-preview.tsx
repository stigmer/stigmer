/**
 * Product glue for real-component tours.
 *
 * A tour that renders real `@stigmer/react` components (e.g. `AgentDetailView`,
 * `MessageThread`, `SessionComposer`) needs three things to render in isolation
 * with no backend: an SDK client, the `.stgm` theme scope + design tokens, and
 * fixture data. This factory supplies all three from just the tour's RPC
 * fixtures, so each tour's `.scenar/providers.tsx` stays a few lines.
 *
 * Data is mocked with an in-process Connect **router transport** rather than a
 * service worker (scenar-cloud DD-002): `providers.tsx` is the one artifact
 * `scenar pack` and `scenar render` wrap every step in, so a transport here
 * covers both the dev preview and the packed embed with a single mechanism —
 * no network, no MSW.
 *
 * This binding lives in the demos workspace, not in `@scenar/*`: it is
 * irreducibly product-specific (Stigmer's client, provider, and stylesheet).
 * Scenar stays product-agnostic.
 */
// The COMPILED stylesheet, not `@stigmer/react/styles.css`: the in-repo
// workspace export points at the uncompiled Tailwind source, and `scenar pack`
// deliberately does not run Tailwind (scenar-cloud DD-003). The dist artifact
// is byte-identical to what npm consumers receive; `npm run build:css -w
// @stigmer/react` produces it (pack-all runs that automatically).
import "../../../sdk/react/dist/styles.css";

import type { ReactNode } from "react";
import { createRouterTransport, type ConnectRouter } from "@connectrpc/connect";
import { getEmbedColorMode } from "@scenar/react";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";

/**
 * Benign `fetch` for the two registry endpoints `StigmerProvider` requests on
 * mount — the model registry and the task-kind registry. These go over plain
 * HTTP (not through the Connect transport), so the fixture router never sees
 * them; against a packed embed's own origin they would 404. Returning an
 * empty-but-OK JSON body lets both resolve to empty registries immediately —
 * no retries, no error-state churn, no request escaping the page. Tours drive
 * their components from fixtures, so an empty registry is the right answer.
 */
const emptyRegistryFetch: typeof globalThis.fetch = async () =>
  new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Props for the `PreviewProviders` component a tour exports from `.scenar/`. */
interface PreviewProvidersProps {
  readonly children: ReactNode;
}

/**
 * Build a tour's `PreviewProviders` from just its RPC fixtures.
 *
 * `register` receives the Connect router; register only the RPCs the tour's
 * components actually call. Unregistered RPCs fall through to Connect's
 * `unimplemented` response, which the SDK hooks catch and degrade from — so
 * mock the minimum, not the whole API surface.
 *
 * @example
 * ```tsx
 * // tours/<slug>/.scenar/providers.tsx
 * import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
 * import { createStigmerPreview } from "../../_shared/stigmer-preview";
 * import { buildDemoAgent } from "../steps";
 *
 * export const PreviewProviders = createStigmerPreview((router) => {
 *   router.service(AgentQueryController, { getByReference: () => buildDemoAgent() });
 * });
 * ```
 */
export function createStigmerPreview(
  register: (router: ConnectRouter) => void,
): (props: PreviewProvidersProps) => ReactNode {
  // Built once when the tour's providers module loads: the fixtures are static,
  // so there is nothing to rebuild per render.
  const client = new Stigmer({
    baseUrl: "/",
    // A non-null token short-circuits StigmerProvider's on-mount auth-token
    // poll (it waits up to 10s for a token before its first registry fetch).
    // The value is never sent anywhere: the router transport ignores auth and
    // the registry fetch is stubbed above.
    getAccessToken: () => "scenar-preview",
    customTransport: createRouterTransport(register),
    fetch: emptyRegistryFetch,
  });

  return function PreviewProviders({ children }: PreviewProvidersProps) {
    // StigmerProvider renders the single `.stgm` scope + `data-stgm-color-mode`
    // that themes both the real components and the tour's chrome; the mode is
    // read from the embed's own `?theme` by getEmbedColorMode().
    return (
      <StigmerProvider client={client} colorMode={getEmbedColorMode()}>
        {children}
      </StigmerProvider>
    );
  };
}
