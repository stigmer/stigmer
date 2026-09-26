/**
 * Pins the built-in list read scope on both store drivers as the twin of
 * the cloud's driver (stigmer-cloud iam/list-read-scope.ts): every
 * candidate a list lane offers is answered by `can_view` through the same
 * evaluator the Authorizer uses, over tuples derived from the facts the
 * candidate carries — no candidate row is read twice.
 *
 * The adversarial cells come first, because until slice 5's sibling
 * cells this file and the composed proof are the only proof that a
 * member's list is a member's list: the outsider sees nothing (a row
 * still carrying the retired public level included); the viewer rung sees
 * the org-visible blueprints
 * and nothing personal; the founder — an admin — sees the organization's
 * blueprints and NOT its members' sessions, keys, environments or
 * memories (the model's own line, now list-visible); an execution is its session's and
 * an orphaned execution is nobody's; a run whose instance is
 * org-observable reaches the organization's viewers; a memory with no
 * subject is nobody's; an instance reaches whoever reads its blueprint
 * only when it is the default. Then the contract: a scope only narrows
 * and never reorders; the `internal` class is the in-process skip on the
 * enumeration verb and a loud consumer bug on the restrict verb (the
 * shared helper answers the class before any driver, stigmer#1207); an
 * unprovisioned subject is their raw subject (the 3.14 verifiers' stamp); a
 * fault throws and is never an empty answer; an undeclared kind is a
 * consumer bug, loud; the enumeration verb equals the restrict verb over
 * the whole kind; and the reads are counted — distinct parents, never
 * candidates.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import {
  IAM_POLICY_API_VERSION,
  IAM_POLICY_KIND,
  policyIdFor,
} from "../../domain/iampolicy/constants.js";
import { newResourceIamPolicyStore } from "../../domain/iampolicy/resource-store.js";
import type { IamPolicyStore } from "../../domain/iampolicy/store.js";
import { orgRole } from "../../domain/iampolicy/__tests__/support.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import { silentLogger } from "../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../../extensions/list-read-scope.js";
import {
  InternalCallerOfferedError,
  restrictListByReadScope,
} from "../../extensions/list-read-scope.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { rowAuthorizationFactsOf } from "../../pipeline/steps/authorization-facts.js";
import type { Store } from "../../store/interface.js";
import { AuthorizationEvaluationError } from "../evaluator.js";
import { newBuiltInListReadScope } from "../list-read-scope.js";
import { builtInModel } from "../model/index.js";
import type { KindDeclaration } from "../model/rewrite.js";
import { driverFixtures, dropPostgresFixture } from "./drivers.js";
import type { OpenedStore } from "./drivers.js";
import { fixtureRow, storedDeclaration } from "./support.js";
import type { FixtureRowFacts } from "./support.js";

const FOUNDER = accountIdFor("auth0|founder");
const ADMIN = accountIdFor("auth0|admin");
const MEMBER = accountIdFor("auth0|member");
const VIEWER = accountIdFor("auth0|viewer");
const OUTSIDER = accountIdFor("auth0|outsider");
/** Provisioned, with rows stamped by the 3.14 verifiers' raw subject. */
const LEGACY_SUBJECT = "auth0|legacy";
const LEGACY = accountIdFor(LEGACY_SUBJECT);
/** Never provisioned: the caller is their raw subject and nothing else. */
const FRESH_SUBJECT = "auth0|fresh";

const ORG = "acme";

const SEEDED_KINDS = [
  ApiResourceKind.iam_policy,
  ApiResourceKind.identity_account,
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.session,
  ApiResourceKind.agent_execution,
  ApiResourceKind.workflow_instance,
  ApiResourceKind.workflow_execution,
  ApiResourceKind.memory,
  ApiResourceKind.api_key,
  ApiResourceKind.environment,
  ApiResourceKind.agent_instance,
];

function resolved(accountId: string): CallerIdentity {
  return {
    identityId: accountId,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: "opaque",
  };
}

function idpShaped(subject: string): CallerIdentity {
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString(
    "base64url",
  );
  return {
    identityId: subject,
    callerClass: "user",
    issuer: "https://issuer.example",
    rawToken: `h.${payload}.unsigned`,
  };
}

const INTERNAL: CallerIdentity = {
  identityId: "system",
  callerClass: "internal",
  issuer: "",
  rawToken: "",
  origin: "in-process",
};

