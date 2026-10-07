/**
 * The one rule that decides which values a run receives
 * (domain/credential/resolve.ts), over a real store holding the
 * organization's credentials and an Authorizer this file answers per
 * (principal, permission, credential), so every `can_use` the rule asks is
 * visible and every answer is chosen here.
 *
 * What it pins, in the order of the module header:
 *   - per call: `runtime_env` beats every other source, and a key it
 *     carries that nothing declares never reaches the run;
 *   - the default account: a member's run takes their OWN sign-in for a
 *     personal-sign-in MCP server, never a teammate's; an organization's
 *     credential reaches a member's run for an agent only when the member
 *     holds `can_use` on it, and a member's own serving credential wins
 *     over it; an MCP server with organization sign-in takes the
 *     organization's credential with no `can_use` asked;
 *   - the surface: a run with no person reaches no personal credential
 *     and no organization default, only the assignments on the surface
 *     that started it; an assignment whose writer may no longer use its
 *     credential, that names a credential that is gone, or a field the
 *     credential lacks refuses naming the assignment; a literal delivers
 *     its value;
 *   - missing values: a required key nothing provides refuses naming the
 *     key, an optional one is absent, and a required key another
 *     declarer's requirement provided is not missing;
 *   - one value per key: two declarers resolving one key to different
 *     values refuse naming both; the same value is no conflict;
 *   - a sign-in is freshened before its field is read, once per run
 *     whichever declarer reads it first, and the fresh value is the one
 *     every declarer receives;
 *   - credentials are read in the run's organization only.
 *
 * Every refusal is FailedPrecondition: the create fails naming what to
 * fix, rather than a run starting without what it needs.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type {
  CredentialAssignment,
  CredentialTarget,
} from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialAssignmentSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/requirement_pb";
import { CredentialFieldSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  EncryptionScope,
  SecretService,
} from "../../../encryption/encryption.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { credentialListIndex } from "../list-index.js";
import type {
  CredentialResolverDeps,
  Declarer,
  Requirement,
  ResolveInput,
  RunSurface,
  SignInFreshener,
} from "../resolve.js";
import {
  declarerTarget,
  GIT_TOKEN_KEY,
  resolveCredentials,
} from "../resolve.js";
import { CredentialValues } from "../values.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const secrets = SecretService.create(randomBytes(32));

const ANA = "acc_ana";
const BEN = "acc_ben";

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "credential-resolve-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: [credentialListIndex],
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fresh organization per test, so no test reads another's credentials. */
let orgCounter = 0;
function freshOrg(): string {
  orgCounter += 1;
  return `acme-${orgCounter}`;
}

// ---------------------------------------------------------------------------
// Declarers and requirements.
// ---------------------------------------------------------------------------

function agentDeclarer(org: string, slug = "helper"): Declarer {
  return { kind: "agent", org, slug };
}

function serverDeclarer(
  org: string,
  slug: string,
  signIn: McpServerSignIn = McpServerSignIn.unspecified,
): Declarer {
  return { kind: "mcp_server", id: `mcps_${slug}`, org, slug, signIn };
}

function gitHostDeclarer(host = "github.com"): Declarer {
  return { kind: "git_host", host };
}

function requirement(
  declarer: Declarer,
  key: string,
  declaration: { isSecret?: boolean; optional?: boolean } = {},
): Requirement {
  return {
    declarer,
    key,
    declaration: {
      isSecret: declaration.isSecret ?? true,
      optional: declaration.optional ?? false,
    },
  };
}

// ---------------------------------------------------------------------------
// Credentials, saved with their secret fields sealed as the domain seals them.
// ---------------------------------------------------------------------------

type Owner = { readonly person: string } | { readonly org: string };

