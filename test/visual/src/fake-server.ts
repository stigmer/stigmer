// The gallery's server: a real Stigmer client over an in-memory router, so
// the kit's data hooks run their own code against fixed answers.
//
// A scene names the calls it answers (its `routes`, written with connect's
// router: `router.service(Controller, { method: () => answer })`); every
// other call answers `Unimplemented`, as the router does for a method no
// route serves. A scene that forgets a call therefore draws the component's
// error state, which its approved screenshot refuses, never a quiet empty
// list. The model registry, which the provider fetches over plain HTTP
// through the client's `fetch`, is answered here for every scene.
//
// The page reports when the scene has settled: no call in flight, and none
// started for QUIET_MS, so a call one answer leads to (an organization list,
// then its provider keys) is waited for too. The spec reads `idle` before it
// takes the picture.
import { createRouterTransport, type ConnectRouter, type Interceptor } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/client";
import { MODEL_REGISTRY } from "./fixtures.ts";

/** The calls a scene answers. */
export type Routes = (router: ConnectRouter) => void;

/** How long the page waits with no call in flight before it calls the scene settled. */
const QUIET_MS = 250;

/** What the page tells the spec about its calls: how many are in flight, and whether the scene has settled. */
export interface GalleryState {
  inFlight: number;
  idle: boolean;
}

declare global {
  interface Window {
    /** The gallery page's state, read by the Playwright spec. */
    gallery?: GalleryState;
  }
}

/** A client that answers `routes` and the model registry, and counts its calls into `window.gallery`. */
export function fakeStigmer(routes: Routes = () => {}): Stigmer {
  const state: GalleryState = { inFlight: 0, idle: false };
  window.gallery = state;
  let quiet: ReturnType<typeof setTimeout> | undefined;

  const begin = () => {
    state.inFlight += 1;
    state.idle = false;
    clearTimeout(quiet);
  };
  const end = () => {
    state.inFlight -= 1;
    if (state.inFlight === 0) quiet = setTimeout(() => (state.idle = state.inFlight === 0), QUIET_MS);
  };
  // A scene with no calls at all settles too.
  quiet = setTimeout(() => (state.idle = state.inFlight === 0), QUIET_MS);

  const counted: Interceptor = (next) => async (request) => {
    begin();
    try {
      return await next(request);
    } finally {
      end();
    }
  };

  const fetchRegistry: typeof globalThis.fetch = async (input) => {
    begin();
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).pathname === "/v1/proxy/model-registry") {
        return new Response(JSON.stringify(MODEL_REGISTRY), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("the gallery serves only the model registry over HTTP", { status: 501 });
    } finally {
      end();
    }
  };

  return new Stigmer({
    baseUrl: "https://gallery.invalid",
    apiKey: "stk_gallery",
    customTransport: createRouterTransport(routes, { transport: { interceptors: [counted] } }),
    fetch: fetchRegistry,
  });
}
