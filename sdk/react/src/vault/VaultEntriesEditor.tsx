"use client";

/**
 * The write-only editor over one vault's entries: secrets by name and
 * logins by address. It shows what a vault holds (names, addresses, what
 * each is for, how a login was saved and when it expires) and lets a person
 * add, replace and remove entries. It never shows a value: no read returns
 * one, and a replace asks for the new value from scratch. A remove asks
 * first, since a removed value cannot be read back to restore it.
 *
 * Presentational: the host passes the vault and the four writes, so the
 * same editor serves My vault (useMyVault) and a shared vault
 * (useVaultEntries).
 */
import { type FormEvent, type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import {
  VaultConnectionSource,
  type VaultConnection,
  type VaultSecret,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { normalizeAddress } from "./address.js";
import {
  DANGER_BUTTON_CLASS,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
} from "./styles.js";

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Props for {@link VaultEntriesEditor}. */
export interface VaultEntriesEditorProps {
  /** The vault as read (values blanked), or `null` before My vault's first save. */
  readonly vault: Vault | null;
  /** Save secrets by name. */
  readonly onSetSecrets: (
    secrets: Record<string, { value: string; description?: string }>,
  ) => Promise<unknown>;
  /** Remove secrets by name. */
  readonly onRemoveSecrets: (names: readonly string[]) => Promise<unknown>;
  /** Save a login at an address. */
  readonly onSetConnection: (
    address: string,
    token: string,
    description?: string,
  ) => Promise<unknown>;
  /** Remove logins by address. */
  readonly onRemoveConnections: (addresses: readonly string[]) => Promise<unknown>;
  /** `true` while a write is in flight. */
  readonly isMutating?: boolean;
  /** Show the entries without write controls. */
  readonly readOnly?: boolean;
  /**
   * An extra control beside a login, such as "Sign in again" for one a
   * sign-in saved. Rendered for every login, read-only or not.
   */
  readonly connectionAction?: (address: string, connection: VaultConnection) => ReactNode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

function savedLine(at: VaultSecret["savedAt"]): string {
  return at ? `Saved ${timestampDate(at).toLocaleDateString()}` : "";
}

function connectionLine(connection: VaultConnection): string {
  if (connection.source !== VaultConnectionSource.sign_in) {
    return ["Pasted token", savedLine(connection.savedAt)].filter(Boolean).join(" · ");
  }
  const expires = Number(connection.signIn?.expiresAt ?? 0);
  const expiry =
    expires === 0
      ? "does not expire"
      : `renewed automatically (expires ${new Date(expires * 1000).toLocaleString()})`;
  return `Signed in · ${expiry}`;
}

/**
 * Write-only editor for a vault's secrets and logins.
 *
 * @example
 * ```tsx
 * const myVault = useMyVault(org);
 * <VaultEntriesEditor
 *   vault={myVault.vault}
 *   onSetSecrets={myVault.setSecrets}
 *   onRemoveSecrets={myVault.removeSecrets}
 *   onSetConnection={myVault.setConnection}
 *   onRemoveConnections={myVault.removeConnections}
 *   isMutating={myVault.isMutating}
 * />
 * ```
 */
export function VaultEntriesEditor({
  vault,
  onSetSecrets,
  onRemoveSecrets,
  onSetConnection,
  onRemoveConnections,
  isMutating = false,
  readOnly = false,
  connectionAction,
  className,
}: VaultEntriesEditorProps) {
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (write: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await write();
      return true;
    } catch (err) {
      setError(getUserMessage(err));
      return false;
    }
  }, []);

  const secrets = useMemo(
    () =>
      Object.entries(vault?.spec?.secrets ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [vault],
  );
  const connections = useMemo(
    () =>
      Object.entries(vault?.spec?.connections ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [vault],
  );

  return (
    <div className={cn("stg:space-y-5", className)}>
      <section aria-label="Secrets" className="stg:space-y-2">
        <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">Secrets</h3>
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Matched by name, such as OPENAI_API_KEY. Saved values are never shown again.
        </p>
        {secrets.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">No secrets saved.</p>
        ) : (
          <ul className={cn(UNSTYLED_LIST, "stg:space-y-1.5")}>
            {secrets.map(([name, secret]) => (
              <EntryRow
                key={name}
                title={name}
                mono
                detail={[secret.description, savedLine(secret.savedAt)].filter(Boolean).join(" · ")}
                readOnly={readOnly}
                disabled={isMutating}
                replaceLabel={`New value for ${name}`}
                onReplace={(value) => run(() => onSetSecrets({ [name]: { value, description: secret.description } }))}
                onRemove={() => run(() => onRemoveSecrets([name]))}
              />
            ))}
          </ul>
        )}
        {!readOnly && (
          <AddSecretForm
            disabled={isMutating}
            onAdd={(name, value, description) =>
              run(() => onSetSecrets({ [name]: { value, description } }))
            }
          />
        )}
      </section>

      <section aria-label="Logins" className="stg:space-y-2">
        <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">Logins</h3>
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Matched by the address of the tool or Git host they are for, such as
          https://mcp.linear.app/mcp or github.com.
        </p>
        {connections.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">No logins saved.</p>
        ) : (
          <ul className={cn(UNSTYLED_LIST, "stg:space-y-1.5")}>
            {connections.map(([address, connection]) => (
              <EntryRow
                key={address}
                title={address}
                detail={[connection.description, connectionLine(connection)].filter(Boolean).join(" · ")}
                readOnly={readOnly}
                disabled={isMutating}
                replaceLabel={`New token for ${address}`}
                onReplace={(token) => run(() => onSetConnection(address, token, connection.description))}
                onRemove={() => run(() => onRemoveConnections([address]))}
                extra={connectionAction?.(address, connection)}
              />
            ))}
          </ul>
        )}
        {!readOnly && (
          <AddConnectionForm
            disabled={isMutating}
            onAdd={(address, token, description) =>
              run(() => onSetConnection(address, token, description))
            }
          />
        )}
      </section>

      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function EntryRow({
  title,
  detail,
  mono = false,
  readOnly,
  disabled,
  replaceLabel,
  onReplace,
  onRemove,
  extra,
}: {
  readonly extra?: ReactNode;
  readonly title: string;
  readonly detail: string;
  readonly mono?: boolean;
  readonly readOnly: boolean;
  readonly disabled: boolean;
  readonly replaceLabel: string;
  readonly onReplace: (value: string) => Promise<boolean>;
  readonly onRemove: () => Promise<boolean>;
}) {
  const [replacing, setReplacing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [value, setValue] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (value === "") return;
    if (await onReplace(value)) {
      setValue("");
      setReplacing(false);
    }
  };

  return (
    <li className="stg:rounded-md stg:border stg:border-border-muted stg:px-3 stg:py-2">
      <div className="stg:flex stg:items-center stg:gap-2">
        <div className="stg:min-w-0 stg:flex-1">
          <span className={cn("stg:block stg:truncate stg:text-xs stg:font-medium stg:text-foreground", mono && "stg:font-mono")}>
            {title}
          </span>
          {detail && (
            <span className="stg:block stg:truncate stg:text-[0.65rem] stg:text-muted-foreground">{detail}</span>
          )}
        </div>
        {extra}
        {!readOnly && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setConfirmingRemove(false);
                setReplacing((r) => !r);
              }}
              className={QUIET_BUTTON_CLASS}
            >
              Replace
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setReplacing(false);
                setConfirmingRemove(true);
              }}
              aria-label={`Remove ${title}`}
              className={DANGER_BUTTON_CLASS}
            >
              Remove
            </button>
          </>
        )}
      </div>
      {confirmingRemove && (
        <div role="group" aria-label={`Confirm removing ${title}`} className="stg:mt-2 stg:space-y-2">
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            Remove {title}? Its value cannot be read back, so it cannot be restored; you would enter it again.
          </p>
          <div className="stg:flex stg:items-center stg:gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setConfirmingRemove(false);
                void onRemove();
              }}
              className={DANGER_BUTTON_CLASS}
            >
              Remove
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setConfirmingRemove(false)}
              className={QUIET_BUTTON_CLASS}
            >
              Keep
            </button>
          </div>
        </div>
      )}
      {replacing && (
        <form onSubmit={submit} className="stg:mt-2 stg:flex stg:items-center stg:gap-2">
          <input
            type="password"
            aria-label={replaceLabel}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            disabled={disabled}
            className={INPUT_CLASS}
            autoFocus
          />
          <button type="submit" disabled={disabled || value === ""} className={PRIMARY_BUTTON_CLASS}>
            Save
          </button>
        </form>
      )}
    </li>
  );
}