async function saveCredential(init: {
  org: string;
  id: string;
  owner: Owner;
  fields: Record<string, string>;
  serves?: ReadonlyArray<Declarer>;
  signIn?: boolean;
}): Promise<Credential> {
  const fields: Record<string, { value: string }> = {};
  for (const [name, value] of Object.entries(init.fields)) {
    fields[name] = {
      value: await secrets.encrypt(
        value,
        EncryptionScope.forOrganization(init.org),
      ),
    };
  }
  const credential = create(CredentialSchema, {
    metadata: { id: init.id, org: init.org, slug: init.id },
    spec: {
      owner:
        "person" in init.owner
          ? { case: "person", value: init.owner.person }
          : { case: "org", value: init.owner.org },
      fields,
      serves: (init.serves ?? []).map(declarerTarget),
    },
    status: {
      source:
        init.signIn === true ? CredentialSource.oauth : CredentialSource.static,
    },
  });
  await store.saveResource(
    ApiResourceKind.credential,
    init.id,
    CredentialSchema,
    credential,
  );
  return credential;
}

// ---------------------------------------------------------------------------
// The Authorizer, answered here, and the sign-in freshener.
// ---------------------------------------------------------------------------

interface AskedCheck {
  readonly principal: string;
  readonly check: AuthzCheck;
}

/**
 * Allows `can_use` exactly for the "principal|credential id" pairs in
 * `allowed`, denies every other check, and records every check asked.
 */
function authorizerAllowing(allowed: ReadonlyArray<string>): {
  readonly authorizer: Authorizer;
  readonly asked: AskedCheck[];
} {
  const asked: AskedCheck[] = [];
  const authorizer: Authorizer = {
    authorize: async (caller: CallerIdentity, check: AuthzCheck) => {
      asked.push({ principal: caller.identityId, check });
      const permitted =
        check.permission === IamPermission.can_use &&
        check.resourceKind === ApiResourceKind.credential &&
        allowed.includes(`${caller.identityId}|${check.resourceId}`);
      return permitted
        ? { kind: "allow" }
        : { kind: "deny", reason: "not granted" };
    },
  };
  return { authorizer, asked };
}

/** A freshener that must never be reached: no sign-in is read. */
const unreachedFreshener: SignInFreshener = {
  freshen: async () => {
    throw new Error("no sign-in is read in this test");
  },
};

/**
 * A freshener answering each credential with `answer(credential)`
 * (unchanged by default), recording the id of every credential it was
 * asked to freshen.
 */
function recordingFreshener(
  answer: (credential: Credential) => Credential = (credential) => credential,
): {
  readonly freshener: SignInFreshener;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    freshener: {
      freshen: async (credential) => {
        asked.push(credential.metadata?.id ?? "");
        return answer(credential);
      },
    },
  };
}

/** `saved` as a refresh re-reads it: `field` holding `value`, sealed. */
async function refreshedCredential(
  saved: Credential,
  field: string,
  value: string,
): Promise<Credential> {
  const refreshed = clone(CredentialSchema, saved);
  const fields = refreshed.spec?.fields ?? {};
  fields[field] = create(CredentialFieldSchema, {
    value: await secrets.encrypt(
      value,
      EncryptionScope.forOrganization(saved.metadata?.org ?? ""),
    ),
  });
  return refreshed;
}

function resolverDeps(
  authorizer: Authorizer,
  signIns: SignInFreshener = unreachedFreshener,
): CredentialResolverDeps {
  return {
    store,
    logger: silentLogger,
    authorizer,
    values: new CredentialValues(secrets, silentLogger),
    signIns,
  };
}

function resolveInput(init: {
  org: string;
  person?: string;
  runtimeEnv?: Record<string, string>;
  surface?: RunSurface;
  requirements: ReadonlyArray<Requirement>;
}): ResolveInput {
  const runtimeEnv: { [key: string]: ExecutionValue } = {};
  for (const [key, value] of Object.entries(init.runtimeEnv ?? {})) {
    runtimeEnv[key] = create(ExecutionValueSchema, { value, isSecret: true });
  }
  return {
    runId: "run_test",
    org: init.org,
    person: init.person,
    runtimeEnv,
    surface: init.surface,
    requirements: init.requirements,
  };
}

/** The delivered values as a plain key → value record. */
function plain(values: Map<string, ExecutionValue>): Record<string, string> {
  return Object.fromEntries([...values].map(([key, v]) => [key, v.value]));
}

