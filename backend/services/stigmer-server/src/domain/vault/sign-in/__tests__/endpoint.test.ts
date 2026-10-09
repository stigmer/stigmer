/**
 * Pins the login endpoint rule: https anywhere, http only on the loopback
 * interface, and nothing else, a script URL above all.
 */
import { describe, expect, it } from "vitest";

import { loginEndpointProblem } from "../endpoint.js";

describe("loginEndpointProblem", () => {
  it.each([
    "https://login.vendor.test/authorize",
    "http://localhost:4000/authorize",
    "http://127.0.0.1:4000/token",
    "http://[::1]:4000/register",
  ])("takes %s", (value) => {
    expect(loginEndpointProblem(value)).toBeUndefined();
  });

  it.each([
    "javascript:alert(document.domain)//",
    "data:text/html,<script>alert(1)</script>",
    "http://login.vendor.test/authorize",
    "http://127.0.0.1.attacker.test/authorize",
    "ftp://login.vendor.test/authorize",
  ])("refuses %s", (value) => {
    expect(loginEndpointProblem(value)).toBe("must be an https URL (http only for localhost, 127.0.0.1 or [::1])");
  });

  it("refuses a value that is not an absolute URL", () => {
    expect(loginEndpointProblem("/authorize")).toBe("is not an absolute URL");
  });
});
