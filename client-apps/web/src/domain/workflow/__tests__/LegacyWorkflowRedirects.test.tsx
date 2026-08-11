import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

import {
  LegacyWorkflowDetailRedirect,
  LegacyWorkflowExecutionRedirect,
} from "../LegacyWorkflowRedirects";

// These components exist because a server-side redirect() cannot carry
// dynamic params in a static export (it bakes its target at build time —
// cloud#274). The tests pin the client-side recovery: the real org/slug/id
// are read from the browser URL at mount.

let replaceSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replaceSpy = vi.fn();
});

// happy-dom's location.replace would actually navigate; substitute the
// whole location with fixed values and a spy.
function setPath(pathname: string, search = "", hash = "") {
  vi.spyOn(window, "location", "get").mockReturnValue({
    pathname,
    search,
    hash,
    replace: replaceSpy,
  } as unknown as Location);
}

describe("LegacyWorkflowDetailRedirect", () => {
  it("redirects /workflows/[org]/[slug] to the library detail URL", () => {
    setPath("/workflows/acme/my-flow");
    render(<LegacyWorkflowDetailRedirect />);
    expect(replaceSpy).toHaveBeenCalledWith("/library/workflows/acme/my-flow");
  });

  it("carries query string and hash to the target", () => {
    setPath("/workflows/acme/my-flow", "?tab=editor", "#step-2");
    render(<LegacyWorkflowDetailRedirect />);
    expect(replaceSpy).toHaveBeenCalledWith(
      "/library/workflows/acme/my-flow?tab=editor#step-2",
    );
  });

  it("stays put on the build-time placeholder document", () => {
    setPath("/workflows/__placeholder__/__placeholder__");
    render(<LegacyWorkflowDetailRedirect />);
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

describe("LegacyWorkflowExecutionRedirect", () => {
  it("redirects /workflows/executions/[id] to the executions zone", () => {
    setPath("/workflows/executions/wfe_123");
    render(<LegacyWorkflowExecutionRedirect />);
    expect(replaceSpy).toHaveBeenCalledWith("/executions/wfe_123");
  });

  it("stays put on the build-time placeholder document", () => {
    setPath("/workflows/executions/__placeholder__");
    render(<LegacyWorkflowExecutionRedirect />);
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