/** The FailedPrecondition a resolve refuses with. */
async function refusalOf(promise: Promise<unknown>): Promise<ConnectError> {
  const failure = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ConnectError);
  const refusal = failure as ConnectError;
  expect(refusal.code).toBe(Code.FailedPrecondition);
  return refusal;
}

function credentialAssignment(init: {
  declarer: Declarer;
  key: string;
  credentialOrg?: string;
  credentialSlug?: string;
  field?: string;
  literal?: string;
  writer?: string;
}): CredentialAssignment {
  const declarer: CredentialTarget = declarerTarget(init.declarer);
  return create(CredentialAssignmentSchema, {
    requirement: { declarer, key: init.key },
    source:
      init.literal !== undefined
        ? { case: "literal", value: init.literal }
        : {
            case: "credential",
            value: {
              credential: {
                kind: ApiResourceKind.credential,
                org: init.credentialOrg ?? "",
                slug: init.credentialSlug ?? "",
              },
              field: init.field ?? "",
            },
          },
    writer: init.writer ?? "",
  });
}

function scheduleSurface(
  assignments: ReadonlyArray<CredentialAssignment>,
): RunSurface {
  return { noun: "schedule", id: "sch_nightly", assignments };
}

// ---------------------------------------------------------------------------

describe("per call", () => {
  it("runtime_env wins over the person's own credential and the organization's", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_ana_key",
      owner: { person: ANA },
      fields: { API_KEY: "ana-key" },
      serves: [agent],
    });
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { API_KEY: "team-key" },
      serves: [agent],
    });
    const { authorizer } = authorizerAllowing([`${ANA}|cred_team_key`]);

    const values = await resolveCredentials(
      resolverDeps(authorizer),
      resolveInput({
        org,
        person: ANA,
        runtimeEnv: { API_KEY: "per-call" },
        requirements: [requirement(agent, "API_KEY")],
      }),
    );

    expect(plain(values)).toEqual({ API_KEY: "per-call" });
  });

  it("runtime_env wins over a surface assignment", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer),
      resolveInput({
        org,
        runtimeEnv: { API_KEY: "per-call" },
        surface: scheduleSurface([
          credentialAssignment({
            declarer: agent,
            key: "API_KEY",
            literal: "assigned",
          }),
        ]),
        requirements: [requirement(agent, "API_KEY")],
      }),
    );

    expect(plain(values)).toEqual({ API_KEY: "per-call" });
  });

  it("drops a runtime_env key nothing declares", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer),
      resolveInput({
        org,
        person: ANA,
        runtimeEnv: { API_KEY: "declared", STRAY: "nobody-asked" },
        requirements: [requirement(agent, "API_KEY")],
      }),
    );

    expect(plain(values)).toEqual({ API_KEY: "declared" });
    expect(values.get("API_KEY")?.isSecret).toBe(true);
  });
});

