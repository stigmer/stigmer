/**
 * The principal display driver. Pins: a team is named by its name and
 * handle; an id with no team is absent (the core's fallback names it); a
 * kind other than team is answered with nothing and reads nothing,
 * because the core asks about every principal kind a list holds.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";

import { newTeamPrincipalDisplay } from "../display.js";
import { InMemoryTeamStore, storedTeam } from "./in-memory-team-store.js";

describe("the team principal display", () => {
  it("names each team it knows and leaves the rest to the fallback", async () => {
    const teams = new InMemoryTeamStore();
    await teams.insert(storedTeam({ id: "tm_sre", org: "acme", slug: "sre", name: "Site Reliability" }));
    const display = newTeamPrincipalDisplay(teams);

    const views = await display.resolve(ApiResourceKind.team, ["tm_sre", "tm_gone"]);
    expect([...views.keys()]).toEqual(["tm_sre"]);
    const view = views.get("tm_sre");
    expect(view?.kind).toBe("team");
    expect(view?.name).toBe("Site Reliability");
    expect(view?.slug).toBe("sre");
    expect(view?.members).toEqual([]);
  });

  it("answers nothing for another kind without a read", async () => {
    const display = newTeamPrincipalDisplay({
      findByIds: () => {
        throw new Error("read for a kind the driver does not name");
      },
    });
    const views = await display.resolve(ApiResourceKind.organization, ["acme"]);
    expect(views.size).toBe(0);
  });
});
