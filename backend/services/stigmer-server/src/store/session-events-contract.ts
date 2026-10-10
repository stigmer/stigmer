/**
 * The session event store PORT-CONTRACT KIT: every behaviour a Store must
 * satisfy for the session event log (session-events.ts), as cases a
 * driver's test iterates over a fresh store. Open source runs them on its
 * SQLite and Postgres drivers (__tests__/session-events.contract.test.ts);
 * a composition runs the same cases over the store it serves with (the
 * cloud's Postgres database, where this table sits beside its own schema),
 * so "the log holds" is one statement proven per driver.
 *
 * The cases drive `Store.sessionEvents` and
 * `Store.writeResourceAppendingEvents` over run rows, the kind whose list
 * index carries the session and working keys (domain/run/list-index.ts).
 * The kit hands the fixture factory the options to open its store with
 * (the server's list indexes, boot/list-indexes.ts, as the composition
 * root opens it), so the list stays the server's own. Event payloads are
 * opaque bytes to a store, so the drafts here are arbitrary bytes.
 *
 * The shape is the port-contract runner's (port-contract.ts): vitest-free,
 * asserting through node:assert/strict, so it ships in dist/ through the
 * barrel. Case names are the contract lines; the OSS test pins the list.
 */
import assert from "node:assert/strict";

import { create } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../boot/list-indexes.js";
import { ResourceNotFoundError } from "./interface.js";
import type { Store, StoreOpenOptions } from "./interface.js";
import { portContractCases } from "./port-contract.js";
import type {
  PortContractCase,
  PortContractDeclaration,
  PortContractFixture,
} from "./port-contract.js";
import { SessionEventConflictError } from "./session-events.js";
import type {
  ResourceEventWriter,
  SessionEventDraft,
  SessionEventGuard,
  SessionEventScope,
} from "./session-events.js";

/** The runner's fixture over the whole Store: the log is the store's own, joined to its rows. */
export type SessionEventStoreContractFixture = PortContractFixture<Store>;

export type SessionEventStoreContractCase = PortContractCase;