describe("the default account", () => {
  it("a member's run uses their own sign-in for a personal-sign-in server, never a teammate's", async () => {
    const org = freshOrg();
    const notes = serverDeclarer(org, "notes", McpServerSignIn.personal);
    await saveCredential({
      org,
      id: "cred_ana_notes",
      owner: { person: ANA },
      fields: { NOTES_TOKEN: "nt-ana" },
      serves: [notes],
    });
    await saveCredential({
      org,
      id: "cred_ben_notes",
      owner: { person: BEN },
      fields: { NOTES_TOKEN: "nt-ben" },
      serves: [notes],
    });
    const deps = resolverDeps(authorizerAllowing([]).authorizer);
    const requirements = [requirement(notes, "NOTES_TOKEN")];

    const anas = await resolveCredentials(
      deps,
      resolveInput({ org, person: ANA, requirements }),
    );
    const bens = await resolveCredentials(
      deps,
      resolveInput({ org, person: BEN, requirements }),
    );

    expect(plain(anas)).toEqual({ NOTES_TOKEN: "nt-ana" });
    expect(plain(bens)).toEqual({ NOTES_TOKEN: "nt-ben" });
  });

  it("a personal-sign-in server never takes the organization's credential, even one the member may use", async () => {
    const org = freshOrg();
    const notes = serverDeclarer(org, "notes", McpServerSignIn.personal);
    await saveCredential({
      org,
      id: "cred_team_notes",
      owner: { org },
      fields: { NOTES_TOKEN: "nt-team" },
      serves: [notes],
    });
    const { authorizer } = authorizerAllowing([`${ANA}|cred_team_notes`]);

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizer),
        resolveInput({
          org,
          person: ANA,
          requirements: [requirement(notes, "NOTES_TOKEN")],
        }),
      ),
    );

    expect(refusal.rawMessage).toContain(
      "MCP server 'notes' needs NOTES_TOKEN, and you have not signed in to it",
    );
  });

  it("an organization credential serving an agent reaches a member's run only when the member holds can_use", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { API_KEY: "team-key" },
      serves: [agent],
    });
    const { authorizer, asked } = authorizerAllowing([`${ANA}|cred_team_key`]);
    const deps = resolverDeps(authorizer);
    const requirements = [requirement(agent, "API_KEY")];

    const anas = await resolveCredentials(
      deps,
      resolveInput({ org, person: ANA, requirements }),
    );
    expect(plain(anas)).toEqual({ API_KEY: "team-key" });

    const refusal = await refusalOf(
      resolveCredentials(
        deps,
        resolveInput({ org, person: BEN, requirements }),
      ),
    );
    expect(refusal.rawMessage).toContain("agent 'helper' needs API_KEY");
    expect(refusal.rawMessage).not.toContain("team-key");

    expect(
      asked.map((a) => [a.principal, a.check.permission, a.check.resourceId]),
    ).toEqual([
      [ANA, IamPermission.can_use, "cred_team_key"],
      [BEN, IamPermission.can_use, "cred_team_key"],
    ]);
  });

  it("a member's own serving credential wins over the organization's, with no can_use asked", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { API_KEY: "team-key" },
      serves: [agent],
    });
    await saveCredential({
      org,
      id: "cred_ana_key",
      owner: { person: ANA },
      fields: { API_KEY: "ana-key" },
      serves: [agent],
    });
    const { authorizer, asked } = authorizerAllowing([`${ANA}|cred_team_key`]);

    const values = await resolveCredentials(
      resolverDeps(authorizer),
      resolveInput({
        org,
        person: ANA,
        requirements: [requirement(agent, "API_KEY")],
      }),
    );

    expect(plain(values)).toEqual({ API_KEY: "ana-key" });
    expect(asked).toEqual([]);
  });

  it("a git host takes the member's own token, then the organization's they may use", async () => {
    const org = freshOrg();
    const github = gitHostDeclarer();
    await saveCredential({
      org,
      id: "cred_team_git",
      owner: { org },
      fields: { [GIT_TOKEN_KEY]: "ghp-team" },
      serves: [github],
    });
    await saveCredential({
      org,
      id: "cred_ben_git",
      owner: { person: BEN },
      fields: { [GIT_TOKEN_KEY]: "ghp-ben" },
      serves: [github],
    });
    const { authorizer } = authorizerAllowing([
      `${ANA}|cred_team_git`,
      `${BEN}|cred_team_git`,
    ]);
    const deps = resolverDeps(authorizer);
    const requirements = [
      requirement(github, GIT_TOKEN_KEY, { optional: true }),
    ];

    expect(
      plain(
        await resolveCredentials(
          deps,
          resolveInput({ org, person: ANA, requirements }),
        ),
      ),
    ).toEqual({
      [GIT_TOKEN_KEY]: "ghp-team",
    });
    expect(
      plain(
        await resolveCredentials(
          deps,
          resolveInput({ org, person: BEN, requirements }),
        ),
      ),
    ).toEqual({
      [GIT_TOKEN_KEY]: "ghp-ben",
    });
  });

  it("an MCP server with organization sign-in uses the organization's credential with no can_use asked", async () => {
    const org = freshOrg();
    const crm = serverDeclarer(org, "crm", McpServerSignIn.organization);
    await saveCredential({
      org,
      id: "cred_team_crm",
      owner: { org },
      fields: { CRM_TOKEN: "crm-team" },
      serves: [crm],
    });
    await saveCredential({
      org,
      id: "cred_ana_crm",
      owner: { person: ANA },
      fields: { CRM_TOKEN: "crm-ana" },
      serves: [crm],
    });
    const { authorizer, asked } = authorizerAllowing([]);

    const values = await resolveCredentials(
      resolverDeps(authorizer),
      resolveInput({
        org,
        person: BEN,
        requirements: [requirement(crm, "CRM_TOKEN")],
      }),
    );

    expect(plain(values)).toEqual({ CRM_TOKEN: "crm-team" });
    expect(asked).toEqual([]);
  });

  it("an organization sign-in nobody made refuses, telling an admin to sign it in", async () => {
    const org = freshOrg();
    const crm = serverDeclarer(org, "crm", McpServerSignIn.organization);

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          person: ANA,
          requirements: [requirement(crm, "CRM_TOKEN")],
        }),
      ),
    );

    expect(refusal.rawMessage).toContain(
      "MCP server 'crm' needs CRM_TOKEN from the organization's sign-in, and the organization has not signed in",
    );
  });
});

