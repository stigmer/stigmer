/**
 * The guarded write for a kind kept outside the shared store: the one shape
 * every such port offers (a platform client, an identity account, and
 * Enterprise's team and identity provider), and the contract kit every
 * driver of one runs.
 *
 * An update chain builds its new state across awaited steps from a row it
 * read, so its write must not land on a row that moved since (the shared
 * store's swapResource, store/interface.ts). A port answers the row with
 * the exact bytes it is stored as (`readForWrite`), and stores a new row
 * only while those bytes are still the stored ones (`swap`): one statement
 * compared on the table's data column, so a status write, a rename or a
 * credential rotation that lands in between makes the swap lose, and the
 * chain runs again from a fresh read (pipeline/guarded-write.ts). A port
 * whose write can be refused for other reasons (an identity provider's
 * route another provider holds) answers a typed outcome from `swap`
 * instead of a boolean, and tells the kit which outcome landed. A port
 * keeps its narrow atomic write (`modifyById` and its kin) for the writers
 * that name their fields; `swap` is for the chains that rebuild the row.
 *
 * The kit is shaped as every port kit is (store/port-contract.ts): cases a
 * driver's test iterates, asserted through node:assert/strict, so a
 * composition proves its driver with the same lines. Each port's own kit
 * appends these declarations, bound to the port's fields.
 */
import assert from "node:assert/strict";

import type { PortContractDeclaration } from "./port-contract.js";

/** A row read for a guarded write: the row and its exact stored bytes. */
export interface GuardedRead<Row> {
  readonly row: Row;
  readonly bytes: Uint8Array;
}

/**
 * The guarded write's two members, as every port that offers it declares
 * them. `Swapped` is what a swap answers: true or false by default, or a
 * port's typed outcome, among which one means "lost".
 */
export interface GuardedWritePort<Row, Swapped = boolean> {
  /** The row and its stored bytes; undefined for an unknown id. */
  readForWrite(id: string): Promise<GuardedRead<Row> | undefined>;
  /**
   * Stores `next` only while the row's bytes still equal `expectedBytes`,
   * the bytes readForWrite answered. Lost (false) when the row changed or
   * was deleted since the read; it never inserts.
   */
  swap(id: string, expectedBytes: Uint8Array, next: Row): Promise<Swapped>;
}

/** How the kit drives one port: a seeded row, a visible change, and the port's own writes. */
export interface GuardedPortBinding<
  Port extends GuardedWritePort<Row, Swapped>,
  Row,
  Swapped = boolean,
> {
  /** Whether a swap's answer is a landed write; a boolean port's answer is itself. */
  landed?(swapped: Swapped): boolean;
  /** Stores a fresh row through the port's create door and answers it. */
  seed(store: Port): Promise<Row>;
  idOf(row: Row): string;
  /** A change a reader can see, made on a copy the kit owns. */
  change(row: Row, value: string): void;
  /** The value `change` wrote. */
  changedValueOf(row: Row): string;
  /** A write through the port's own narrow door, landing between a read and a swap. */
  interleave(store: Port, id: string, value: string): Promise<void>;
  /** Reads the row through the port's plain lookup. */
  read(store: Port, id: string): Promise<Row | undefined>;
  remove(store: Port, id: string): Promise<void>;
}

/** The guarded write's contract lines, bound to one port. */
export function guardedPortDeclarations<
  Port extends GuardedWritePort<Row, Swapped>,
  Row,
  Swapped = boolean,
>(
  binding: GuardedPortBinding<Port, Row, Swapped>,
): ReadonlyArray<PortContractDeclaration<Port>> {
  const landed = async (swapped: Promise<Swapped>): Promise<boolean> => {
    const answer = await swapped;
    if (binding.landed !== undefined) {
      return binding.landed(answer);
    }
    assert.equal(
      typeof answer,
      "boolean",
      "a port with a typed swap outcome names which one landed",
    );
    return answer === true;
  };
  return [
    [
      "readForWrite answers undefined for an unknown id",
      async ({ store }) => {
        assert.equal(await store.readForWrite("no-such-row"), undefined);
      },
    ],
    [
      "a swap on the bytes readForWrite answered lands, and the row reads back as written",
      async ({ store }) => {
        const seeded = await binding.seed(store);
        const id = binding.idOf(seeded);
        const read = await store.readForWrite(id);
        assert.ok(read !== undefined, "the seeded row reads for a write");
        binding.change(read.row, "swapped");
        assert.equal(await landed(store.swap(id, read.bytes, read.row)), true);
        const stored = await binding.read(store, id);
        assert.ok(stored !== undefined);
        assert.equal(binding.changedValueOf(stored), "swapped");
      },
    ],
    [
      "a swap loses after a write lands between the read and the swap, and that write survives",
      async ({ store }) => {
        const seeded = await binding.seed(store);
        const id = binding.idOf(seeded);
        const read = await store.readForWrite(id);
        assert.ok(read !== undefined);
        await binding.interleave(store, id, "interleaved");
        binding.change(read.row, "stale");
        assert.equal(await landed(store.swap(id, read.bytes, read.row)), false);
        const stored = await binding.read(store, id);
        assert.ok(stored !== undefined);
        assert.equal(binding.changedValueOf(stored), "interleaved");
      },
    ],
    [
      "a swap on bytes a landed swap replaced loses",
      async ({ store }) => {
        const seeded = await binding.seed(store);
        const id = binding.idOf(seeded);
        const read = await store.readForWrite(id);
        assert.ok(read !== undefined);
        binding.change(read.row, "first");
        assert.equal(await landed(store.swap(id, read.bytes, read.row)), true);
        binding.change(read.row, "second");
        assert.equal(await landed(store.swap(id, read.bytes, read.row)), false);
        const stored = await binding.read(store, id);
        assert.ok(stored !== undefined);
        assert.equal(binding.changedValueOf(stored), "first");
      },
    ],
    [
      "a swap on a row deleted since the read loses and inserts nothing",
      async ({ store }) => {
        const seeded = await binding.seed(store);
        const id = binding.idOf(seeded);
        const read = await store.readForWrite(id);
        assert.ok(read !== undefined);
        await binding.remove(store, id);
        assert.equal(await landed(store.swap(id, read.bytes, read.row)), false);
        assert.equal(await binding.read(store, id), undefined);
      },
    ],
    [
      "readForWrite and swap propagate an outage rather than answer absent or lost",
      async (fixture) => {
        const seeded = await binding.seed(fixture.store);
        const id = binding.idOf(seeded);
        const read = await fixture.store.readForWrite(id);
        assert.ok(read !== undefined);
        await fixture.disconnect();
        await assert.rejects(fixture.store.readForWrite(id));
        await assert.rejects(fixture.store.swap(id, read.bytes, read.row));
      },
    ],
  ];
}
