# store/ — the persistence layer

Ports `backend/libs/go/store`: `interface.ts` is the
driver-agnostic contract (surface-for-surface with Go's `store.Store`, plus the
consolidated members Go kept behind the `DB()` escape hatch — bootstrap state,
MCP OAuth). Two drivers implement it:

- `sqlite/` — the laptop-tier default (`node:sqlite`, zero-config, one file)
  with its versioned migration chain (v1–v6 adopted from Go DDL-faithful, then
  this port's own steps, each named at its constant in `sqlite/migrations.ts`).
- `postgres/` — the self-host/team tier (`pg` pool, row-level `FOR UPDATE`
  atomicity, its own independent migration chain with real indexes,
  `tsvector`/`tsquery` search).

Selection is boot config (`boot/config.ts`): `DATABASE_URL` set → Postgres (it
wins when both are set — `DB_PATH` always has a default value); else sqlite on
`DB_PATH`. Domain code depends on `interface.ts` only — never on a driver
directory. Driver-neutral helpers shared by both drivers live here
(`proto-fields.ts` reflection + scan semantics, `list-index.ts`, `logger.ts`).

## The list index

A list lane reads one organization's or one parent's rows in creation order
through `Store.queryResources`, never by decoding the whole kind.
`list-index.ts` is the one derivation: a kind's declaration (beside its lanes,
`domain/<kind>/list-index.ts`) names its keys as data, the composition root
opens the store with the one list of declarations (`boot/list-indexes.ts`), and
every driver keeps a declared row's facts (organization, creation instant, keys)
in the same statement as the row.

Reads are exact whoever wrote the rows. A row whose facts are not proven current
— written by a binary that does not know the index, as the old pod does while a
roll overlaps it with the new one, or under another revision of the declaration
— is evaluated from its bytes and repaired by a compare-and-set on those bytes.
The migrations that add the index are schema only; the reconciliation each
driver runs at open derives every unproven row, so the unproven set is empty in
steady state and reads stay one index range. Every read shape names or forces
its index, because a freshly written table has no planner statistics.

## Writes that build on a read

No write stores a copy of a row it read earlier, because anything written in
between (a status write, a rename, another person's edit) would be undone. A
writer that names its fields writes them inside `updateResource`, whose
`modify` is synchronous. A chain that rebuilds the row across awaited steps (an
update: authorization, reference checks, a version hash) reads it with
`readResourceForWrite`, which keeps the exact stored bytes, and stores it with
`swapResource`, one compare-and-swap on those bytes over
`replaceResourceDataIfUnchanged`. A lost swap reruns the chain from a fresh read
(`pipeline/guarded-write.ts`). A kind kept outside this store offers the same
pair on its port (`guarded-port.ts`, with the contract lines every driver
runs). `saveResource`, the upsert, is for a row that is new;
`__tests__/write-discipline.test.ts` holds every caller to that. A row that must
be created exactly once uses `insertResource`, which writes only when the id is
not held and answers whether it did, so the store's key decides a race.

## The session event log

Each session's ordered event log (`session-events.ts`) is its own table, `session_events`, numbered per session (`seq`) and stamped with the fixed-width UTC time the store accepted each event. Writers reach it two ways: `Store.sessionEvents.append`, a runner's events guarded by its run's row, and `Store.writeResourceAppendingEvents`, the one door for a resource write that must commit with events (a run's phase change and its session's status). The second reads the committed row and counts the session's other working rows from one list key (`working_session` on runs) without decoding a row, hands both to a synchronous writer, and commits the row and its events in one transaction. A writer that must know which run holds the session's newest event of a type (the run of the newest `user.message`, the conversation's newest turn) names that type in its scope, and only that writer pays the read. Each event's gates (the ask it opens or closes: a tool use that waits for a person, its answer or its result) are kept in columns beside its bytes, derived by the declaration the domain hands the store at open (`StoreOpenOptions.sessionEventGates`, `domain/session/events/gates.ts`) on every write and, for a row stamped with another revision, at open, as list keys are. A writer whose scope names the waiting key (`waiting_session` on runs) is also handed the session's other waiting rows and the open gates of those rows and of the written row, read from the columns without decoding an event.

One lock order everywhere: the session first, then rows. Postgres takes a transaction-scoped advisory lock on the session (`hashtextextended('session_events/' || id)`), then the row `FOR UPDATE`; an append takes the session's lock, then reads its guard row `FOR SHARE`. SQLite serializes every writer under `BEGIN IMMEDIATE`. So a session's numbers, times and working count are assigned by one writer at a time. The contract both drivers pass, and a composition runs over its own database, is the kit `session-events-contract.ts`.

## File blobs

A File's bytes live in a blob store under a key the server mints, and that key is kept off every File row (`file-blobs.ts`). Two tables hold it: `file_blobs`, one row per blob (its key, organization, state, size and the instant a sweep may delete it), and `file_blob_refs`, one row per File naming its blob; several Files may share a blob, and a blob goes only with the last File that names it. A blob is `staged` while an upload URL is out, `stored` while a File names it, and `orphaned` while no File does: leased while a new File's bytes are written, or expiring at once when its last File was deleted. A sweep deletes the bytes of every staged or orphaned blob past its expiry, then forgets the row only while it is still past its expiry, and `insert` refuses such a blob, so nothing can name bytes a sweep is deleting.

`Store.files.insert` and `Store.files.remove` change who names a blob, and each commits the File's resource row (with its etag and list keys, as `insertResource` writes one), its ref and the blob's state in one transaction, as `writeResourceAppendingEvents` commits a row with its events. One lock order: the blob's row first, then the resource rows. Postgres takes `SELECT … FROM file_blobs … FOR UPDATE` before it touches a resource row; SQLite serializes every writer under `BEGIN IMMEDIATE`. So two removes of a blob's last two Files orphan it exactly once, and an insert racing the remove of a blob's last File lands first or is refused. The contract both drivers pass is the kit `__tests__/file-blobs-contract.ts`.