describe("a run with no person", () => {
  it("reaches no personal credential and no organization default, only the surface's assignments", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    const notes = serverDeclarer(org, "notes", McpServerSignIn.personal);
    const crm = serverDeclarer(org, "crm", McpServerSignIn.organization);
    await saveCredential({
      org,
      id: "cred_ana_key",
      owner: { person: ANA },
      fields: { API_KEY: "ana-key", NOTES_TOKEN: "nt-ana" },
      serves: [agent, notes],
    });
    await saveCredential({
      org,
      id: "cred_team_all",
      owner: { org },
      fields: { API_KEY: "team-key", CRM_TOKEN: "crm-team" },
      serves: [agent, crm],
    });
    const { authorizer, asked } = authorizerAllowing([`${ANA}|cred_team_all`]);

    const values = await resolveCredentials(
      resolverDeps(authorizer),
      resolveInput({
        org,
        surface: scheduleSurface([
          credentialAssignment({
            declarer: agent,
            key: "API_KEY",
            literal: "assigned-key",
          }),
        ]),
        requirements: [
          requirement(agent, "API_KEY"),
          requirement(notes, "NOTES_TOKEN", { optional: true }),
          requirement(crm, "CRM_TOKEN", { optional: true }),
        ],
      }),
    );

    expect(plain(values)).toEqual({ API_KEY: "assigned-key" });
    expect(asked).toEqual([]);
  });

  it("refuses a required key its surface does not assign, naming the surface", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { API_KEY: "team-key" },
      serves: [agent],
    });

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          surface: scheduleSurface([]),
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toBe(
      "this run cannot start: agent 'helper' needs API_KEY, and a run with no person behind it uses only what is assigned on the schedule that started it: assign API_KEY there",
    );
  });

  it("an assignment delivers its credential's field while its writer may still use it", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { PROD_KEY: "prod-key" },
    });
    const { authorizer, asked } = authorizerAllowing([`${ANA}|cred_team_key`]);

    const values = await resolveCredentials(
      resolverDeps(authorizer),
      resolveInput({
        org,
        surface: scheduleSurface([
          credentialAssignment({
            declarer: agent,
            key: "API_KEY",
            credentialOrg: org,
            credentialSlug: "cred_team_key",
            field: "PROD_KEY",
            writer: ANA,
          }),
        ]),
        requirements: [requirement(agent, "API_KEY")],
      }),
    );

    expect(plain(values)).toEqual({ API_KEY: "prod-key" });
    expect(
      asked.map((a) => [a.principal, a.check.permission, a.check.resourceId]),
    ).toEqual([[ANA, IamPermission.can_use, "cred_team_key"]]);
  });

  it("an assignment with no field reads the field named by the key", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { API_KEY: "by-key" },
    });
    const { authorizer } = authorizerAllowing([`${ANA}|cred_team_key`]);

    const values = await resolveCredentials(
      resolverDeps(authorizer),
      resolveInput({
        org,
        surface: scheduleSurface([
          credentialAssignment({
            declarer: agent,
            key: "API_KEY",
            credentialOrg: org,
            credentialSlug: "cred_team_key",
            writer: ANA,
          }),
        ]),
        requirements: [requirement(agent, "API_KEY")],
      }),
    );

    expect(plain(values)).toEqual({ API_KEY: "by-key" });
  });

  it("refuses an assignment whose writer may no longer use its credential, naming the assignment", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { API_KEY: "team-key" },
    });

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          surface: scheduleSurface([
            credentialAssignment({
              declarer: agent,
              key: "API_KEY",
              credentialOrg: org,
              credentialSlug: "cred_team_key",
              writer: BEN,
            }),
          ]),
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toBe(
      "this run cannot start: whoever assigned API_KEY on the schedule (credential 'cred_team_key') may no longer use that credential; reassign it",
    );
    expect(refusal.rawMessage).not.toContain("team-key");
  });

  it("a literal assignment delivers its value", async () => {
    const org = freshOrg();
    const notes = serverDeclarer(org, "notes");

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer),
      resolveInput({
        org,
        surface: {
          noun: "share link",
          id: "shr_1",
          assignments: [
            credentialAssignment({
              declarer: notes,
              key: "NOTES_REGION",
              literal: "eu-west",
            }),
          ],
        },
        requirements: [requirement(notes, "NOTES_REGION", { isSecret: false })],
      }),
    );

    expect(plain(values)).toEqual({ NOTES_REGION: "eu-west" });
    expect(values.get("NOTES_REGION")?.isSecret).toBe(false);
  });

  it("an assignment for another declarer's requirement with the same key does not apply", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    const notes = serverDeclarer(org, "notes");

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          surface: scheduleSurface([
            credentialAssignment({
              declarer: notes,
              key: "API_KEY",
              literal: "for-notes",
            }),
          ]),
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toContain("agent 'helper' needs API_KEY");
  });

  it("refuses an assignment naming a credential that is gone", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          surface: scheduleSurface([
            credentialAssignment({
              declarer: agent,
              key: "API_KEY",
              credentialOrg: org,
              credentialSlug: "deleted-key",
              writer: ANA,
            }),
          ]),
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toBe(
      "this run cannot start: the credential assigned for API_KEY on the schedule (credential 'deleted-key') no longer exists in this organization",
    );
  });

  it("refuses an assignment naming a field its credential lacks", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org,
      id: "cred_team_key",
      owner: { org },
      fields: { OTHER: "other" },
    });
    const { authorizer } = authorizerAllowing([`${ANA}|cred_team_key`]);

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizer),
        resolveInput({
          org,
          surface: scheduleSurface([
            credentialAssignment({
              declarer: agent,
              key: "API_KEY",
              credentialOrg: org,
              credentialSlug: "cred_team_key",
              field: "PROD_KEY",
              writer: ANA,
            }),
          ]),
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toBe(
      "this run cannot start: the credential assigned for API_KEY on the schedule (credential 'cred_team_key') has no field PROD_KEY",
    );
  });
});

