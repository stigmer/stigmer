/**
 * The credential vocabulary's comparisons. Pinned: a target compares as
 * the server's `targetKey` does (kind and org/slug, a host lowercased);
 * ownership reads the owner oneof; the serving credential of an owner is
 * found by target and owner alone; a sign-in is the oauth source.
 */
import { describe, expect, it } from "vitest";
import {
  credentialOwnerKind,
  isOrgCredential,
  isOwnCredential,
  isSignInCredential,
  servingCredential,
  targetRefKey,
} from "../model";
import { storedCredential } from "./credential-world";

const ORG = "org_acme";
const AGENT = { kind: "agent", org: ORG, slug: "reviewer" } as const;

describe("credential model", () => {
  it("compares targets as the server does", () => {
    expect(targetRefKey(AGENT)).toBe("agent:org_acme/reviewer");
    expect(targetRefKey({ kind: "mcp_server", org: ORG, slug: "linear" })).toBe("mcp_server:org_acme/linear");
    expect(targetRefKey({ kind: "git_host", host: "GitHub.com" })).toBe("git_host:github.com");
  });

  it("reads who a credential belongs to", () => {
    const mine = storedCredential({ id: "mine", org: ORG, owner: "person" });
    const team = storedCredential({ id: "team", org: ORG, owner: "org" });
    expect([credentialOwnerKind(mine), isOwnCredential(mine), isOrgCredential(mine)]).toEqual(["person", true, false]);
    expect([credentialOwnerKind(team), isOwnCredential(team), isOrgCredential(team)]).toEqual(["org", false, true]);
  });

  it("finds the credential of an owner serving a target", () => {
    const credentials = [
      storedCredential({ id: "team", org: ORG, owner: "org", serves: [AGENT] }),
      storedCredential({ id: "mine", org: ORG, owner: "person", serves: [AGENT] }),
      storedCredential({ id: "other", org: ORG, owner: "person", serves: [{ kind: "git_host", host: "github.com" }] }),
    ];
    expect(servingCredential(credentials, AGENT, "person")?.metadata?.id).toBe("mine");
    expect(servingCredential(credentials, AGENT, "org")?.metadata?.id).toBe("team");
    expect(servingCredential(credentials, { kind: "git_host", host: "gitlab.com" }, "person")).toBeUndefined();
  });

  it("tells a sign-in apart from a typed credential", () => {
    expect(isSignInCredential(storedCredential({ id: "s", org: ORG, owner: "person", signIn: true }))).toBe(true);
    expect(isSignInCredential(storedCredential({ id: "t", org: ORG, owner: "person" }))).toBe(false);
  });
});
