"use client";

/**
 * The keys a plugin reads, as its page lists them: each key's name and
 * kind, then how it is filled, whether My vault holds it, and a Save to My
 * vault form.
 *
 * How a key is filled is read the way the run reads it. A server that signs
 * in (`sign_in` on its entry) names its login key in its `Authorization:
 * Bearer ${KEY}` header (`toolLoginKeyOf`): a sign-in at the server's
 * address fills it, and a server that is not `oauth_only` also takes a
 * pasted key of that name. Every other key is pasted, into My vault or a
 * vault the conversation lists; a value the plugin sets is replaced by one
 * saved under the same name. A key both surfaces list is described in the
 * words `stigmer get plugin` prints; the terminal leaves out the names the
 * runner fills, which the page lists as filled by Stigmer. A name the runner fills itself is no key
 * the person gives.
 *
 * Only My vault is read and written (`useMyVault`), as the server rows
 * read it: a shared vault's values are the business of the conversations
 * that list it. Saved values are never shown, here as everywhere. Not
 * exported from the package: the plugin page is its one host.
 */

import { type FormEvent, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { EnvVarDeclaration } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { RUNNER_FILLED_VARIABLES } from "@stigmer/plugin-package";
import { toError } from "@stigmer/react-core/internal";
import { Button } from "../button/Button.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { TextInput } from "../internal/form/index.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { toolLoginKeyOf, vaultLoginServes } from "../vault/address.js";
import { useMyVault } from "../vault/useMyVault.js";

/** How one key is filled, from the plugin's servers. */
export type PluginKeySource =
  /** The runner fills it itself. */
  | { readonly kind: "runner" }
  /** A sign-in to `server` fills it; `pastable` when the server also takes a pasted key. */
  | { readonly kind: "sign-in"; readonly server: McpServerEntry; readonly pastable: boolean }
  /** It is pasted into a vault. */
  | { readonly kind: "paste" };

/** How `key` is filled, given the plugin's servers. */
export function pluginKeySource(key: string, servers: readonly McpServerEntry[]): PluginKeySource {
  if (RUNNER_FILLED_VARIABLES.has(key)) return { kind: "runner" };
  const server = servers.find((entry) => entry.signIn !== undefined && toolLoginKeyOf(entry) === key);
  if (server !== undefined) return { kind: "sign-in", server, pastable: server.signIn?.oauthOnly !== true };
  return { kind: "paste" };
}

/** The sentence that says how a key is filled. */
export function pluginKeyFilledBy(source: PluginKeySource, declaration: EnvVarDeclaration): string {
  // The words `stigmer get plugin` prints for the same key, in its order: a
  // value the plugin sets first.
  if (source.kind !== "runner" && declaration.value !== "") return "Set by the plugin.";
  switch (source.kind) {
    case "runner":
      return "Filled by Stigmer when a conversation runs.";
    case "sign-in":
      return `Filled when you sign in to ${source.server.name}${source.pastable ? ", or paste one." : "."}`;
    case "paste":
      return "Paste it into My vault, or a vault the conversation lists.";
    /* v8 ignore next -- @preserve: the exhaustiveness guard over PluginKeySource */
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

/** Props for {@link PluginKeys}. */
export interface PluginKeysProps {
  /** The organization whose My vault is read and written. */
  readonly org: string;
  /** The plugin's declared keys (`status.env`). */
  readonly env: Readonly<Record<string, EnvVarDeclaration>>;
  /** The plugin's servers (`status.mcp_servers`): which sign-in fills which key. */
  readonly servers: readonly McpServerEntry[];
}

/** The plugin's keys, each with how it is filled, whether it is saved, and Save to My vault. */
export function PluginKeys({ org, env, servers }: PluginKeysProps) {
  const myVault = useMyVault(org);
  const keys = Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
  const connections = myVault.vault?.spec?.connections ?? {};
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")} aria-label="Keys this plugin reads">
      {keys.map(([key, declaration]) => {
        const source = pluginKeySource(key, servers);
        const saved =
          myVault.secretNames.has(key) || (source.kind === "sign-in" && vaultLoginServes(connections, source.server));
        return (
          <PluginKeyRow
            key={key}
            name={key}
            declaration={declaration}
            source={source}
            saved={myVault.isLoading ? null : saved}
            onSave={(value) => myVault.setSecrets({ [key]: value }).then(() => undefined)}
          />
        );
      })}
    </ul>
  );
}

function PluginKeyRow({
  name,
  declaration,
  source,
  saved,
  onSave,
}: {
  readonly name: string;
  readonly declaration: EnvVarDeclaration;
  readonly source: PluginKeySource;
  /** Whether My vault fills it; `null` while My vault is read. */
  readonly saved: boolean | null;
  readonly onSave: (value: string) => Promise<void>;
}) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const savable = source.kind === "paste" || (source.kind === "sign-in" && source.pastable);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value === "" || isSaving) return;
    setIsSaving(true);
    setError(null);
    onSave(value).then(
      () => {
        setIsSaving(false);
        setOpen(false);
        setValue("");
      },
      (err: unknown) => {
        setIsSaving(false);
        setError(toError(err));
      },
    );
  };

  return (
    <li className="stg:flex stg:flex-col stg:gap-1 stg:px-3 stg:py-2 stg:text-sm">
      <div className="stg:flex stg:flex-wrap stg:items-start stg:justify-between stg:gap-2">
        <div className="stg:flex stg:min-w-0 stg:flex-col stg:gap-0.5">
          <span className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2">
            <code className="stg:font-mono stg:text-xs stg:text-foreground">{name}</code>
            <span className="stg:text-xs stg:text-muted-foreground">
              {[declaration.isSecret ? "secret" : "setting", declaration.optional ? "optional" : "required"].join(", ")}
            </span>
            {declaration.description && <span className="stg:text-xs stg:text-muted-foreground">{declaration.description}</span>}
          </span>
          <span className="stg:text-xs stg:text-muted-foreground">{pluginKeyFilledBy(source, declaration)}</span>
        </div>
        {source.kind !== "runner" && (
          <span className="stg:flex stg:shrink-0 stg:flex-wrap stg:items-center stg:justify-end stg:gap-2 stg:text-xs">
            {saved !== null && (
              <span className="stg:inline-flex" role="status">
                <StatusBadge phase={saved ? "ready" : "disabled"} label={saved ? "Saved in My vault" : "Not in My vault"} />
              </span>
            )}
            {savable && !open && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setOpen(true)}
                aria-expanded={open}
                aria-controls={formId}
                aria-label={`Save ${name} to My vault`}
              >
                Save to My vault
              </Button>
            )}
          </span>
        )}
      </div>
      {open && (
        <form id={formId} onSubmit={submit} className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
          <TextInput
            size="xs"
            type={declaration.isSecret ? "password" : "text"}
            aria-label={`Value of ${name}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={isSaving}
            autoFocus
            className="stg:min-w-0 stg:flex-1"
          />
          <Button type="submit" size="xs" disabled={isSaving || value === ""}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isSaving}
            onClick={() => {
              setOpen(false);
              setValue("");
              setError(null);
            }}
          >
            Cancel
          </Button>
          {error && (
            <span role="alert" className="stg:w-full stg:text-xs stg:text-destructive">
              {error.message}
            </span>
          )}
        </form>
      )}
    </li>
  );
}