describe("missing values", () => {
  it("refuses a required key with no source, naming the key", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          person: ANA,
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toBe(
      "this run cannot start: agent 'helper' needs API_KEY: save a credential of yours that serves it, or ask an admin to let you use the organization's",
    );
  });

  it("leaves an optional key with no source absent", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer),
      resolveInput({
        org,
        person: ANA,
        requirements: [
          requirement(agent, "OPTIONAL_KEY", { optional: true }),
          requirement(gitHostDeclarer(), GIT_TOKEN_KEY, { optional: true }),
        ],
      }),
    );

    expect(values.size).toBe(0);
  });

  it("a required key another declarer's requirement provided is not missing", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    const search = serverDeclarer(org, "search");
    await saveCredential({
      org,
      id: "cred_ana_search",
      owner: { person: ANA },
      fields: { SEARCH_KEY: "sk-ana" },
      serves: [search],
    });

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer),
      resolveInput({
        org,
        person: ANA,
        requirements: [
          requirement(agent, "SEARCH_KEY"),
          requirement(search, "SEARCH_KEY"),
        ],
      }),
    );

    expect(plain(values)).toEqual({ SEARCH_KEY: "sk-ana" });
  });

  it("names every declarer still needing a missing key, and every missing key", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    const search = serverDeclarer(org, "search");

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          person: ANA,
          requirements: [
            requirement(agent, "SEARCH_KEY"),
            requirement(search, "SEARCH_KEY"),
            requirement(agent, "API_KEY"),
          ],
        }),
      ),
    );

    expect(refusal.rawMessage).toContain(
      "agent 'helper' and MCP server 'search' needs SEARCH_KEY",
    );
    expect(refusal.rawMessage).toContain("agent 'helper' needs API_KEY");
  });
});

