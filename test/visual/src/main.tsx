// The gallery page. `?scene=<id>&mode=<light|dark>` draws one scene inside
// the kit's provider, over the stylesheet the kit ships and the theme
// presets; with no scene it lists every scene, for a person browsing
// (`npm run gallery`).
//
// The browser's storage is cleared before a scene draws: the organization
// provider remembers the active organization there, and a scene must never
// inherit another's.
//
// The docs mode (`&embed=1`) is the page the docs embed in a frame
// (`<Live>` in the site, which serves this build under /gallery/). It draws
// only the scenes src/live.ts names, answers a reader's sends, approvals
// and Stop through the scripted server (src/live-server.ts), and takes its
// look from the address (`preset`, `mode`, `radius`) and then from the
// theme messages the docs' playground posts, from the page that frames it on
// this page's own origin only, which it tells when it is listening. It
// never touches the browser's storage, which on the docs site is the
// site's own: the kit is given an in-memory one instead. Under
// /gallery/ there is no index: an address with no scene goes to the docs'
// Gallery page.
import "@stigmer/react-sdk/styles.css";
import "@stigmer/design-tokens/presets/corporate.css";
import "@stigmer/design-tokens/presets/startup.css";
import "@stigmer/design-tokens/presets/friendly.css";
import "@stigmer/design-tokens/presets/fintech.css";
import "@stigmer/design-tokens/presets/monochrome.css";
import "./gallery.css";

import { StrictMode, useEffect, useMemo, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { OrgProvider, StigmerProvider, type StigmerProviderProps } from "@stigmer/react-sdk";
import { MODES, SCENES, sceneUrl, type Mode, type Scene } from "./catalog.ts";
import { fakeStigmer } from "./fake-server.ts";
import type { Drawing } from "./scenes/drawing.ts";
import { LIVE, LIVE_READY_MESSAGE, isLiveThemeMessage, themeOf, type LiveTheme } from "./live.ts";
import { DRAWINGS } from "./scenes/index.ts";

/**
 * What a drawing tells the provider it is drawn in, in one place, so every
 * provider on this page reads a drawing the same way and a field added to
 * `Drawing` reaches each of them.
 */
function providerProps(drawing: Drawing): Pick<StigmerProviderProps, "preset" | "deploymentMode" | "publicBaseUrl" | "showHelpLink"> {
  return {
    preset: drawing.preset,
    deploymentMode: drawing.deploymentMode,
    publicBaseUrl: drawing.publicBaseUrl,
    showHelpLink: drawing.showHelpLink,
  };
}

/** One scene in one mode. Its drawing and client are made once, outside React's render. */
function sceneView(scene: Scene, mode: Mode): ReactElement {
  const drawing = DRAWINGS[scene.id]();
  const client = fakeStigmer(drawing.routes);
  const tree = drawing.render();
  return (
    <StigmerProvider
      client={client}
      colorMode={mode}
      {...providerProps(drawing)}
      className="gallery-scene"
    >
      {drawing.inOrganization ? <OrgProvider>{tree}</OrgProvider> : tree}
    </StigmerProvider>
  );
}

function Index(): ReactElement {
  return (
    <main className="gallery-index">
      <h1>The kit's gallery</h1>
      <p>
        Every scene the visual suite pictures, drawn from fixed data. Each is compared with its approved screenshot in
        test/visual/tests/__screenshots__.
      </p>
      <table>
        <tbody>
          {SCENES.map((scene) => (
            <tr key={scene.id}>
              <td>{scene.title}</td>
              {MODES.map((mode) => (
                <td key={mode}>
                  <a href={sceneUrl(scene.id, mode)}>{mode}</a>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function Unknown({ id }: { readonly id: string }): ReactElement {
  return (
    <main className="gallery-index">
      <h1>No scene is called “{id}”</h1>
      <a href={import.meta.env.BASE_URL === "/gallery/" ? DOCS_GALLERY : "/"}>Every scene</a>
    </main>
  );
}

/** Where an address under /gallery/ with no scene goes: the docs page that embeds the demos. */
const DOCS_GALLERY = "/docs/sdk/react/gallery";

/** A `Storage` held in memory, for the kit in the docs mode: nothing read from the site's storage, nothing left in it. */
class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }
}

/** The corner radius a reader chose, over whatever the preset sets; nothing when they kept the preset's own. */
function RadiusOverride({ radius }: { readonly radius: number | null }): ReactElement | null {
  if (radius === null) return null;
  return <style>{`.gallery-scene { --stgm-radius: ${radius}rem !important; }`}</style>;
}

/** One scene in the docs mode: its look from the address, then from the playground's messages. */
function LiveScene({ scene, initial }: { readonly scene: Scene; readonly initial: LiveTheme }): ReactElement {
  const [theme, setTheme] = useState(initial);
  // The drawing and its client are made once: a change of look redraws the
  // provider, never the conversation a reader is in the middle of.
  const { drawing, client } = useMemo(() => {
    const drawing = DRAWINGS[scene.id]();
    return { drawing, client: fakeStigmer(drawing.liveRoutes?.() ?? drawing.routes) };
  }, [scene.id]);
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      // Only the page that frames this one (the docs' playground), on the
      // same origin, changes its look; a message from anywhere else is ignored.
      if (event.origin !== window.location.origin || (event.source !== window.parent && event.source !== window)) return;
      if (!isLiveThemeMessage(event.data)) return;
      setTheme({ preset: event.data.preset, mode: event.data.mode, radius: event.data.radius });
    };
    window.addEventListener("message", onMessage);
    // Say it is listening, so a look picked while this page loaded is sent again.
    if (window.parent !== window) window.parent.postMessage({ type: LIVE_READY_MESSAGE }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const tree = drawing.render();
  return (
    <>
      <RadiusOverride radius={theme.radius} />
      <StigmerProvider
        client={client}
        colorMode={theme.mode}
        {...providerProps(drawing)}
        preset={theme.preset === "default" ? drawing.preset : theme.preset}
        className="gallery-scene"
      >
        {drawing.inOrganization ? <OrgProvider>{tree}</OrgProvider> : tree}
      </StigmerProvider>
    </>
  );
}

/** The docs mode's page: a scene src/live.ts names, or nothing. */
function livePage(id: string | null): ReactElement | null {
  if (id === null) {
    window.location.replace(DOCS_GALLERY);
    return null;
  }
  const scene = LIVE.some((demo) => demo.scene === id) ? SCENES.find((s) => s.id === id) : undefined;
  if (scene === undefined) return <Unknown id={id} />;
  Object.defineProperty(window, "localStorage", { value: new MemoryStorage(), configurable: true });
  return <LiveScene scene={scene} initial={themeOf(window.location.search)} />;
}

function page(): ReactElement | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("scene");
  if (params.get("embed") === "1" || import.meta.env.BASE_URL === "/gallery/") return livePage(id);
  if (id === null) return <Index />;
  const scene = SCENES.find((s) => s.id === id);
  if (scene === undefined) return <Unknown id={id} />;
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  window.localStorage.clear();
  return sceneView(scene, mode);
}

const root = document.getElementById("gallery");
if (root === null) throw new Error("the gallery page has no #gallery element");
createRoot(root).render(<StrictMode>{page()}</StrictMode>);
