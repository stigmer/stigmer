// Unit tests for the `credential` operations and `connect mcp-server --save`.
//
// What they pin:
//   - the value flags: `--field` is a secret, `--plain` is plain, `--from-env`
//     reads the caller's shell (and refuses an unset variable naming it), a
//     key given twice or a malformed name is a usage error, never a silent
//     winner;
//   - `--serves` spellings for the three targets, with an org-less reference
//     left empty for the server to fill, and a bad target refused;
//   - create sends the owner arm the flags ask for: the `person` arm, empty,
//     by default (the server reads it as the caller), the `org` arm for
//     `--org-owned`; the owner is never sent anywhere else;
//   - set-fields, remove-fields and reveal resolve the credential by slug,
//     org/slug or id and address the RPC by its id;
//   - `--save` sets fields on the caller's own credential that already
//     serves the server, creates one serving it otherwise (an organization
//     credential serving it is never written), keeps a declared-plain value
//     plain, and refuses a server whose sign-in is the organization's.
// The port is a double recording what it was asked.

import { clone, create } from "@bufbuild/protobuf";
import {
  type Credential,
  CredentialSchema,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import {
  CredentialListSchema,
  type RemoveCredentialFieldsInput,
  type RevealCredentialFieldInput,
  type SetCredentialFieldsInput,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/io_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialFieldSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { classify, ExitCode, UsageError } from "../../errors/index.js";
import {
  type CredentialApi,
  createCredential,
  credentialToCreate,
  parseFieldFlags,
  parseServesTarget,
  removeCredentialFields,
  revealCredentialField,
  saveConnectCredential,
  setCredentialFields,
} from "../credential.js";

const NO_FLAGS = { field: [], plain: [], fromEnv: [] };

function usage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    expect(classify(err)?.exitCode).toBe(ExitCode.Usage);
    return (err as Error).message;
  }
  throw new Error("expected a usage error");
}

/** A port double holding `stored`, recording every call. */
function double(stored: Credential[] = []) {
  const calls = {
    create: [] as Credential[],
    get: [] as string[],
    getByReference: [] as { org: string; slug: string }[],
    setFields: [] as SetCredentialFieldsInput[],
    removeFields: [] as RemoveCredentialFieldsInput[],
    revealField: [] as RevealCredentialFieldInput[],
    listOrgs: [] as string[],
  };
  const byId = (id: string) => stored.find((c) => c.metadata?.id === id) ?? stored[0];
  const api: CredentialApi = {
    create: async (credential) => {
      calls.create.push(credential);
      const saved = clone(CredentialSchema, credential);
      if (saved.metadata !== undefined) {
        saved.metadata.id = "cred_new";
        saved.metadata.slug = "new-1a2b";
      }
      return saved;
    },
    get: async (id) => {
      calls.get.push(id);
      return byId(id);
    },
    getByReference: async (ref) => {
      calls.getByReference.push(ref);
      return stored.find((c) => c.metadata?.slug === ref.slug) ?? stored[0];
    },
    setFields: async (input) => {
      calls.setFields.push(input);
      return byId(input.credentialId);
    },
    removeFields: async (input) => {
      calls.removeFields.push(input);
      return byId(input.credentialId);
    },
    revealField: async (input) => {
      calls.revealField.push(input);
      return create(CredentialFieldSchema, { value: "sk-live-123" });
    },
    list: async (input) => {
      calls.listOrgs.push(input.org);
      return create(CredentialListSchema, { totalCount: stored.length, items: stored });
    },
  };
  return { api, calls };
}

const openai = create(CredentialSchema, {
  metadata: { id: "cred_1", slug: "openai-9c1d", name: "OpenAI", org: "acme" },
  spec: {
    owner: { case: "person", value: "ida_1" },
    fields: { OPENAI_API_KEY: { value: "***REDACTED***" } },
  },
});