describe("one value per key", () => {
  it("refuses two declarers resolving one key to different values, naming both", async () => {
    const org = freshOrg();
    const agent = agentDeclarer(org);
    const search = serverDeclarer(org, "search");
    await saveCredential({
      org,
      id: "cred_ana_agent",
      owner: { person: ANA },
      fields: { SEARCH_KEY: "sk-for-agent" },
      serves: [agent],
    });
    await saveCredential({
      org,
      id: "cred_ana_search",
      owner: { person: ANA },
      fields: { SEARCH_KEY: "sk-for-search" },
      serves: [search],
    });

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer),
        resolveInput({
          org,
          person: ANA,
          requirements: [
            requirement(agent, "SEARCH_KEY"),
            requirement(search, "SEARCH_KEY"),
          ],
        }),
      ),
    );

    expect(refusal.rawMessage).toBe(
      "this run cannot start: SEARCH_KEY resolves to different values for agent 'helper' and MCP server 'search'; a run receives one value per key, so give both the same credential, or set SEARCH_KEY for the run",
    );
    expect(refusal.rawMessage).not.toContain("sk-for");
  });

  it("one sign-in serving both the GitHub MCP server and github.com is one value, not a conflict", async () => {
    const org = freshOrg();
    const githubServer = serverDeclarer(
      org,
      "github",
      McpServerSignIn.personal,
    );
    const githubHost = gitHostDeclarer("github.com");
    await saveCredential({
      org,
      id: "cred_ana_github",
      owner: { person: ANA },
      fields: { [GIT_TOKEN_KEY]: "ghp-ana" },
      serves: [githubServer, githubHost],
      signIn: true,
    });
    const { freshener, asked } = recordingFreshener();

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer, freshener),
      resolveInput({
        org,
        person: ANA,
        requirements: [
          requirement(githubServer, GIT_TOKEN_KEY),
          requirement(githubHost, GIT_TOKEN_KEY, { optional: true }),
        ],
      }),
    );

    expect(plain(values)).toEqual({ [GIT_TOKEN_KEY]: "ghp-ana" });
    expect(asked).toEqual(["cred_ana_github"]);
  });

  it("a sign-in serving a server and a git host is freshened once, and both read the fresh value whichever comes first", async () => {
    const org = freshOrg();
    const githubServer = serverDeclarer(
      org,
      "github",
      McpServerSignIn.personal,
    );
    const githubHost = gitHostDeclarer("github.com");
    const saved = await saveCredential({
      org,
      id: "cred_ana_github",
      owner: { person: ANA },
      fields: { [GIT_TOKEN_KEY]: "ghp-expired" },
      serves: [githubServer, githubHost],
      signIn: true,
    });
    const fresh = await refreshedCredential(saved, GIT_TOKEN_KEY, "ghp-fresh");
    const { freshener, asked } = recordingFreshener(() => fresh);

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer, freshener),
      resolveInput({
        org,
        person: ANA,
        // The git host's requirement is resolved first: a stale read
        // there would disagree with the server's fresh one.
        requirements: [
          requirement(githubHost, GIT_TOKEN_KEY, { optional: true }),
          requirement(githubServer, GIT_TOKEN_KEY),
        ],
      }),
    );

    expect(plain(values)).toEqual({ [GIT_TOKEN_KEY]: "ghp-fresh" });
    expect(asked).toEqual(["cred_ana_github"]);
  });
});

