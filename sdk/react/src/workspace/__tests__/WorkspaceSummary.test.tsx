/**
 * WorkspaceSummary lists a conversation's repositories and folders from its
 * resources: a repository by name with its shortened URL, a folder by name
 * with its path. Files are not workspace entries and are skipped, and a
 * conversation holding only Files renders nothing.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { WorkspaceSummary } from "../WorkspaceSummary";

afterEach(cleanup);

const repository = create(SessionResourceSchema, {
  name: "acme/api",
  resource: { case: "gitRepository", value: { url: "https://github.com/acme/api.git" } },
});
const folder = create(SessionResourceSchema, {
  name: "dev/site",
  resource: { case: "localPath", value: { path: "/Users/dev/site" } },
});
const file = create(SessionResourceSchema, {
  resource: { case: "file", value: { fileId: "file_1", mountPath: "brief.pdf" } },
});

describe("WorkspaceSummary", () => {
  it("lists repositories and folders, never Files", () => {
    render(<WorkspaceSummary entries={[repository, file, folder]} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(screen.getByText("github.com/acme/api")).toBeTruthy();
    expect(screen.getByText("dev/site")).toBeTruthy();
    expect(screen.getByText("/Users/dev/site")).toBeTruthy();
    expect(screen.queryByText(/brief\.pdf|file_1/)).toBeNull();
  });

  it("renders nothing for a conversation holding only Files", () => {
    const { container } = render(<WorkspaceSummary entries={[file]} />);

    expect(container.querySelector("ul")).toBeNull();
  });
});