/** The candidate a lane's helper would build for a row — the same resolver, plus the labels. */
function entryOf(kind: ApiResourceKind, row: object): ListEntryMeta {
  return {
    ...rowAuthorizationFactsOf(kind, row),
    labels: {},
  };
}

/** A stored row's decoded messages, keyed by id, as the lane holds them after its own predicates. */
type Rows = Map<string, object>;

afterAll(dropPostgresFixture);

describe.each(driverFixtures(SEEDED_KINDS))(
  "the built-in list read scope on $name",
  (fixture) => {
    describe.skipIf(fixture.skip)(
      "restrictListEntries and authorizedResourceIds",
      () => {
        let opened: OpenedStore;
        let policies: IamPolicyStore;
        let accounts: IdentityAccountStore;
        let storeReads: { rows: number; scans: number };
        let accountReads: number;
        const rows = new Map<ApiResourceKind, Rows>();

        async function save(
          type: string,
          facts: FixtureRowFacts,
        ): Promise<void> {
          const declaration = storedDeclaration(type);
          const row = fixtureRow(declaration, facts);
          await opened.store.saveResource(
            declaration.kind,
            facts.id,
            declaration.schema,
            row,
          );
          const held = rows.get(declaration.kind) ?? new Map<string, object>();
          held.set(facts.id, row);
          rows.set(declaration.kind, held);
        }

        function rowsOf(kind: ApiResourceKind): object[] {
          return [...(rows.get(kind)?.values() ?? [])];
        }

        async function grant(spec: ReturnType<typeof orgRole>) {
          await policies.save(
            create(IamPolicySchema, {
              apiVersion: IAM_POLICY_API_VERSION,
              kind: IAM_POLICY_KIND,
              metadata: { id: policyIdFor(spec) },
              spec,
            }),
          );
        }

        /** The store, counting the two reads the scope may make: rows by key, and a scan of a kind. */
        function countingStore(): Store {
          return {
            ...opened.store,
            getResource(kind, id, schema) {
              storeReads.rows += 1;
              return opened.store.getResource(kind, id, schema);
            },
            listResources(kind) {
              storeReads.scans += 1;
              return opened.store.listResources(kind);
            },
          };
        }

        function scope(
          overrides: Partial<
            Parameters<typeof newBuiltInListReadScope>[0]
          > = {},
        ): ListReadScope {
          return newBuiltInListReadScope({
            store: countingStore(),
            policies,
            accounts: {
              findById: (id) => {
                accountReads += 1;
                return accounts.findById(id);
              },
              findDirectByIdpId: (idpId) => {
                accountReads += 1;
                return accounts.findDirectByIdpId(idpId);
              },
            },
            logger: silentLogger,
            ...overrides,
          });
        }

        /** What a lane returns: the rows kept, in the lane's order, through the ONE consumption idiom. */
        async function listAs(
          caller: CallerIdentity,
          kind: ApiResourceKind,
          offered: object[] = rowsOf(kind),
        ): Promise<string[]> {
          const kept = await restrictListByReadScope(
            scope(),
            caller,
            kind,
            offered as Array<{ metadata?: { id?: string } }>,
            "",
          );
          return kept.map((row) => row.metadata?.id ?? "");
        }

        beforeEach(async () => {
          opened = await fixture.open();
          storeReads = { rows: 0, scans: 0 };
          accountReads = 0;
          rows.clear();
          policies = newResourceIamPolicyStore(opened.store);
          accounts = newResourceIdentityAccountStore(opened.store);
          for (const [id, subject] of [
            [FOUNDER, "auth0|founder"],
            [ADMIN, "auth0|admin"],
            [MEMBER, "auth0|member"],
            [VIEWER, "auth0|viewer"],
            [OUTSIDER, "auth0|outsider"],
            [LEGACY, LEGACY_SUBJECT],
          ] as const) {
            await accounts.save(
              create(IdentityAccountSchema, {
                metadata: { id, name: subject },
                spec: {
                  idpId: subject,
                  provisioningMode: IdentityAccountProvisioningMode.direct,
                },
              }),
            );
          }
          await save("organization", {
            id: ORG,
            org: "",
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: FOUNDER,
          });
          await grant(orgRole(FOUNDER, "owner", ORG));
          await grant(orgRole(ADMIN, "admin", ORG));
          await grant(orgRole(MEMBER, "member", ORG));
          await grant(orgRole(VIEWER, "viewer", ORG));

          // Blueprints: the founder's private and org-visible agents, a
          // member's private one, one still carrying the retired public
          // level (a row the store migration has not met, which derives no
          // viewer grant and so reads as its owner's alone), and one
          // stamped by the 3.14 verifiers' raw subject.
          await save("agent", {
            id: "agt_private",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: FOUNDER,
          });
          await save("agent", {
            id: "agt_org",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_org,
            createdBy: FOUNDER,
            status: { defaultInstanceId: "ai_default" },
          });
          await save("agent", {
            id: "agt_member_private",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: MEMBER,
          });
          await save("agent", {
            id: "agt_public",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_public,
            createdBy: FOUNDER,
          });
          await save("agent", {
            id: "agt_legacy",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: LEGACY_SUBJECT,
          });

          // Personal kinds: one row each for the founder and the member.
          for (const [type, prefix] of [
            ["session", "ses"],
            ["api_key", "key"],
            ["environment", "env"],
          ] as const) {
            for (const [who, stamp] of [
              ["founder", FOUNDER],
              ["member", MEMBER],
            ] as const) {
              await save(type, {
                id: `${prefix}_${who}`,
                org: ORG,
                visibility: ApiResourceVisibility.visibility_private,
                createdBy: stamp,
              });
            }
          }

          // Executions: two in the founder's session, one in the member's,
          // one whose session is gone. Stamped by nobody on purpose: an
          // execution's owner is INHERITED, the stamp says nothing.
          for (const [id, session] of [
            ["aex_f1", "ses_founder"],
            ["aex_f2", "ses_founder"],
            ["aex_m1", "ses_member"],
            ["aex_orphan", "ses_gone"],
          ] as const) {
            await save("agent_execution", {
              id,
              org: ORG,
              visibility: ApiResourceVisibility.visibility_private,
              createdBy: "",
              spec: { sessionId: session },
            });
          }

          // Runs: the member's run of an org-observable instance and the
          // founder's run of a private one.
          await save("workflow_instance", {
            id: "wfi_observable",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: MEMBER,
            spec: {
              executionVisibility: WorkflowExecutionVisibility.organization,
            },
          });
          await save("workflow_instance", {
            id: "wfi_private",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: FOUNDER,
            spec: { executionVisibility: WorkflowExecutionVisibility.private },
          });
          await save("workflow_execution", {
            id: "wex_member_observable",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: MEMBER,
            spec: { workflowInstanceId: "wfi_observable" },
          });
          await save("workflow_execution", {
            id: "wex_founder_private",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: FOUNDER,
            spec: { workflowInstanceId: "wfi_private" },
          });

          // Memories: one with no subject (every open-source memory row
          // today), one whose subject is the member.
          await save("memory", {
            id: "mem_nobody",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: MEMBER,
            spec: { subjectIdentityAccountId: "" },
          });
          await save("memory", {
            id: "mem_member",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: MEMBER,
            spec: { subjectIdentityAccountId: MEMBER },
          });

          // Instances of the org-visible agent: its default (the
          // blueprint's pointer names it) and the member's personal one.
          await save("agent_instance", {
            id: "ai_default",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: FOUNDER,
            spec: { agentId: "agt_org" },
          });
          await save("agent_instance", {
            id: "ai_member",
            org: ORG,
            visibility: ApiResourceVisibility.visibility_private,
            createdBy: MEMBER,
            spec: { agentId: "agt_org" },
          });
          storeReads = { rows: 0, scans: 0 };
          accountReads = 0;
        });

        afterEach(async () => {
          await opened.close();
        });

        describe("the adversarial cells", () => {
          it("an OUTSIDER lists nothing of the organization's — a row still carrying the retired public level included", async () => {
            for (const kind of SEEDED_KINDS.filter(
              (k) =>
                k !== ApiResourceKind.iam_policy &&
                k !== ApiResourceKind.identity_account &&
                k !== ApiResourceKind.organization,
            )) {
              expect(
                await listAs(resolved(OUTSIDER), kind),
                kindEnumName(kind),
              ).toEqual([]);
            }
          });

          it("a VIEWER lists the org-visible blueprint and nothing private; a MEMBER adds their own private one; the retired level grants neither anything", async () => {
            expect(
              await listAs(resolved(VIEWER), ApiResourceKind.agent),
            ).toEqual(["agt_org"]);
            expect(
              await listAs(resolved(MEMBER), ApiResourceKind.agent),
            ).toEqual(["agt_org", "agt_member_private"]);
          });

          it("the FOUNDER and the ADMIN list every blueprint (`owner: … or admin from organization`), including a member's private one", async () => {
            const all = [
              "agt_private",
              "agt_org",
              "agt_member_private",
              "agt_public",
              "agt_legacy",
            ];
            expect(
              await listAs(resolved(FOUNDER), ApiResourceKind.agent),
            ).toEqual(all);
            expect(
              await listAs(resolved(ADMIN), ApiResourceKind.agent),
            ).toEqual(all);
          });

          it("sessions, API keys and environments are their owner's: the founder — an admin — does NOT list a member's, and the admin lists none", async () => {
            for (const [kind, prefix] of [
              [ApiResourceKind.session, "ses"],
              [ApiResourceKind.api_key, "key"],
              [ApiResourceKind.environment, "env"],
            ] as const) {
              expect(await listAs(resolved(FOUNDER), kind)).toEqual([
                `${prefix}_founder`,
              ]);
              expect(await listAs(resolved(MEMBER), kind)).toEqual([
                `${prefix}_member`,
              ]);
              expect(await listAs(resolved(ADMIN), kind)).toEqual([]);
            }
          });

          it("an execution is its SESSION's (`can_view from session`): each person lists the runs of their own sessions; an orphaned execution is nobody's", async () => {
            expect(
              await listAs(resolved(FOUNDER), ApiResourceKind.agent_execution),
            ).toEqual(["aex_f1", "aex_f2"]);
            expect(
              await listAs(resolved(MEMBER), ApiResourceKind.agent_execution),
            ).toEqual(["aex_m1"]);
            expect(
              await listAs(resolved(ADMIN), ApiResourceKind.agent_execution),
            ).toEqual([]);
          });

          it("a run of an org-observable instance reaches the organization's viewers through `execution_viewer`; a run of a private instance is its triggerer's alone", async () => {
            expect(
              await listAs(
                resolved(VIEWER),
                ApiResourceKind.workflow_execution,
              ),
            ).toEqual(["wex_member_observable"]);
            expect(
              await listAs(
                resolved(FOUNDER),
                ApiResourceKind.workflow_execution,
              ),
            ).toEqual(["wex_member_observable", "wex_founder_private"]);
            expect(
              await listAs(
                resolved(MEMBER),
                ApiResourceKind.workflow_execution,
              ),
            ).toEqual(["wex_member_observable"]);
          });

          it("a memory is its SUBJECT's and a memory with no subject is nobody's — the founder lists none, the member lists the one about them", async () => {
            expect(
              await listAs(resolved(FOUNDER), ApiResourceKind.memory),
            ).toEqual([]);
            expect(
              await listAs(resolved(MEMBER), ApiResourceKind.memory),
            ).toEqual(["mem_member"]);
          });

          it("an instance reaches whoever reads its blueprint only when it is the DEFAULT (`viewer from default_of`); a personal instance is its owner's", async () => {
            expect(
              await listAs(resolved(VIEWER), ApiResourceKind.agent_instance),
            ).toEqual(["ai_default"]);
            expect(
              await listAs(resolved(MEMBER), ApiResourceKind.agent_instance),
            ).toEqual(["ai_default", "ai_member"]);
            expect(
              await listAs(resolved(FOUNDER), ApiResourceKind.agent_instance),
            ).toEqual(["ai_default"]);
          });
        });

        describe("the seam's contract", () => {
          it("only narrows, never reorders, and answers a duplicate once", async () => {
            const offered = [
              entryOf(
                ApiResourceKind.agent,
                rows.get(ApiResourceKind.agent)!.get("agt_member_private")!,
              ),
              entryOf(
                ApiResourceKind.agent,
                rows.get(ApiResourceKind.agent)!.get("agt_private")!,
              ),
              entryOf(
                ApiResourceKind.agent,
                rows.get(ApiResourceKind.agent)!.get("agt_org")!,
              ),
              entryOf(
                ApiResourceKind.agent,
                rows.get(ApiResourceKind.agent)!.get("agt_org")!,
              ),
            ];
            const kept = await scope().restrictListEntries(
              resolved(MEMBER),
              ApiResourceKind.agent,
              offered,
            );
            expect([...kept]).toEqual(["agt_member_private", "agt_org"]);
            // The lane's order is the lane's: the helper filters its own
            // array by the kept set.
            expect(
              await listAs(resolved(MEMBER), ApiResourceKind.agent, [
                rows.get(ApiResourceKind.agent)!.get("agt_member_private")!,
                rows.get(ApiResourceKind.agent)!.get("agt_org")!,
              ]),
            ).toEqual(["agt_member_private", "agt_org"]);
          });

          it("no candidates: the empty set, with no read of any kind", async () => {
            expect(
              await scope().restrictListEntries(
                resolved(MEMBER),
                ApiResourceKind.agent,
                [],
              ),
            ).toEqual(new Set());
            expect(storeReads).toEqual({ rows: 0, scans: 0 });
            expect(accountReads).toBe(0);
          });

          it("the `internal` class on the enumeration verb — the server acting as itself — is every id of the kind, with no account even asked for (the in-process skip; no helper stands before this verb)", async () => {
            expect(
              [
                ...(await scope().authorizedResourceIds(
                  INTERNAL,
                  ApiResourceKind.session,
                )),
              ].sort(),
            ).toEqual(["ses_founder", "ses_member"]);
            expect(accountReads).toBe(0);
          });

          it("the `internal` class on the restrict verb is a consumer bug, loud: the shared helper answers that class before any driver, so a driver offered it was reached around the idiom", async () => {
            const offered = rowsOf(ApiResourceKind.agent).map((row) =>
              entryOf(ApiResourceKind.agent, row),
            );
            const refusal = await scope()
              .restrictListEntries(INTERNAL, ApiResourceKind.agent, offered)
              .then(
                () => undefined,
                (error: unknown) => error,
              );
            // The seam's own refusal, the one a composition's driver throws
            // too; never the evaluator's fault, since nothing was evaluated.
            expect(refusal).toBeInstanceOf(InternalCallerOfferedError);
            expect(refusal).not.toBeInstanceOf(AuthorizationEvaluationError);
            expect((refusal as InternalCallerOfferedError).kind).toBe(
              ApiResourceKind.agent,
            );
            expect((refusal as InternalCallerOfferedError).message).toContain(
              "kind 'agent'",
            );
            // Refused before any read: the server was never evaluated as a person.
            expect(accountReads).toBe(0);
            expect(storeReads).toEqual({ rows: 0, scans: 0 });
          });

          it("an unprovisioned subject is their raw subject and nothing else: the 3.14-stamped row is theirs, the organization's rows are not", async () => {
            // `agt_legacy` is stamped with LEGACY's raw subject; a caller
            // who IS that subject and holds no account reaches it through
            // the alias, and reaches nothing the organization holds.
            expect(
              await listAs(idpShaped(LEGACY_SUBJECT), ApiResourceKind.agent, [
                rows.get(ApiResourceKind.agent)!.get("agt_legacy")!,
                rows.get(ApiResourceKind.agent)!.get("agt_org")!,
              ]),
            ).toEqual(["agt_legacy"]);
            expect(
              await listAs(idpShaped(FRESH_SUBJECT), ApiResourceKind.agent),
            ).toEqual([]);
          });

          it("a provisioned account whose idp subject stamped the row still owns it — the alias comparison the 3.14 rows need, on the list verb", async () => {
            expect(
              await listAs(resolved(LEGACY), ApiResourceKind.agent, [
                rows.get(ApiResourceKind.agent)!.get("agt_legacy")!,
              ]),
            ).toEqual(["agt_legacy"]);
          });

          it("a store fault THROWS — never an empty answer (an empty set means 'authorized to see nothing')", async () => {
            const fault = new Error("connection reset");
            const faulting = scope({
              policies: {
                ...policies,
                findByPrincipal: () => Promise.reject(fault),
              },
            });
            await expect(
              faulting.restrictListEntries(
                resolved(MEMBER),
                ApiResourceKind.agent,
                rowsOf(ApiResourceKind.agent).map((row) =>
                  entryOf(ApiResourceKind.agent, row),
                ),
              ),
            ).rejects.toBe(fault);
            await expect(
              faulting.authorizedResourceIds(
                resolved(MEMBER),
                ApiResourceKind.agent,
              ),
            ).rejects.toBe(fault);
          });

          it("a kind the model does not declare is a consumer bug — loud, never a silent empty answer", async () => {
            await expect(
              scope().restrictListEntries(
                resolved(MEMBER),
                ApiResourceKind.platform,
                [
                  {
                    id: "stigmer",
                    org: "",
                    labels: {},
                    createdBy: "",
                    visibility:
                      ApiResourceVisibility.api_resource_visibility_unspecified,
                    parentLinks: [],
                  },
                ],
              ),
            ).rejects.toBeInstanceOf(AuthorizationEvaluationError);
            await expect(
              scope().authorizedResourceIds(
                resolved(MEMBER),
                ApiResourceKind.platform,
              ),
            ).rejects.toBeInstanceOf(AuthorizationEvaluationError);
          });

          it("a caller who names no person is a fault the pipeline sanitizes, never a list", async () => {
            await expect(
              scope().restrictListEntries(
                { ...resolved("system"), callerClass: "user" },
                ApiResourceKind.agent,
                [],
              ),
            ).resolves.toEqual(new Set());
            await expect(
              scope().restrictListEntries(
                { ...resolved("system"), callerClass: "user" },
                ApiResourceKind.agent,
                rowsOf(ApiResourceKind.agent).map((row) =>
                  entryOf(ApiResourceKind.agent, row),
                ),
              ),
            ).rejects.toThrow(/names no person/);
          });
        });

        describe("the enumeration verb", () => {
          it("equals the restrict verb over the whole kind, for every seeded kind and every person", async () => {
            for (const kind of SEEDED_KINDS.filter(
              (k) =>
                k !== ApiResourceKind.iam_policy &&
                k !== ApiResourceKind.identity_account,
            )) {
              for (const who of [FOUNDER, ADMIN, MEMBER, VIEWER, OUTSIDER]) {
                const enumerated = await scope().authorizedResourceIds(
                  resolved(who),
                  kind,
                );
                const restricted = await scope().restrictListEntries(
                  resolved(who),
                  kind,
                  rowsOf(kind).map((row) => entryOf(kind, row)),
                );
                expect(
                  [...enumerated].sort(),
                  `${kindEnumName(kind)} for ${who}`,
                ).toEqual([...restricted].sort());
              }
            }
          });

          it("a stored row that does not decode is skipped, never a fault — no lane can show it either", async () => {
            const truncated = new Uint8Array([0x0a, 0xff]);
            const enumerated = await scope({
              store: {
                ...opened.store,
                listResources: async (kind) => [
                  ...(await opened.store.listResources(kind)),
                  truncated,
                ],
              },
            }).authorizedResourceIds(
              resolved(FOUNDER),
              ApiResourceKind.session,
            );
            expect([...enumerated]).toEqual(["ses_founder"]);
          });
        });

        describe("cost", () => {
          it("a list of executions reads each DISTINCT session once and no execution row at all — the candidates' facts are the entries'", async () => {
            await listAs(resolved(FOUNDER), ApiResourceKind.agent_execution);
            // Three sessions named across four candidates (one of them
            // gone); the organization row is not walked for an execution.
            expect(storeReads).toEqual({ rows: 3, scans: 0 });
          });

          it("a list of blueprints reads the organization row once for the userset hop and nothing per candidate; the account once; the person's rows once", async () => {
            let principalReads = 0;
            await restrictListByReadScope(
              scope({
                policies: {
                  ...policies,
                  findByPrincipal(principalKind, principalId) {
                    principalReads += 1;
                    return policies.findByPrincipal(principalKind, principalId);
                  },
                },
              }),
              resolved(MEMBER),
              ApiResourceKind.agent,
              rowsOf(ApiResourceKind.agent) as Array<{
                metadata?: { id?: string };
              }>,
              "",
            );
            expect(storeReads).toEqual({ rows: 1, scans: 0 });
            expect(accountReads).toBe(1);
            expect(principalReads).toBe(1);
          });

          it("a list of instances reads each instance row once beside the blueprint — the `default_of` rule reads the pointer's spec, which a candidate's facts do not carry (stated, not hidden)", async () => {
            // The viewer owns neither instance, so `viewer from default_of`
            // is evaluated for both: two instance rows, the one blueprint,
            // the one organization.
            await listAs(resolved(VIEWER), ApiResourceKind.agent_instance);
            expect(storeReads).toEqual({ rows: 4, scans: 0 });
          });

          it("the enumeration verb scans the kind exactly once", async () => {
            await scope().authorizedResourceIds(
              resolved(MEMBER),
              ApiResourceKind.session,
            );
            expect(storeReads.scans).toBe(1);
          });
        });
      },
    );
  },
);
