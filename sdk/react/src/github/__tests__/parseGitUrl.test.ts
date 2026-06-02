import { describe, it, expect } from "vitest";
import { parseGitUrl } from "../parseGitUrl";

describe("parseGitUrl", () => {
  it("parses a standard HTTPS GitHub URL", () => {
    expect(parseGitUrl("https://github.com/acme/api")).toEqual({
      owner: "acme",
      repo: "api",
    });
  });

  it("parses an HTTPS URL with .git suffix", () => {
    expect(parseGitUrl("https://github.com/acme/api.git")).toEqual({
      owner: "acme",
      repo: "api",
    });
  });

  it("parses an SSH-style URL", () => {
    expect(parseGitUrl("git@github.com:acme/api.git")).toEqual({
      owner: "acme",
      repo: "api",
    });
  });

  it("parses a URL with a trailing slash stripped", () => {
    expect(parseGitUrl("https://github.com/org/repo")).toEqual({
      owner: "org",
      repo: "repo",
    });
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitUrl("https://gitlab.com/acme/api")).toBeNull();
    expect(parseGitUrl("https://bitbucket.org/acme/api")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitUrl("")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(parseGitUrl("not-a-url")).toBeNull();
    expect(parseGitUrl("https://github.com/")).toBeNull();
    expect(parseGitUrl("https://github.com/acme")).toBeNull();
  });

  it("handles owner/repo with hyphens and underscores", () => {
    expect(parseGitUrl("https://github.com/my-org/my_repo.git")).toEqual({
      owner: "my-org",
      repo: "my_repo",
    });
  });
});