const KEPT = ["session.status_running", "session.status_idle"];
const RUN_SCOPE: SessionEventScope = {
  sessionKey: "session",
  workingKey: "working_session",
  stateEventTypes: KEPT,
};
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A unique suffix per case, so a fixture over a shared database never meets another case's rows. */
function unique(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function run(id: string, sessionId: string, phase: RunPhase, org = "org-kit"): Run {
  return create(RunSchema, {
    metadata: { id, org },
    spec: { target: sessionId === "" ? { case: undefined } : { case: "sessionId", value: sessionId } },
    status: { phase },
  });
}

function draft(eventId: string, runId: string, type = "agent.message", body = eventId): SessionEventDraft {
  return { eventId, runId, threadId: "", type, data: new TextEncoder().encode(body) };
}

/** A guard that admits the run when it exists. */
function runGuard(id: string, admit: (row: Run) => void = () => undefined): SessionEventGuard {
  return {
    kind: ApiResourceKind.run,
    id,
    schema: RunSchema,
    admit: (row) => admit(row as Run),
  };
}

/** Writes `row` with `events`, recording what the writer was handed. */
async function put(
  store: Store,
  row: Run,
  events: ReadonlyArray<SessionEventDraft> = [],
  seen: { previous?: Run | undefined; others?: number; state?: string | undefined } = {},
): Promise<void> {
  const writer: ResourceEventWriter<typeof RunSchema> = (previous, session) => {
    seen.previous = previous;
    seen.others = session.othersWorking;
    seen.state = session.latestStateType;
    return { put: row, events };
  };
  const sessionId = row.spec?.target.case === "sessionId" ? row.spec.target.value : "";
  await store.writeResourceAppendingEvents(ApiResourceKind.run, row.metadata?.id ?? "", RunSchema, writer, {
    ...RUN_SCOPE,
    sessionId,
  });
}

async function seqs(store: Store, sessionId: string): Promise<number[]> {
  const records = await store.sessionEvents.list(sessionId, { order: "asc", limit: 1000 });
  return records.map((r) => r.seq);
}

const DECLARATIONS: ReadonlyArray<PortContractDeclaration<Store>> = [
  [
    "append numbers a session's events from 1 in order and stamps each append with one fixed-width accepted time",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      await put(store, run(`run_${unique()}`, s, RunPhase.RUN_IN_PROGRESS));
      const runId = (await store.sessionEvents.list(s, { order: "asc", limit: 1 }))[0]?.runId;
      assert.equal(runId, undefined, "a write with no events appends none");
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS));
      const first = await store.sessionEvents.append(s, "org-kit", [draft("a", r), draft("b", r)], runGuard(r));
      const second = await store.sessionEvents.append(s, "org-kit", [draft("c", r)], runGuard(r));
      assert.deepEqual(first.records.map((x) => x.seq), [1, 2]);
      assert.deepEqual(second.records.map((x) => x.seq), [3]);
      assert.equal(first.records[0]?.processedAt, first.records[1]?.processedAt);
      for (const record of [...first.records, ...second.records]) {
        assert.match(record.processedAt, INSTANT);
      }
      assert.ok(second.records[0]!.processedAt >= first.records[0]!.processedAt);
      const listed = await store.sessionEvents.list(s, { order: "asc", limit: 10 });
      assert.deepEqual(listed.map((x) => [x.seq, x.eventId]), [[1, "a"], [2, "b"], [3, "c"]]);
      assert.deepEqual(Array.from(listed[0]!.data), Array.from(new TextEncoder().encode("a")));
    },
  ],
  [
    "concurrent appends to one session leave no gap and no repeated number",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS));
      await Promise.all(
        Array.from({ length: 10 }, (_, batch) =>
          store.sessionEvents.append(
            s,
            "org-kit",
            Array.from({ length: 5 }, (_, i) => draft(`e${batch}-${i}`, r)),
            runGuard(r),
          ),
        ),
      );
      assert.deepEqual(await seqs(store, s), Array.from({ length: 50 }, (_, i) => i + 1));
    },
  ],
  [
    "a resent event with the same bytes answers its stored record and is not appended again",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS));
      const first = await store.sessionEvents.append(s, "org-kit", [draft("a", r)], runGuard(r));
      const again = await store.sessionEvents.append(s, "org-kit", [draft("a", r), draft("b", r)], runGuard(r));
      assert.deepEqual(again.records.map((x) => [x.eventId, x.seq]), [["a", 1], ["b", 2]]);
      assert.equal(again.records[0]?.processedAt, first.records[0]?.processedAt);
      assert.deepEqual(again.appended.map((x) => x.eventId), ["b"]);
      const whole = await store.sessionEvents.append(s, "org-kit", [draft("a", r), draft("b", r)], runGuard(r));
      assert.deepEqual(whole.appended, [], "a batch that is all resends appends nothing");
      assert.deepEqual(await seqs(store, s), [1, 2]);
    },
  ],
  [
    "a resent id with other bytes is refused and appends nothing of its batch",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS));
      await store.sessionEvents.append(s, "org-kit", [draft("a", r)], runGuard(r));
      await assert.rejects(
        store.sessionEvents.append(s, "org-kit", [draft("b", r), draft("a", r, "agent.message", "other")], runGuard(r)),
        SessionEventConflictError,
      );
      await assert.rejects(
        store.sessionEvents.append(s, "org-kit", [draft("c", r), draft("c", r, "agent.message", "other")], runGuard(r)),
        SessionEventConflictError,
      );
      assert.deepEqual(await seqs(store, s), [1]);
    },
  ],
  [
    "an event id is unique per session, not across sessions",
    async ({ store }) => {
      const s1 = `ses_${unique()}`;
      const s2 = `ses_${unique()}`;
      const r1 = `run_${unique()}`;
      const r2 = `run_${unique()}`;
      await put(store, run(r1, s1, RunPhase.RUN_IN_PROGRESS));
      await put(store, run(r2, s2, RunPhase.RUN_IN_PROGRESS));
      await store.sessionEvents.append(s1, "org-kit", [draft("same", r1)], runGuard(r1));
      const other = await store.sessionEvents.append(
        s2,
        "org-kit",
        [draft("same", r2, "agent.message", "other bytes")],
        runGuard(r2),
      );
      assert.deepEqual(other.appended.map((x) => [x.sessionId, x.seq]), [[s2, 1]]);
    },
  ],
  [
    "append appends nothing when its guard refuses or its row is absent",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_COMPLETED));
      const refusal = new Error("finished");
      await assert.rejects(
        store.sessionEvents.append(s, "org-kit", [draft("a", r)], runGuard(r, (row) => {
          if (row.status?.phase === RunPhase.RUN_COMPLETED) {
            throw refusal;
          }
        })),
        (error) => error === refusal,
      );
      await assert.rejects(
        store.sessionEvents.append(s, "org-kit", [draft("a", "run_absent")], runGuard("run_absent")),
        ResourceNotFoundError,
      );
      await assert.rejects(store.sessionEvents.append("", "org-kit", [draft("a", r)], runGuard(r)), /need a session/);
      assert.deepEqual(await seqs(store, s), []);
    },
  ],
  [
    "list reads by seq in either order, after a seq, by type, and within accepted-time bounds",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS));
      await store.sessionEvents.append(
        s,
        "org-kit",
        [draft("a", r, "agent.message"), draft("b", r, "agent.thinking"), draft("c", r, "agent.message")],
        runGuard(r),
      );
      const ids = async (query: Parameters<Store["sessionEvents"]["list"]>[1]): Promise<string[]> =>
        (await store.sessionEvents.list(s, query)).map((x) => x.eventId);
      assert.deepEqual(await ids({ order: "desc", limit: 10 }), ["c", "b", "a"]);
      assert.deepEqual(await ids({ order: "asc", limit: 2 }), ["a", "b"]);
      assert.deepEqual(await ids({ order: "asc", afterSeq: 1, limit: 10 }), ["b", "c"]);
      assert.deepEqual(await ids({ order: "desc", afterSeq: 3, limit: 10 }), ["b", "a"]);
      assert.deepEqual(await ids({ order: "asc", types: ["agent.message"], limit: 10 }), ["a", "c"]);
      const at = (await store.sessionEvents.list(s, { order: "asc", limit: 1 }))[0]!.processedAt;
      assert.deepEqual(await ids({ order: "asc", processedAtGte: at, processedAtLte: at, limit: 10 }), ["a", "b", "c"]);
      assert.deepEqual(await ids({ order: "asc", processedAtGt: at, limit: 10 }), []);
      assert.deepEqual(await ids({ order: "asc", processedAtLt: at, limit: 10 }), []);
      await assert.rejects(store.sessionEvents.list(s, { order: "asc", limit: 0 }));
    },
  ],
  [
    "a resource write commits the row with its events and hands the writer the committed row",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      const created: { previous?: Run | undefined; others?: number } = {};
      await put(store, run(r, s, RunPhase.RUN_PENDING), [draft("m", r, "user.message")], created);
      assert.equal(created.previous, undefined);
      const updated: { previous?: Run | undefined; others?: number } = {};
      await put(store, run(r, s, RunPhase.RUN_COMPLETED), [draft("i", r, "session.status_idle")], updated);
      assert.equal(updated.previous?.status?.phase, RunPhase.RUN_PENDING);
      const stored = await store.getResource(ApiResourceKind.run, r, RunSchema);
      assert.equal(stored.status?.phase, RunPhase.RUN_COMPLETED);
      const events = await store.sessionEvents.list(s, { order: "asc", limit: 10 });
      assert.deepEqual(events.map((x) => [x.seq, x.eventId, x.type, x.runId]), [
        [1, "m", "user.message", r],
        [2, "i", "session.status_idle", r],
      ]);
    },
  ],
  [
    "a resource write that throws commits neither the row nor its events",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_PENDING));
      const failure = new Error("refused");
      await assert.rejects(
        store.writeResourceAppendingEvents(ApiResourceKind.run, r, RunSchema, () => {
          throw failure;
        }, RUN_SCOPE),
        (error) => error === failure,
      );
      // A conflicting event id fails the insert after the row was written: both roll back.
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS), [draft("dup", r)]);
      await assert.rejects(put(store, run(r, s, RunPhase.RUN_COMPLETED), [draft("dup", r)]));
      const stored = await store.getResource(ApiResourceKind.run, r, RunSchema);
      assert.equal(stored.status?.phase, RunPhase.RUN_IN_PROGRESS);
      assert.deepEqual(await seqs(store, s), [1]);
    },
  ],
  [
    "the working count is the session's other working rows: not the row itself, not another session's, not a stopped one",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const other = `ses_${unique()}`;
      await put(store, run(`run_${unique()}`, s, RunPhase.RUN_IN_PROGRESS));
      await put(store, run(`run_${unique()}`, s, RunPhase.RUN_WAITING_FOR_APPROVAL));
      await put(store, run(`run_${unique()}`, s, RunPhase.RUN_COMPLETED));
      await put(store, run(`run_${unique()}`, s, RunPhase.RUN_PAUSED));
      await put(store, run(`run_${unique()}`, other, RunPhase.RUN_PENDING));
      const r = `run_${unique()}`;
      const seen: { others?: number } = {};
      await put(store, run(r, s, RunPhase.RUN_PENDING), [], seen);
      assert.equal(seen.others, 2);
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS), [], seen);
      assert.equal(seen.others, 2, "the row's own working key is not counted");
    },
  ],
  [
    "the writer is handed the type of the session's newest state event, read under the lock",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      const seen: { state?: string | undefined } = {};
      await put(store, run(r, s, RunPhase.RUN_PENDING), [draft("m", r, "user.message")], seen);
      assert.equal(seen.state, undefined, "a session with no state event yet");
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS), [draft("on", r, "session.status_running"), draft("say", r, "agent.message")], seen);
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS), [], seen);
      assert.equal(seen.state, "session.status_running", "newest of the state types, not the newest event");
      await put(store, run(r, s, RunPhase.RUN_COMPLETED), [draft("off", r, "session.status_idle")], seen);
      await put(store, run(r, s, RunPhase.RUN_COMPLETED), [], seen);
      assert.equal(seen.state, "session.status_idle");
    },
  ],
  [
    "writers of one session run one after the other, each counting what the other committed",
    async ({ store }) => {
      const sessions = Array.from({ length: 8 }, () => `ses_${unique()}`);
      const counts = await Promise.all(
        sessions.flatMap((s) =>
          [0, 1].map(async () => {
            const seen: { others?: number } = {};
            await put(store, run(`run_${unique()}`, s, RunPhase.RUN_PENDING), [], seen);
            return { s, others: seen.others };
          }),
        ),
      );
      for (const s of sessions) {
        const mine = counts.filter((c) => c.s === s).map((c) => c.others).sort();
        assert.deepEqual(mine, [0, 1], `session ${s}: exactly one writer saw the other`);
      }
    },
  ],
  [
    "removing a row removes its own events except the kept types, and its list keys",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      const sibling = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_IN_PROGRESS), [
        draft("m", r, "user.message"),
        draft("run", r, "session.status_running"),
        draft("say", r, "agent.message"),
      ]);
      await put(store, run(sibling, s, RunPhase.RUN_PENDING), [draft("sib", sibling, "user.message")]);
      const result = await store.writeResourceAppendingEvents(
        ApiResourceKind.run,
        r,
        RunSchema,
        (previous, session) => {
          assert.equal(previous?.status?.phase, RunPhase.RUN_IN_PROGRESS);
          assert.equal(session.othersWorking, 1);
          return { remove: { keepEventTypes: KEPT }, events: [draft("idle", r, "session.status_idle")] };
        },
        RUN_SCOPE,
      );
      assert.equal(result.row, undefined);
      await assert.rejects(store.getResource(ApiResourceKind.run, r, RunSchema), ResourceNotFoundError);
      const left = await store.sessionEvents.list(s, { order: "asc", limit: 10 });
      assert.deepEqual(left.map((x) => x.eventId), ["run", "sib", "idle"]);
      const seen: { others?: number } = {};
      await put(store, run(sibling, s, RunPhase.RUN_IN_PROGRESS), [], seen);
      assert.equal(seen.others, 0, "the removed row no longer counts as working");
    },
  ],
  [
    "a write that names no session finds it through the row, and a row that is not stored is not found",
    async ({ store }) => {
      const s = `ses_${unique()}`;
      const r = `run_${unique()}`;
      await put(store, run(r, s, RunPhase.RUN_PENDING));
      const result = await store.writeResourceAppendingEvents(
        ApiResourceKind.run,
        r,
        RunSchema,
        (previous) => ({ put: previous!, events: [draft("x", r)] }),
        RUN_SCOPE,
      );
      assert.equal(result.events[0]?.sessionId, s);
      await assert.rejects(
        store.writeResourceAppendingEvents(
          ApiResourceKind.run,
          "run_absent",
          RunSchema,
          /* v8 ignore next -- @preserve: the writer must not run for a row that is not stored; its running is the failure */
          () => assert.fail("the writer runs only for a found row"),
          RUN_SCOPE,
        ),
        ResourceNotFoundError,
      );
      await assert.rejects(
        put(store, run(r, `ses_${unique()}`, RunPhase.RUN_PENDING)),
        "a row cannot be written under another session",
      );
    },
  ],
  [
    "a row in no session writes no events",
    async ({ store }) => {
      const r = `run_${unique()}`;
      await put(store, run(r, "", RunPhase.RUN_PENDING));
      await assert.rejects(put(store, run(r, "", RunPhase.RUN_IN_PROGRESS), [draft("x", r)]));
      const stored = await store.getResource(ApiResourceKind.run, r, RunSchema);
      assert.equal(stored.status?.phase, RunPhase.RUN_PENDING);
    },
  ],
  [
    "deleteBySession removes one session's events; deleteByOrg removes an organization's",
    async ({ store }) => {
      const orgA = `org-${unique()}`;
      const orgB = `org-${unique()}`;
      const sA = `ses_${unique()}`;
      const sA2 = `ses_${unique()}`;
      const sB = `ses_${unique()}`;
      for (const [s, org] of [[sA, orgA], [sA2, orgA], [sB, orgB]] as const) {
        const r = `run_${unique()}`;
        await put(store, run(r, s, RunPhase.RUN_PENDING, org), [draft(`m-${s}`, r, "user.message")]);
      }
      assert.equal(await store.sessionEvents.deleteBySession(sA), 1);
      assert.deepEqual(await seqs(store, sA), []);
      assert.equal(await store.sessionEvents.deleteByOrg(orgA), 1);
      assert.deepEqual(await seqs(store, sA2), []);
      assert.deepEqual(await seqs(store, sB), [1]);
    },
  ],
  [
    "a disconnected store is an infrastructure fault, never 'not found'",
    async (fixture) => {
      const { store } = fixture;
      await fixture.disconnect();
      const notFound = (error: unknown): boolean => !(error instanceof ResourceNotFoundError);
      await assert.rejects(store.sessionEvents.list("ses_x", { order: "asc", limit: 1 }), notFound);
      await assert.rejects(
        store.sessionEvents.append("ses_x", "org", [draft("a", "run_x")], runGuard("run_x")),
        notFound,
      );
      await assert.rejects(put(store, run("run_x", "ses_x", RunPhase.RUN_PENDING)), notFound);
      await assert.rejects(store.sessionEvents.deleteBySession("ses_x"), notFound);
      await assert.rejects(store.sessionEvents.deleteByOrg("org"), notFound);
    },
  ],
];

/**
 * The kit's cases over `makeFixture`, one fresh store per case, each opened
 * with the options the kit hands it.
 */
export function sessionEventStoreContract(
  makeFixture: (options: StoreOpenOptions) => Promise<SessionEventStoreContractFixture>,
): ReadonlyArray<SessionEventStoreContractCase> {
  return portContractCases(DECLARATIONS, () => makeFixture({ listIndexes: LIST_INDEXES }));
}