describe("value flags", () => {
  it("reads --field as a secret, --plain as plain, and --from-env from the shell as a secret", () => {
    const fields = parseFieldFlags(
      { field: ["API_KEY=abc=def"], plain: ["REGION=eu-west-1"], fromEnv: ["TOKEN"] },
      { TOKEN: "from-shell" },
    );
    expect(fields.API_KEY).toMatchObject({ value: "abc=def", plain: false });
    expect(fields.REGION).toMatchObject({ value: "eu-west-1", plain: true });
    expect(fields.TOKEN).toMatchObject({ value: "from-shell", plain: false });
  });

  it("refuses --from-env for a variable the shell does not set, naming it", () => {
    const message = usage(() => parseFieldFlags({ ...NO_FLAGS, fromEnv: ["MISSING_KEY"] }, {}));
    expect(message).toContain("MISSING_KEY is not set");
  });

  it("refuses a key given twice rather than letting one source win", () => {
    const message = usage(() =>
      parseFieldFlags({ field: ["KEY=a"], plain: ["KEY=b"], fromEnv: [] }, {}),
    );
    expect(message).toContain("KEY is given more than once");
  });

  it("refuses an assignment with no = and a name the contract does not allow", () => {
    expect(usage(() => parseFieldFlags({ ...NO_FLAGS, field: ["KEY"] }, {}))).toContain(
      "expected KEY=VALUE",
    );
    expect(usage(() => parseFieldFlags({ ...NO_FLAGS, field: ["1KEY=x"] }, {}))).toContain(
      "invalid field name '1KEY'",
    );
  });
});

describe("--serves", () => {
  it("parses the three targets, leaving an org-less reference for the server to fill", () => {
    expect(parseServesTarget("agent:incident-agent").target).toEqual({
      case: "agent",
      value: expect.objectContaining({ org: "", slug: "incident-agent", kind: ApiResourceKind.agent }),
    });
    expect(parseServesTarget("mcp-server:acme/linear").target).toEqual({
      case: "mcpServer",
      value: expect.objectContaining({ org: "acme", slug: "linear", kind: ApiResourceKind.mcp_server }),
    });
    expect(parseServesTarget("git-host:GitHub.com").target).toEqual({
      case: "gitHost",
      value: "github.com",
    });
  });

  it("refuses an unknown target kind and a host that is not one", () => {
    expect(usage(() => parseServesTarget("skill:x"))).toContain(
      "an agent, an MCP server or a git host",
    );
    expect(usage(() => parseServesTarget("git-host:localhost"))).toContain("is not a host name");
    expect(usage(() => parseServesTarget("agent"))).toContain("expected agent:<slug>");
  });
});

describe("create", () => {
  const options = {
    name: "OpenAI",
    orgOwned: false,
    description: "my key",
    serves: ["agent:helper"],
    field: ["OPENAI_API_KEY=sk-1"],
    plain: [],
    fromEnv: [],
  };

  it("asks for the caller's own credential by default: the person arm, empty", () => {
    const credential = credentialToCreate(options, "acme", {});
    expect(credential.kind).toBe("Credential");
    expect(credential.metadata).toMatchObject({ name: "OpenAI", org: "acme" });
    expect(credential.spec?.owner).toEqual({ case: "person", value: "" });
    expect(credential.spec?.description).toBe("my key");
    expect(Object.keys(credential.spec?.fields ?? {})).toEqual(["OPENAI_API_KEY"]);
    expect(credential.spec?.serves).toHaveLength(1);
  });

  it("asks for the organization's credential with --org-owned: the org arm, empty", () => {
    const credential = credentialToCreate({ ...options, orgOwned: true }, "acme", {});
    expect(credential.spec?.owner).toEqual({ case: "org", value: "" });
  });

  it("refuses an empty name", () => {
    expect(usage(() => credentialToCreate({ ...options, name: "  " }, "acme", {}))).toContain(
      "needs a name",
    );
  });

  it("describes what it created, never a value", async () => {
    const { api, calls } = double();
    const result = await createCredential(api, options, "acme");
    expect(calls.create).toHaveLength(1);
    expect(result.message).toBe("Credential 'OpenAI' created");
    const fields = result.sections[0].fields;
    expect(fields).toContainEqual({ key: "Owner", value: "you" });
    expect(fields).toContainEqual({ key: "Fields", value: "OPENAI_API_KEY" });
    expect(fields).toContainEqual({ key: "Serves", value: "agent:helper" });
    expect(JSON.stringify(result)).not.toContain("sk-1");
  });
});

