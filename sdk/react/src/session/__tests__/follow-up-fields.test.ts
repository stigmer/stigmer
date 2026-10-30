/**
 * The follow-up lens reads a stored conversation into what the session
 * page holds (no token, no File) and compares two values of a field the
 * way a follow-up must: an unset field equals an empty one, order counts,
 * and a reference's kind does not.
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { followUpFieldsOf, sameRefs, sameResources } from "../follow-up-fields";

const BRANCH_AND_PR = GitWriteBackMode.GIT_WRITE_BACK_BRANCH_AND_PR;

describe("followUpFieldsOf", () => {
  it("reads repositories and folders with every stored field but the token, and no File", () => {
    const session = create(SessionSchema, {
      spec: {
        resources: [
          {
            name: "backend",
            resource: {
              case: "gitRepository",
              value: { url: "https://github.com/acme/api.git", branch: "main", commit: "4f2a9c1e", writeBackMode: BRANCH_AND_PR, token: "***REDACTED***" },
            },
          },
          { name: "brief", resource: { case: "file", value: { fileId: "file_brief" } } },
          { name: "site", resource: { case: "localPath", value: { path: "/Users/dev/site" } } },
          { name: "web", resource: { case: "gitRepository", value: { url: "https://github.com/acme/web.git" } } },
        ],
        plugins: [{ org: "org_acme", slug: "linear", kind: 58 }],
      },
    });

    expect(followUpFieldsOf(session.spec)).toEqual({
      resources: [
        {
          name: "backend",
          gitRepository: { url: "https://github.com/acme/api.git", branch: "main", commit: "4f2a9c1e", writeBackMode: BRANCH_AND_PR },
        },
        { name: "site", localPath: { path: "/Users/dev/site" } },
        { name: "web", gitRepository: { url: "https://github.com/acme/web.git" } },
      ],
      plugins: [{ org: "org_acme", slug: "linear", kind: 58 }],
      skillRefs: [],
    });
  });

  it("reads a conversation with no spec as empty fields", () => {
    expect(followUpFieldsOf(undefined)).toEqual({ resources: [], plugins: [], skillRefs: [] });
  });
});

describe("sameResources", () => {
  const repo = { name: "backend", gitRepository: { url: "https://github.com/acme/api.git", branch: "main" } };

  it("equals an unset field with an empty one and ignores tokens", () => {
    expect(
      sameResources(
        [{ ...repo, gitRepository: { ...repo.gitRepository, commit: undefined, writeBackMode: undefined } }],
        [{ ...repo, gitRepository: { ...repo.gitRepository, commit: "", writeBackMode: 0, token: "***REDACTED***" } }],
      ),
    ).toBe(true);
  });

  it("tells a changed commit, write-back mode, name or path apart", () => {
    expect(sameResources([repo], [{ ...repo, gitRepository: { ...repo.gitRepository, commit: "4f2a9c1e" } }])).toBe(false);
    expect(sameResources([repo], [{ ...repo, gitRepository: { ...repo.gitRepository, writeBackMode: BRANCH_AND_PR } }])).toBe(false);
    expect(sameResources([repo], [{ ...repo, name: "api" }])).toBe(false);
    expect(
      sameResources([{ name: "site", localPath: { path: "/a" } }], [{ name: "site", localPath: { path: "/b" } }]),
    ).toBe(false);
    expect(sameResources([repo], [{ name: "backend", localPath: { path: "/a" } }])).toBe(false);
  });

  it("compares a File by its id and mount path", () => {
    const brief = { name: "brief", file: { fileId: "file_brief" } };
    expect(sameResources([brief], [{ ...brief, file: { fileId: "file_brief", mountPath: "" } }])).toBe(true);
    expect(sameResources([brief], [{ ...brief, file: { fileId: "file_other" } }])).toBe(false);
    expect(sameResources([brief], [{ ...brief, file: { fileId: "file_brief", mountPath: "docs" } }])).toBe(false);
  });

  it("counts order and length", () => {
    const folder = { name: "site", localPath: { path: "/Users/dev/site" } };
    expect(sameResources([repo, folder], [folder, repo])).toBe(false);
    expect(sameResources([repo], [repo, folder])).toBe(false);
    expect(sameResources([], [])).toBe(true);
  });
});

describe("sameRefs", () => {
  it("ignores kind and equals an unset id or version with an empty one", () => {
    expect(
      sameRefs([{ org: "org_acme", slug: "linear" }], [{ org: "org_acme", slug: "linear", id: "", version: "", kind: 58 }]),
    ).toBe(true);
  });

  it("tells a changed version, id or order apart", () => {
    const linear = { org: "org_acme", slug: "linear" };
    const triage = { org: "org_acme", slug: "triage" };
    expect(sameRefs([linear], [{ ...linear, version: "v2" }])).toBe(false);
    expect(sameRefs([linear], [{ ...linear, id: "plg_1" }])).toBe(false);
    expect(sameRefs([linear, triage], [triage, linear])).toBe(false);
    expect(sameRefs([linear], [])).toBe(false);
  });
});
