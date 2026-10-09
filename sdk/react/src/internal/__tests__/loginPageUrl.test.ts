/**
 * Pins the check before a browser is sent to a login page: https anywhere,
 * http only on the loopback interface, and never a script or data URL.
 */
import { describe, expect, it } from "vitest";
import { UNSAFE_LOGIN_PAGE_MESSAGE, checkedLoginPageUrl } from "../loginPageUrl";

describe("checkedLoginPageUrl", () => {
  it.each([
    "https://login.example/authorize?client_id=c",
    "http://localhost:4000/authorize",
    "http://127.0.0.1:4000/authorize",
    "http://[::1]:4000/authorize",
  ])("lets the browser go to %s", (value) => {
    expect(checkedLoginPageUrl(value)).toBe(value);
  });

  it.each([
    "javascript:alert(document.domain)//",
    "data:text/html,<script>alert(1)</script>",
    "http://login.example/authorize",
    "not a url",
  ])("stops at %s", (value) => {
    expect(() => checkedLoginPageUrl(value)).toThrow(UNSAFE_LOGIN_PAGE_MESSAGE);
  });
});
