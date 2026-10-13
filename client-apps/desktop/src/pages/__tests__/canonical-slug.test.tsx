/**
 * Pins useCanonicalDetailSlug: a detail route naming a slug its resource
 * was renamed away from moves to the current slug, the query kept; a
 * rename made from the page moves it the same
 * way; and a route that moved to another resource is not pulled back by
 * the previous resource's slug while the new one loads.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useCanonicalDetailSlug } from "../library/canonical-slug";

afterEach(cleanup);

let moveTo: (slug: string) => void = () => {};
let goTo: (path: string) => void = () => {};

function Detail({ loaded }: { loaded: string | undefined }) {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  moveTo = useCanonicalDetailSlug("agents", org, slug, loaded);
  const location = useLocation();
  goTo = useNavigate();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderAt(path: string, loaded: string | undefined) {
  const view = (slug: string | undefined) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/library/agents/:org/:slug"
          element={<Detail loaded={slug} />}
        />
      </Routes>
    </MemoryRouter>
  );
  const rendered = render(view(loaded));
  return (slug: string | undefined) => rendered.rerender(view(slug));
}

function shown(): string {
  return screen.getByTestId("location").textContent ?? "";
}

describe("useCanonicalDetailSlug", () => {
  it("moves a renamed-away slug to the current one in place, the query kept", () => {
    renderAt("/library/agents/acme/test-bot?tab=channels", "support-bot");
    expect(shown()).toBe("/library/agents/acme/support-bot?tab=channels");
  });

  it("leaves a current slug alone, and moves after a rename from the page", () => {
    renderAt("/library/agents/acme/test-bot", "test-bot");
    expect(shown()).toBe("/library/agents/acme/test-bot");
    act(() => moveTo("support-bot"));
    expect(shown()).toBe("/library/agents/acme/support-bot");
  });

  it("is not pulled back by the previous resource's slug after a navigation to another", () => {
    const loadedNow = renderAt("/library/agents/acme/helper", "helper");
    act(() => goTo("/library/agents/acme/researcher"));
    loadedNow("helper");
    expect(shown()).toBe("/library/agents/acme/researcher");
    loadedNow("researcher");
    expect(shown()).toBe("/library/agents/acme/researcher");
  });
});
