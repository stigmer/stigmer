/**
 * Test fixtures for the identity-account domain: an in-memory
 * IdentityAccountStore with the primary-key semantics the OSS adapter has
 * (a second save under a held id is DuplicateAccountError, and a swap lands
 * only on the bytes it read), so provisioning
 * and verifier tests exercise the port's contract without a store driver.
 * Driver-backed fixtures live with the drivers (the sqlite and postgres
 * __tests__/support modules under src/store).
 */
import { clone, toBinary } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { DuplicateAccountError } from "../store.js";
import type { IdentityAccountStore } from "../store.js";

export interface FakeIdentityAccountStore extends IdentityAccountStore {
  readonly rows: Map<string, IdentityAccount>;
}

/** Whether two stored forms are the same bytes, as a driver's swap compares them. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

export function fakeIdentityAccountStore(): FakeIdentityAccountStore {
  const rows = new Map<string, IdentityAccount>();
  const byIdpId = (idpId: string): IdentityAccount | undefined =>
    [...rows.values()].find((row) => row.spec?.idpId === idpId);
  return {
    rows,
    async save(account) {
      const id = account.metadata?.id ?? "";
      if (rows.has(id)) {
        throw new DuplicateAccountError(
          `identity account '${id}' already exists`,
        );
      }
      rows.set(id, account);
    },
    async readForWrite(id) {
      const row = rows.get(id);
      return row === undefined
        ? undefined
        : {
            row: clone(IdentityAccountSchema, row),
            bytes: toBinary(IdentityAccountSchema, row),
          };
    },
    async swap(id, expectedBytes, next) {
      const row = rows.get(id);
      if (row === undefined || !sameBytes(toBinary(IdentityAccountSchema, row), expectedBytes)) {
        return false;
      }
      rows.set(id, next);
      return true;
    },
    async deleteById(id) {
      rows.delete(id);
    },
    async findById(id) {
      return rows.get(id);
    },
    async findByIdpId(idpId) {
      return byIdpId(idpId);
    },
    async findDirectByIdpId(idpId) {
      return byIdpId(idpId);
    },
    async findDirectByEmail(email) {
      return [...rows.values()].find((row) => row.spec?.email === email);
    },
    async findByIds(ids) {
      return ids.flatMap((id) => {
        const row = rows.get(id);
        return row === undefined ? [] : [row];
      });
    },
    async findByOrg(org) {
      return [...rows.values()].filter(
        (row) => org !== "" && row.metadata?.org === org,
      );
    },
    async findByProviderAndIdpId(providerId, idpId) {
      return [...rows.values()].find(
        (row) =>
          row.spec?.federationIssuerRef?.id === providerId &&
          row.spec.idpId === idpId,
      );
    },
    async findByProvider(providerId) {
      return [...rows.values()]
        .filter((row) => row.spec?.federationIssuerRef?.id === providerId)
        .sort((a, b) =>
          (a.metadata?.id ?? "").localeCompare(b.metadata?.id ?? ""),
        );
    },
  };
}
