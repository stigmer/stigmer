/**
 * Credential assignments between the stored proto and the input a write
 * sends. Pinned: the writer the server stamped is dropped on the way in
 * and never set on the way out; a credential field equal to the key is
 * the empty field; a literal survives as written; an assignment with no
 * declarer is dropped rather than sent half-formed; `assignmentsForWrite`
 * strips a writer even from input a caller built by hand.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { CredentialAssignmentSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { assignmentInputsOf, assignmentProtoOf } from "../assignments";
import { assignmentsForWrite } from "../CredentialAssignmentsEditor";

const STORED = create(CredentialAssignmentSchema, {
  requirement: {
    declarer: { target: { case: "gitHost", value: "github.com" } },
    key: "GITHUB_TOKEN",
  },
  source: { case: "credential", value: { credential: { org: "org_acme", slug: "bot", kind: ApiResourceKind.credential }, field: "" } },
  writer: "ida_admin",
});

describe("assignments", () => {
  it("reads a stored assignment without its writer", () => {
    const [input] = assignmentInputsOf([STORED, create(CredentialAssignmentSchema, {})]);
    expect(input).toEqual({
      requirement: { declarer: { gitHost: "github.com" }, key: "GITHUB_TOKEN" },
      credential: { credential: { org: "org_acme", slug: "bot" } },
    });
    expect(assignmentInputsOf([create(CredentialAssignmentSchema, {})])).toEqual([]);
  });

  it("builds a proto with no writer, the credential kind stamped, and a literal as written", () => {
    const fromCredential = assignmentProtoOf({
      requirement: { declarer: { agent: { org: "org_acme", slug: "reviewer" } }, key: "API_KEY" },
      credential: { credential: { org: "org_acme", slug: "bot" }, field: "OTHER" },
      writer: "ida_spoofed",
    });
    expect(fromCredential?.writer).toBe("");
    expect(fromCredential?.source).toEqual({
      case: "credential",
      value: expect.objectContaining({
        credential: expect.objectContaining({ slug: "bot", kind: ApiResourceKind.credential }),
        field: "OTHER",
      }),
    });

    const fromLiteral = assignmentProtoOf({
      requirement: { declarer: { gitHost: "github.com" }, key: "REGION" },
      literal: "eu",
    });
    expect(fromLiteral?.source).toEqual({ case: "literal", value: "eu" });
  });

  it("strips a writer from hand-built input before a write", () => {
    const written = assignmentsForWrite([
      {
        requirement: { declarer: { mcpServer: { org: "org_acme", slug: "crm", kind: ApiResourceKind.mcp_server } }, key: "CRM" },
        credential: { credential: { org: "org_acme", slug: "bot" } },
        writer: "ida_spoofed",
      },
    ]);
    expect(written).toEqual([
      {
        requirement: { declarer: { mcpServer: { org: "org_acme", slug: "crm" } }, key: "CRM" },
        credential: { credential: { org: "org_acme", slug: "bot" } },
      },
    ]);
  });
});