function AddSecretForm({
  disabled,
  onAdd,
}: {
  readonly disabled: boolean;
  readonly onAdd: (name: string, value: string, description: string) => Promise<boolean>;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const trimmed = name.trim();
  const nameValid = trimmed === "" || SECRET_NAME.test(trimmed);
  const canSubmit = trimmed !== "" && nameValid && value !== "" && !disabled;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (await onAdd(trimmed, value, description.trim())) {
      setName("");
      setValue("");
      setDescription("");
    }
  };

  return (
    <form onSubmit={submit} aria-label="Add a secret" className="stg:grid stg:grid-cols-1 stg:gap-2 stg:sm:grid-cols-[1fr_1fr_1fr_auto]">
      <input
        id={`${id}-name`}
        aria-label="Secret name"
        placeholder="NAME"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={disabled}
        className={cn(INPUT_CLASS, "stg:font-mono")}
        aria-invalid={!nameValid}
      />
      <input
        type="password"
        aria-label="Secret value"
        placeholder="Value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        disabled={disabled}
        className={INPUT_CLASS}
      />
      <input
        aria-label="Secret description"
        placeholder="What it is for (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={disabled}
        className={INPUT_CLASS}
      />
      <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON_CLASS}>
        Add
      </button>
      {!nameValid && (
        <p className="stg:col-span-full stg:text-destructive stg:text-[0.65rem]" role="alert">
          A name starts with a letter or underscore and holds only letters, digits and underscores.
        </p>
      )}
    </form>
  );
}

