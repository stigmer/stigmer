/**
 * The login-app forms read the addresses an app signs in to as a comma- or
 * newline-separated list, blanks dropped; the server normalizes each.
 */
import { describe, expect, it } from "vitest";
import { MAX_ADDRESSES, parseAddressList } from "../addresses";

describe("parseAddressList", () => {
  it("splits on commas and new lines and drops blanks", () => {
    expect(parseAddressList(" https://mcp.slack.com/mcp ,github.com\n\n,  ")).toEqual([
      "https://mcp.slack.com/mcp",
      "github.com",
    ]);
    expect(parseAddressList("")).toEqual([]);
  });

  it("caps an app at twenty addresses, as the contract does", () => {
    expect(MAX_ADDRESSES).toBe(20);
  });
});
