/**
 * GitHubRepoPicker as a person uses it:
 *   - "My Repos" lists the repositories under each owner's heading with a
 *     count, and marks each one private or public;
 *   - "All GitHub" says how many repositories the search matched;
 *   - picking a repository opens its Branch choice on the default branch,
 *     and Add hands back the clone URL and the chosen branch.
 *
 * The repository and search hooks are stubbed; their server reads are
 * proven in serverReads.test.tsx.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GitHubBranch, GitHubRepo, UseGitHubReposReturn } from "../useGitHubRepos";
import type { UseGitHubSearchReturn } from "../useGitHubSearch";

function repo(id: number, owner: string, name: string, isPrivate: boolean): GitHubRepo {
  return {
    id,
    fullName: `${owner}/${name}`,
    name,
    owner,
    ownerType: "Organization",
    htmlUrl: `https://github.com/${owner}/${name}`,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
    defaultBranch: "main",
    isPrivate,
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

const API = repo(1, "acme", "api", true);
const DOCS = repo(2, "acme", "docs", false);
const REACT = repo(3, "facebook", "react", false);

const fetchBranches = vi.fn(async (_owner: string, _name: string): Promise<GitHubBranch[]> => [
  { name: "main" },
  { name: "release" },
]);

const reposState = vi.hoisted(() => ({ current: null as UseGitHubReposReturn | null }));
const searchState = vi.hoisted(() => ({ current: null as UseGitHubSearchReturn | null }));

vi.mock("../useGitHubRepos.js", () => ({
  useGitHubRepos: () => reposState.current,
}));
vi.mock("../useGitHubSearch.js", () => ({
  useGitHubSearch: () => searchState.current,
}));

import { GitHubRepoPicker } from "../GitHubRepoPicker";

beforeEach(() => {
  localStorage.clear();
  reposState.current = {
    repos: [API, DOCS],
    isLoading: false,
    isBackgroundLoading: false,
    error: null,
    search: "",
    setSearch: () => {},
    hasMore: false,
    fetchBranches,
  };
  searchState.current = {
    results: [REACT],
    isSearching: false,
    error: null,
    query: "react",
    setQuery: () => {},
    totalCount: 1234,
    hasMore: false,
    loadMore: () => {},
  };
});

afterEach(() => {
  cleanup();
  fetchBranches.mockClear();
});

describe("GitHubRepoPicker", () => {
  it("lists my repositories under their owner, with a count, each marked private or public", () => {
    render(<GitHubRepoPicker org="acme" onSelect={() => {}} />);

    const list = screen.getByRole("listbox", { name: "Repositories" });
    expect(within(list).getByText("acme")).toBeTruthy();
    expect(within(list).getByText("(2)")).toBeTruthy();

    const api = within(list).getByRole("option", { name: /api/ });
    expect(within(api).getByText("private")).toBeTruthy();
    const docs = within(list).getByRole("option", { name: /docs/ });
    expect(within(docs).getByText("public")).toBeTruthy();
  });

  it("says how many repositories a search of all GitHub matched", () => {
    render(<GitHubRepoPicker org="acme" onSelect={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "All GitHub" }));

    const list = screen.getByRole("listbox", { name: "Repositories" });
    expect(within(list).getByText(`${(1234).toLocaleString()} results`)).toBeTruthy();
    expect(within(list).getByRole("option", { name: /react/ }).textContent).toContain("facebook/react");
  });

  it("opens the Branch choice on the default branch, and Add hands back the clone URL and branch", async () => {
    const onSelect = vi.fn();
    render(<GitHubRepoPicker org="acme" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("option", { name: /api/ }));

    expect(screen.getByText("Branch")).toBeTruthy();
    const branch = await screen.findByRole("combobox");
    expect(fetchBranches).toHaveBeenCalledWith("acme", "api");
    expect(within(branch).getAllByRole("option").map((o) => o.textContent)).toEqual(["main", "release"]);
    expect((branch as HTMLSelectElement).value).toBe("main");

    fireEvent.change(branch, { target: { value: "release" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onSelect).toHaveBeenCalledWith("https://github.com/acme/api.git", "release");
  });
});