function AddConnectionForm({
  disabled,
  onAdd,
}: {
  readonly disabled: boolean;
  readonly onAdd: (address: string, token: string, description: string) => Promise<boolean>;
}) {
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [description, setDescription] = useState("");
  const normalized = address.trim() === "" ? null : normalizeAddress(address);
  const addressValid = address.trim() === "" || normalized !== null;
  const canSubmit = normalized !== null && token !== "" && !disabled;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || normalized === null) return;
    if (await onAdd(normalized, token, description.trim())) {
      setAddress("");
      setToken("");
      setDescription("");
    }
  };

  return (
    <form onSubmit={submit} aria-label="Add a login" className="stg:grid stg:grid-cols-1 stg:gap-2 stg:sm:grid-cols-[1fr_1fr_1fr_auto]">
      <input
        aria-label="Login address"
        placeholder="https://mcp.example.com/mcp or github.com"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        disabled={disabled}
        className={INPUT_CLASS}
        aria-invalid={!addressValid}
      />
      <input
        type="password"
        aria-label="Login token"
        placeholder="Token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
        disabled={disabled}
        className={INPUT_CLASS}
      />
      <input
        aria-label="Login description"
        placeholder="What it is for (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={disabled}
        className={INPUT_CLASS}
      />
      <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON_CLASS}>
        Add
      </button>
      {!addressValid && (
        <p className="stg:col-span-full stg:text-destructive stg:text-[0.65rem]" role="alert">
          Enter a tool&apos;s full URL (https://…) or a Git host such as github.com.
        </p>
      )}
    </form>
  );
}
