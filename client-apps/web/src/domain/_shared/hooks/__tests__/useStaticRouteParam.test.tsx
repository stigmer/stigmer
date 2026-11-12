/**
 * Pins how a statically exported dynamic route reads its real parameter:
 * Next's own value when it has one; for the pre-rendered placeholder, the
 * router's pathname, never the address bar's, which on a client-side
 * arrival still names the page left behind; the segment counted from the
 * end, decoded; nothing for a path that holds only the placeholder.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const router = vi.hoisted(() => ({ params: {} as Record<string, string>, pathname: "/" as string | null }));

vi.mock("next/navigation", () => ({
  useParams: () => router.params,
  usePathname: () => router.pathname,
}));

import { useStaticRouteParam } from "../useStaticRouteParam";

afterEach(() => {
  router.params = {};
  router.pathname = "/";
  window.history.replaceState({}, "", "/");
});

describe("useStaticRouteParam", () => {
  it("answers Next's own value when it has one", () => {
    router.params = { slug: "variance-reporter" };
    const { result } = renderHook(() => useStaticRouteParam("slug"));
    expect(result.current).toBe("variance-reporter");
  });

  it("reads the placeholder's real value from the router's path, not the address bar left behind", () => {
    // A client-side arrival from a session: the address bar has not moved yet.
    window.history.replaceState({}, "", "/sessions/ses_01m78bsmqk95tm7srhj51s8xsc");
    router.params = { org: "__placeholder__", slug: "__placeholder__" };
    router.pathname = "/library/agents/acme/variance-reporter";

    expect(renderHook(() => useStaticRouteParam("slug")).result.current).toBe("variance-reporter");
    expect(renderHook(() => useStaticRouteParam("org", 2)).result.current).toBe("acme");
  });

  it("follows the router to the next path", () => {
    router.params = { slug: "__placeholder__" };
    router.pathname = "/library/agents/acme/one";
    const { result, rerender } = renderHook(() => useStaticRouteParam("slug"));
    expect(result.current).toBe("one");

    router.pathname = "/library/agents/acme/two";
    rerender();
    expect(result.current).toBe("two");
  });

  it("decodes the segment, and answers nothing for a path holding only the placeholder", () => {
    router.params = { slug: "__placeholder__" };
    router.pathname = "/library/agents/acme/your%20agent";
    expect(renderHook(() => useStaticRouteParam("slug")).result.current).toBe("your agent");

    router.pathname = "/library/agents/acme/__placeholder__";
    expect(renderHook(() => useStaticRouteParam("slug")).result.current).toBeNull();
  });
});
