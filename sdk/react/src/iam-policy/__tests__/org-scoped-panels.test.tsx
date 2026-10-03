/**
 * The sharing panels pass the organization down as `org`: SharePanel to its
 * access list, and PrincipalPicker to the candidates it searches. The
 * children and the candidates hook are stubbed and record what they got.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

const given = vi.hoisted(() => ({ accessList: [] as unknown[], candidates: [] as unknown[] }));

vi.mock("../PeopleWithAccess.js", () => ({
  PeopleWithAccess: ({ org }: { org: string }) => {
    given.accessList.push(org);
    return null;
  },
}));

vi.mock("../useGranteeCandidates.js", () => ({
  useGranteeCandidates: (options: { org: string | null }) => {
    given.candidates.push(options.org);
    return { people: [], teams: [], isLoading: false, error: null };
  },
}));

import { PrincipalPicker } from "../PrincipalPicker";
import { SharePanel } from "../SharePanel";

afterEach(() => {
  cleanup();
  given.accessList = [];
  given.candidates = [];
});

describe("the sharing panels hand the organization down as org", () => {
  it("SharePanel gives its access list the organization", () => {
    render(
      <SharePanel
        resource={{ kind: "agent", id: "agt_1", resourceKind: ApiResourceKind.agent }}
        resourceKindString="agent"
        resourceKind={ApiResourceKind.agent}
        org="acme"
      />,
    );
    expect(given.accessList).toContain("acme");
  });

  it("PrincipalPicker searches the organization's candidates, and none without one", () => {
    render(<PrincipalPicker org="acme" value={null} onChange={() => {}} autoFocus={false} />);
    expect(given.candidates.at(-1)).toBe("acme");
    cleanup();
    render(<PrincipalPicker org="" value={null} onChange={() => {}} autoFocus={false} />);
    expect(given.candidates.at(-1)).toBeNull();
  });
});
