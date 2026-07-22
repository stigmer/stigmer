import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { CursorAccountCommandController } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/command_pb";
import { CursorAccountQueryController } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/query_pb";
import {
  UpsertCursorAccountInputSchema,
  DeleteCursorAccountInputSchema,
  AddCursorMemberKeyInputSchema,
  RemoveCursorMemberKeyInputSchema,
  SetCursorMemberKeyEnabledInputSchema,
  SyncCursorAccountInputSchema,
  ListCursorAccountsInputSchema,
  GetCursorAccountViewInputSchema,
  type CursorAccountsResponse,
  type CursorAccountView,
} from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/io_pb";
import type { CursorAccount } from "@stigmer/protos/ai/stigmer/platform/cursoraccount/v1/cursor_account_pb";
import { wrapError } from "./gen/errors.js";

/** Parameters for creating or updating a Cursor account. */
export interface UpsertCursorAccountParams {
  /**
   * The account to create (empty `accountId`) or update. The admin key is
   * plaintext to set/rotate or `"***REDACTED***"` to keep the stored
   * value; member keys on this message are ignored — use
   * {@link CursorAccountsClient.addMemberKey} and friends.
   */
  readonly account: CursorAccount;
}

/** Parameters for deleting a Cursor account. */
export interface DeleteCursorAccountParams {
  readonly accountId: string;
  /**
   * Deletion is refused while live sessions are pinned to the account's
   * keys. `force: true` overrides — their Cursor agent handles will be
   * orphaned at disposal.
   */
  readonly force?: boolean;
}

/** Parameters for adding one member key. */
export interface AddCursorMemberKeyParams {
  readonly accountId: string;
  /**
   * Plaintext user-scoped Cursor API key. Validated live against Cursor's
   * `/v1/me` and bound to its owning team member server-side; admin and
   * service-account keys are rejected with Cursor's own explanation.
   */
  readonly apiKey: string;
  /** Optional operator label (e.g. `"zane — stigmer-prod"`). */
  readonly label?: string;
}

/** Parameters for removing one member key. */
export interface RemoveCursorMemberKeyParams {
  readonly accountId: string;
  readonly keyId: string;
  /**
   * Removal is refused while live sessions are pinned to this key.
   * `force: true` overrides — prefer disabling instead (always safe).
   */
  readonly force?: boolean;
}

/** Parameters for enabling/disabling one member key. */
export interface SetCursorMemberKeyEnabledParams {
  readonly accountId: string;
  readonly keyId: string;
  /**
   * `false` blocks NEW sessions immediately; sessions already pinned to
   * the key keep working (conversation continuity + disposal need it).
   */
  readonly enabled: boolean;
}

/**
 * Client for managed Cursor accounts (platform operators only).
 *
 * A Cursor account is one managed Cursor team: its Admin API key (roster
 * and spend, never executions), its member execution keys, and its org
 * assignments. Every method requires `can_manage_cursor_accounts` on
 * `platform:stigmer`; key material is always redacted in responses.
 */
export class CursorAccountsClient {
  private readonly command: Client<typeof CursorAccountCommandController>;
  private readonly query: Client<typeof CursorAccountQueryController>;

  constructor(transport: Transport) {
    this.command = createClient(CursorAccountCommandController, transport);
    this.query = createClient(CursorAccountQueryController, transport);
  }

  /** List all Cursor accounts with routing/sync summaries. */
  async listAccounts(): Promise<CursorAccountsResponse> {
    try {
      return await this.query.listCursorAccounts(
        create(ListCursorAccountsInputSchema, {}),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Retrieve one account's detail view: the redacted account, the latest
   * roster/spend snapshot, and the computed key-coverage join.
   */
  async getAccountView(accountId: string): Promise<CursorAccountView> {
    try {
      return await this.query.getCursorAccountView(
        create(GetCursorAccountViewInputSchema, { accountId }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Create or update a Cursor account. The admin key is validated live
   * against Cursor's `/teams/members` before persistence.
   */
  async upsertAccount(params: UpsertCursorAccountParams): Promise<CursorAccount> {
    try {
      return await this.command.upsertCursorAccount(
        create(UpsertCursorAccountInputSchema, { account: params.account }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Delete a Cursor account (guarded against live session pins). */
  async deleteAccount(params: DeleteCursorAccountParams): Promise<CursorAccount> {
    try {
      return await this.command.deleteCursorAccount(
        create(DeleteCursorAccountInputSchema, {
          accountId: params.accountId,
          force: params.force ?? false,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Add one execution-capable member key (identity bound via `/v1/me`). */
  async addMemberKey(params: AddCursorMemberKeyParams): Promise<CursorAccount> {
    try {
      return await this.command.addCursorMemberKey(
        create(AddCursorMemberKeyInputSchema, {
          accountId: params.accountId,
          apiKey: params.apiKey,
          label: params.label ?? "",
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Remove one member key (guarded against live session pins). */
  async removeMemberKey(params: RemoveCursorMemberKeyParams): Promise<CursorAccount> {
    try {
      return await this.command.removeCursorMemberKey(
        create(RemoveCursorMemberKeyInputSchema, {
          accountId: params.accountId,
          keyId: params.keyId,
          force: params.force ?? false,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Enable or disable one member key for new-session selection. */
  async setMemberKeyEnabled(
    params: SetCursorMemberKeyEnabledParams,
  ): Promise<CursorAccount> {
    try {
      return await this.command.setCursorMemberKeyEnabled(
        create(SetCursorMemberKeyEnabledInputSchema, {
          accountId: params.accountId,
          keyId: params.keyId,
          enabled: params.enabled,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Run an on-demand roster + spend sync and return the refreshed view.
   * Rate-limited upstream (Cursor Admin API) — debounce in UIs.
   */
  async syncAccount(accountId: string): Promise<CursorAccountView> {
    try {
      return await this.command.syncCursorAccount(
        create(SyncCursorAccountInputSchema, { accountId }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }
}
