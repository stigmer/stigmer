// The gallery page. `?scene=<id>&mode=<light|dark>` draws one scene inside
// the kit's provider, over the stylesheet the kit ships and the theme
// presets; with no scene it lists every scene, for a person browsing
// (`npm run gallery`).
//
// The browser's storage is cleared before a scene draws: the organization
// provider remembers the active organization there, and a scene must never
// inherit another's.
import "@stigmer/react-sdk/styles.css";
import "@stigmer/design-tokens/presets/corporate.css";
import "@stigmer/design-tokens/presets/startup.css";
import "@stigmer/design-tokens/presets/friendly.css";
import "@stigmer/design-tokens/presets/fintech.css";
import "@stigmer/design-tokens/presets/monochrome.css";
import "./gallery.css";

import { StrictMode, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { OrgProvider, StigmerProvider } from "@stigmer/react-sdk";
import { MODES, SCENES, sceneUrl, type Mode, type Scene } from "./catalog.ts";
import { fakeStigmer } from "./fake-server.ts";
import { DRAWINGS } from "./scenes/index.ts";

/** One scene in one mode. Its drawing and client are made once, outside React's render. */
function sceneView(scene: Scene, mode: Mode): ReactElement {
  const drawing = DRAWINGS[scene.id]();
  const client = fakeStigmer(drawing.routes);
  const tree = drawing.render();
  return (
    <StigmerProvider
      client={client}
      colorMode={mode}
      preset={drawing.preset}
      deploymentMode={drawing.deploymentMode}
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
      <a href="/">Every scene</a>
    </main>
  );
}

function page(): ReactElement {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("scene");
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