describe("set-fields, remove-fields, reveal", () => {
  it("sets fields by the credential's id after resolving its slug", async () => {
    const { api, calls } = double([openai]);
    const result = await setCredentialFields(
      api,
      "openai-9c1d",
      { ...NO_FLAGS, field: ["OPENAI_ORG=org-1"] },
      "acme",
    );
    expect(calls.getByReference).toEqual([{ org: "acme", slug: "openai-9c1d" }]);
    expect(calls.setFields[0].credentialId).toBe("cred_1");
    expect(Object.keys(calls.setFields[0].fields)).toEqual(["OPENAI_ORG"]);
    expect(result.message).toBe("Set 1 field on credential 'OpenAI'");
  });

  it("refuses set-fields with no field before any call", async () => {
    const { api, calls } = double([openai]);
    await expect(setCredentialFields(api, "openai-9c1d", NO_FLAGS, "acme")).rejects.toBeInstanceOf(
      UsageError,
    );
    expect(calls.getByReference).toHaveLength(0);
  });

  it("removes fields by name and says which the credential did not hold", async () => {
    const { api, calls } = double([openai]);
    const result = await removeCredentialFields(api, "cred_1", ["OPENAI_API_KEY", "NOPE"], "acme");
    expect(calls.get).toEqual(["cred_1"]);
    expect(calls.removeFields[0]).toMatchObject({
      credentialId: "cred_1",
      fields: ["OPENAI_API_KEY", "NOPE"],
    });
    expect(result.hints).toContain("Not on this credential, so nothing to remove: NOPE");
  });

  it("reveals one field of the credential named by org/slug", async () => {
    const { api, calls } = double([openai]);
    const field = await revealCredentialField(api, "acme/openai-9c1d", "OPENAI_API_KEY", "other");
    expect(calls.getByReference).toEqual([{ org: "acme", slug: "openai-9c1d" }]);
    expect(calls.revealField[0]).toMatchObject({ credentialId: "cred_1", field: "OPENAI_API_KEY" });
    expect(field.value).toBe("sk-live-123");
  });
});

describe("connect mcp-server --save", () => {
  const linear = create(McpServerSchema, {
    metadata: { id: "mcp_1", slug: "linear", name: "Linear", org: "org_acme" },
    spec: {
      env: {
        LINEAR_API_KEY: create(EnvVarDeclarationSchema, { isSecret: true }),
        LINEAR_TEAM: create(EnvVarDeclarationSchema, { isSecret: false }),
      },
    },
  });
  function serving(id: string, owner: "person" | "org"): Credential {
    return create(CredentialSchema, {
      metadata: { id, slug: `linear-${id}`, name: "Linear", org: "org_acme" },
      spec: {
        owner: owner === "person" ? { case: "person", value: "ida_1" } : { case: "org", value: "org_acme" },
        serves: [
          {
            target: {
              case: "mcpServer",
              value: { org: "org_acme", slug: "linear", kind: ApiResourceKind.mcp_server },
            },
          },
        ],
      },
    });
  }

  it("sets the fields on the caller's own credential that already serves the server", async () => {
    const { api, calls } = double([serving("cred_org", "org"), serving("cred_mine", "person")]);
    const result = await saveConnectCredential(
      api,
      linear,
      { LINEAR_API_KEY: "lin_1", LINEAR_TEAM: "ENG" },
      "acme",
    );
    expect(calls.listOrgs).toEqual(["acme"]);
    expect(calls.create).toHaveLength(0);
    expect(calls.setFields[0].credentialId).toBe("cred_mine");
    expect(calls.setFields[0].fields.LINEAR_API_KEY).toMatchObject({ value: "lin_1", plain: false });
    expect(calls.setFields[0].fields.LINEAR_TEAM).toMatchObject({ value: "ENG", plain: true });
    expect(result.message).toBe("Saved to your credential 'Linear'");
  });

  it("creates the caller's own credential serving the server when none does", async () => {
    const { api, calls } = double([serving("cred_org", "org")]);
    await saveConnectCredential(api, linear, { LINEAR_API_KEY: "lin_1", UNDECLARED: "x" }, "acme");
    expect(calls.setFields).toHaveLength(0);
    const created = calls.create[0];
    expect(created.metadata).toMatchObject({ name: "Linear", org: "acme" });
    expect(created.spec?.owner).toEqual({ case: "person", value: "" });
    expect(created.spec?.serves[0].target).toEqual({
      case: "mcpServer",
      value: expect.objectContaining({ org: "org_acme", slug: "linear" }),
    });
    // A value the server does not declare is kept secret.
    expect(created.spec?.fields.UNDECLARED).toMatchObject({ plain: false });
  });

  it("refuses a server whose sign-in is the organization's, before any call", async () => {
    const { api, calls } = double();
    const orgSignIn = clone(McpServerSchema, linear);
    if (orgSignIn.spec !== undefined) orgSignIn.spec.signIn = McpServerSignIn.organization;
    await expect(
      saveConnectCredential(api, orgSignIn, { LINEAR_API_KEY: "lin_1" }, "acme"),
    ).rejects.toThrow(/uses one account for the whole organization/);
    expect(calls.listOrgs).toHaveLength(0);
  });
});