A third table, `file_conversions`, holds the attachments runs carried before a message's files became Files. The step that turned a conversation's workspace entries into its resources (Postgres v40, SQLite v44, `workspace-becomes-resources.ts`) lifted each one off its run into a row keyed by the run and its position, and the file domain reads them oldest run first (`Store.files.listConversions`), makes each a File of the run's conversation, and forgets it (`forgetConversion`). An organization's purge removes its rows with its blobs.

A fourth, `output_conversions`, holds the files the native engine uploaded for a run before what a turn returns became Files. The step that retired them (Postgres v41, SQLite v45, `run-artifacts-become-files.ts`) lifted each file entry off its run's status into a row keyed the same way, and the file domain makes each a File of the run, with the run's id and the file's name as its output path (`Store.files.listOutputConversions`, `forgetOutputConversion`). It is a table of its own because its keys are trusted by another shape and its rows become a run's outputs, not a message's files. An organization's purge removes its rows too.

## The permission history

Every change to an access row can be recorded in `grant_history`
(`permission-history.ts`), in the same transaction as the row. A writer hands
`Store.insertResource` or `Store.deleteResource` a `PermissionChange` (the
cause, the actor, the organization) and the store appends one entry: `granted`
for a row it inserted, `revoked` for a row it removed, nothing for an insert
that found the id held or a delete that found nothing. The entry's triple and
bytes are read from the row the store wrote or removed, never handed in, so an
entry cannot describe another row. Entries are numbered per organization from
`grant_history_heads`, in commit order with no gaps, with times that never
go back. Lock order: Postgres takes a transaction-scoped advisory lock on the
organization (`hashtextextended('grant_history/' || org)`) before the row;
SQLite runs under `BEGIN IMMEDIATE`. A write with no change takes no lock. Only
the Grant adapter hands a change, and only in a composition that keeps a
history (`domain/grant/resource-store.ts`). An organization's purge leaves
the history in place. `Store.listPermissionHistory` reads one organization's
entries on the primary key: newest first below a number, or oldest first above
one, a bounded page at a time. The numbering is what makes "everything after
N", asked again later, skip nothing above the oldest kept entry.

Retention is the one removal: `Store.prunePermissionHistory` deletes a batch of
the entries recorded before a cutoff, ordered by time, then organization, then
number, over the index `grant_history_by_time` in that order. An
organization's times never go back as its numbers rise, so what goes is always
a prefix of its numbers and its kept entries stay one unbroken run; the
`(org, sequence)` tie-break keeps entries sharing a millisecond in number order
across a batch boundary. It takes no lock: an entry still being written is
stamped after the cutoff. The heads are never removed, so a number is never
handed out twice, and `Store.permissionHistoryHead` reads an organization's last
number even when every entry has gone. The runner that calls it, and how long a history is kept, are
the domain's (`domain/grant/history-retention.ts`).

The tables were `iam_policy_history` and `iam_policy_history_heads`, with the
column `policy_id`, until the kind was renamed Grant (Postgres v34, SQLite
v38). That step also moved every stored grant's id from `iamp_X` to `grt_X`, in
its row, its list keys and its history entries: a grant's id is derived from
its triple and copied by nothing but its own history, so unlike every other
kind's ids it follows the rename (`kind-rename.ts` has the reasons).

## Two kinds merged into one

The agent share (a hosted chat link) and the agent channel (a Slack or WhatsApp
connection) became one Channel kind whose type says which (Postgres v37,
SQLite v41, `channel-kinds-merged.ts`). Each stored row is converted, not
retired, and keeps its id: a chat link lives in pages Stigmer does not control
and a connection in a provider's install, so an `ash_` or `ach_` id stays
valid under the kind's retired prefixes. The rows are read by field number,
since the two generated messages are gone; the frozen shapes in
`frozen-envelopes.ts` keep the older steps reading them as they did. Names
were kept per kind, so a share and a channel of one organization could hold
one slug: the older row keeps it, by creation time then by id, the name
backfill's own rule (`resource-names-backfill.ts`), and the other takes its
type as a suffix, logged. Grants on either kind are re-keyed to the channel's
triple and their history follows, and a chat link's guest conversations take
the one label every channel's conversations carry, `stigmer.ai/channel-id`.

## Contract and continuity

The behavioral contract both drivers must satisfy identically is
`__tests__/store-contract.ts`, invoked by each driver's store-contract test (`sqlite/__tests__/store-contract.test.ts`, `postgres/__tests__/store-contract.postgres.test.ts`)
(sqlite always; Postgres under `TEST_DATABASE_URL` — visible skips locally, a
real service container in CI). Driver-physical behavior stays in each driver's
own tests. One deliberate semantic difference: sqlite
serializes ALL writes globally as a side effect of its single synchronous
connection; Postgres guarantees per-resource atomicity only — the interface
contract is the narrower one.

Schema continuity across the Go cutover (any Go-created database adopts forward)
is proven by `sqlite/__tests__/migrations.test.ts` against a real Go-created
fixture. The fixture is FROZEN: the Go server retired, its schema can no
longer change, and the committed v6 dump is the permanent record of what real pre-cutover databases look like. The generator
script (`scripts/regen-go-db-fixture.sh`) was retired with it and remains in git
history should the fixture ever need forensic regeneration. The Postgres chain
has no adoption story by construction — no Postgres database predates its
driver.
