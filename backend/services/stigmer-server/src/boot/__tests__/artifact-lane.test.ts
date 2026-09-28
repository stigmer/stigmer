/**
 * Pins the artifact lane's placement rules: a configured port wins (an
 * explicit 0 included), an ephemeral unified port makes the lane ephemeral
 * rather than deriving port 1 (stigmer#1089), and otherwise the lane sits at
 * the unified port + 1; a configured serve URL passes through, and the
 * derived one follows the port the lane bound and refuses before the bind.
 */
import { describe, expect, it } from "vitest";

import {
  resolveArtifactLanePort,
  resolveArtifactServeUrl,
} from "../artifact-lane.js";

describe("resolveArtifactLanePort", () => {
  it("keeps a configured port whatever the unified port is", () => {
    expect(
      resolveArtifactLanePort({ configured: 9000, unifiedPort: 7234 }),
    ).toBe(9000);
    expect(resolveArtifactLanePort({ configured: 9000, unifiedPort: 0 })).toBe(
      9000,
    );
  });

  it("keeps a configured 0 as an explicit ephemeral bind", () => {
    expect(resolveArtifactLanePort({ configured: 0, unifiedPort: 7234 })).toBe(
      0,
    );
  });

  it("binds ephemeral when the unified port is not known until listen, never port 1", () => {
    expect(
      resolveArtifactLanePort({ configured: undefined, unifiedPort: 0 }),
    ).toBe(0);
  });

  it("takes the unified port + 1 when nothing is configured", () => {
    expect(
      resolveArtifactLanePort({ configured: undefined, unifiedPort: 7234 }),
    ).toBe(7235);
  });
});

describe("resolveArtifactServeUrl", () => {
  it("passes a configured serve URL through as given", () => {
    expect(
      resolveArtifactServeUrl(
        "https://artifacts.stigmer.test",
        () => undefined,
      ),
    ).toBe("https://artifacts.stigmer.test");
  });

  it("derives the lane's localhost origin from the port it bound", () => {
    let bound: number | undefined;
    const serveUrl = resolveArtifactServeUrl("", () => bound);
    if (typeof serveUrl === "string")
      throw new Error("expected a resolver for an unset serve URL");
    bound = 51234;
    expect(serveUrl()).toBe("http://localhost:51234");
  });

  it("refuses to mint a URL before the lane bound", () => {
    const serveUrl = resolveArtifactServeUrl("", () => undefined);
    if (typeof serveUrl === "string")
      throw new Error("expected a resolver for an unset serve URL");
    expect(() => serveUrl()).toThrow(
      "before the artifact file server bound its port",
    );
  });
});
