/**
 * Test fixtures for the identity-account domain: an in-memory
 * IdentityAccountStore with the primary-key semantics the OSS adapter has
 * (a second save under a held id is DuplicateAccountError), so provisioning
 * and verifier tests exercise the port's contract without a store driver.
 * Driver-backed fixtures live with the drivers (the sqlite and postgres
 * __tests__/support modules under src/store).
 */
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { DuplicateAccountError } from "../store.js";
import type { IdentityAccountStore } from "../store.js";

export interface FakeIdentityAccountStore extends IdentityAccountStore {
  readonly rows: Map<string, IdentityAccount>;
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
    async update(account) {
      rows.set(account.metadata?.id ?? "", account);
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
  };
}