describe("sign-ins", () => {
  it("freshens a sign-in before reading its field, and delivers the fresh value", async () => {
    const org = freshOrg();
    const notes = serverDeclarer(org, "notes", McpServerSignIn.personal);
    const saved = await saveCredential({
      org,
      id: "cred_ana_notes",
      owner: { person: ANA },
      fields: { NOTES_TOKEN: "nt-expired" },
      serves: [notes],
      signIn: true,
    });
    const refreshed = await refreshedCredential(
      saved,
      "NOTES_TOKEN",
      "nt-fresh",
    );
    const { freshener, asked } = recordingFreshener(() => refreshed);

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer, freshener),
      resolveInput({
        org,
        person: ANA,
        requirements: [requirement(notes, "NOTES_TOKEN")],
      }),
    );

    expect(asked).toEqual(["cred_ana_notes"]);
    expect(plain(values)).toEqual({ NOTES_TOKEN: "nt-fresh" });
  });

  it("a sign-in that cannot be renewed refuses the run with the freshener's refusal", async () => {
    const org = freshOrg();
    const notes = serverDeclarer(org, "notes", McpServerSignIn.personal);
    await saveCredential({
      org,
      id: "cred_ana_notes",
      owner: { person: ANA },
      fields: { NOTES_TOKEN: "nt-expired" },
      serves: [notes],
      signIn: true,
    });
    const freshener: SignInFreshener = {
      freshen: async () => {
        throw new ConnectError(
          "sign in to notes again",
          Code.FailedPrecondition,
        );
      },
    };

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizerAllowing([]).authorizer, freshener),
        resolveInput({
          org,
          person: ANA,
          requirements: [requirement(notes, "NOTES_TOKEN")],
        }),
      ),
    );

    expect(refusal.rawMessage).toBe("sign in to notes again");
  });

  it("a credential typed by hand is never sent to the freshener", async () => {
    const org = freshOrg();
    const notes = serverDeclarer(org, "notes", McpServerSignIn.personal);
    await saveCredential({
      org,
      id: "cred_ana_notes",
      owner: { person: ANA },
      fields: { NOTES_TOKEN: "nt-typed" },
      serves: [notes],
    });

    const values = await resolveCredentials(
      resolverDeps(authorizerAllowing([]).authorizer, unreachedFreshener),
      resolveInput({
        org,
        person: ANA,
        requirements: [requirement(notes, "NOTES_TOKEN")],
      }),
    );

    expect(plain(values)).toEqual({ NOTES_TOKEN: "nt-typed" });
  });
});

describe("organizations", () => {
  it("never reads a credential of another organization: not the person's own, not that organization's", async () => {
    const org = freshOrg();
    const other = freshOrg();
    const agent = agentDeclarer(org);
    // Ana's own and the other organization's credentials, saved there,
    // each naming this organization's agent as what they serve.
    await saveCredential({
      org: other,
      id: "cred_ana_elsewhere",
      owner: { person: ANA },
      fields: { API_KEY: "ana-elsewhere" },
      serves: [agent],
    });
    await saveCredential({
      org: other,
      id: "cred_other_team",
      owner: { org: other },
      fields: { API_KEY: "other-team" },
      serves: [agent],
    });
    const { authorizer, asked } = authorizerAllowing([
      `${ANA}|cred_other_team`,
    ]);

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizer),
        resolveInput({
          org,
          person: ANA,
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toContain("agent 'helper' needs API_KEY");
    expect(asked).toEqual([]);
  });

  it("refuses a surface assignment naming another organization's credential as gone", async () => {
    const org = freshOrg();
    const other = freshOrg();
    const agent = agentDeclarer(org);
    await saveCredential({
      org: other,
      id: "cred_other_key",
      owner: { org: other },
      fields: { API_KEY: "other-key" },
    });
    const { authorizer, asked } = authorizerAllowing([`${ANA}|cred_other_key`]);

    const refusal = await refusalOf(
      resolveCredentials(
        resolverDeps(authorizer),
        resolveInput({
          org,
          surface: scheduleSurface([
            credentialAssignment({
              declarer: agent,
              key: "API_KEY",
              credentialOrg: other,
              credentialSlug: "cred_other_key",
              writer: ANA,
            }),
          ]),
          requirements: [requirement(agent, "API_KEY")],
        }),
      ),
    );

    expect(refusal.rawMessage).toContain(
      "no longer exists in this organization",
    );
    expect(asked).toEqual([]);
  });
});
