"use client";

/**
 * The console's "Add MCP server" form, in a dialog: a name, the server's
 * URL, what it is for, and the headers it is sent with. Submitting builds
 * a plugin of that one server in the browser and installs it
 * (`useAddMcpServer`); the reader's refusal is shown in its own sentences
 * (`PrepareRefusal`), the server's as an error. On success the host is
 * handed the plugin, and goes to its page, where the server signs in and
 * lists its tools like any plugin's.
 *
 * A form dialog, like the connect dialog: no light dismiss on the
 * backdrop, so what was typed is never lost to a stray click. The headers
 * are `HeaderRowsEditor`'s, which says once that a value names a key as
 * `${NAME}` rather than validating names the reader checks anyway.
 *
 * `ChangeMcpServerDialog` is the same form in its change mode, opened from
 * a one-server plugin's page: the name is fixed (it is part of every tool
 * name the plugin's agents use), the address, description and headers
 * start from the plugin's own files (`useOneServerPlugin`), and saving
 * pushes a new version at the plugin's visibility (`useAddMcpServer`'s
 * `change`). A form with nothing changed saves nothing: the two documents
 * it would write are compared with the plugin's, and Save stays off until
 * they differ. Not exported from the package: the plugin page is its one
 * host.
 */

import { type FormEvent, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { type OneServerPlugin, oneServerPluginDocuments } from "@stigmer/plugin-package";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
import { type HeaderRow, HeaderRowsEditor, headerRowsOf } from "./HeaderRowsEditor.js";
import { PrepareRefusal } from "./InstallPreview.js";
import { PluginReadRefusal } from "./sources/read.js";
import { useAddMcpServer } from "./useAddMcpServer.js";
import { FIELD_LABEL_CLASSES, TextInput } from "../internal/form/index.js";

/** Props for {@link AddMcpServerDialog}. */
export interface AddMcpServerDialogProps {
  /** The organization the server's plugin is installed into. */
  readonly org: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called with the installed plugin; the host usually opens its page. */
  readonly onAdded?: (plugin: Plugin) => void;
  readonly className?: string;
}

/**
 * Adds an MCP server at an address as a plugin of one server.
 *
 * @example
 * ```tsx
 * function AddServer({ onOpen }: { onOpen: (href: string) => void }) {
 *   const [adding, setAdding] = useState(false);
 *   return (
 *     <>
 *       <button onClick={() => setAdding(true)}>Add MCP server</button>
 *       <AddMcpServerDialog org="acme" open={adding} onClose={() => setAdding(false)} onAdded={(plugin) => onOpen(`/plugins/acme/${plugin.metadata?.slug}`)} />
 *     </>
 *   );
 * }
 * ```
 */
export function AddMcpServerDialog({ org, open, onClose, onAdded, className }: AddMcpServerDialogProps) {
  const titleId = useId();
  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="md"
      dismissOnBackdrop={false}
      className={cn("stg:max-h-[85vh] stg:bg-card stg:text-foreground", className)}
      aria-labelledby={titleId}
    >
      {open && <AddMcpServerForm org={org} titleId={titleId} onClose={onClose} onAdded={onAdded} />}
    </DialogShell>
  );
}

/** Props for {@link ChangeMcpServerDialog}. */
export interface ChangeMcpServerDialogProps {
  /** The installed one-server plugin, as the page read it. */
  readonly plugin: Plugin;
  /** Its server as its files say (`useOneServerPlugin`): what the form starts from. */
  readonly current: OneServerPlugin;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called with the new version once it is installed; the page reads the plugin again. */
  readonly onChanged?: (plugin: Plugin) => void;
  readonly className?: string;
}

/** Changes a one-server plugin's address, headers or description by pushing a new version. */
export function ChangeMcpServerDialog({ plugin, current, open, onClose, onChanged, className }: ChangeMcpServerDialogProps) {
  const titleId = useId();
  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="md"
      dismissOnBackdrop={false}
      className={cn("stg:max-h-[85vh] stg:bg-card stg:text-foreground", className)}
      aria-labelledby={titleId}
    >
      {open && (
        <AddMcpServerForm
          org={plugin.metadata?.org ?? ""}
          titleId={titleId}
          onClose={onClose}
          change={{ plugin, current }}
          onAdded={onChanged}
        />
      )}
    </DialogShell>
  );
}

function AddMcpServerForm({
  org,
  titleId,
  onClose,
  onAdded,
  change,
}: {
  readonly org: string;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onAdded?: (plugin: Plugin) => void;
  /** The change mode: the plugin replaced and the server it holds now. */
  readonly change?: { readonly plugin: Plugin; readonly current: OneServerPlugin };
}) {
  const baseId = useId();
  const { add, change: changeServer, isAdding, error } = useAddMcpServer();
  const current = change?.current;
  const [name, setName] = useState(current?.name ?? "");
  const [url, setUrl] = useState(current?.url ?? "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [headers, setHeaders] = useState<readonly HeaderRow[]>(() => headerRowsOf(current?.headers ?? {}));
  const input = { name, url, description, headers: Object.fromEntries(headers.map((row) => [row.key, row.value])) };
  const unchanged = current !== undefined && sameDocuments(oneServerPluginDocuments(input), oneServerPluginDocuments(current));
  const canSubmit = name.trim() !== "" && url.trim() !== "" && !isAdding && !unchanged;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const pushed = change !== undefined ? changeServer(input, { plugin: change.plugin }) : add(input, { org });
    void pushed.then(
      (plugin) => onAdded?.(plugin),
      () => undefined,
    );
  };

  return (
    <form onSubmit={handleSubmit} className="stg:flex stg:max-h-[85vh] stg:flex-col stg:overflow-y-auto">
      <DialogHeader
        id={titleId}
        title={change !== undefined ? `Change ${current?.name ?? ""}` : "Add MCP server"}
        description={
          change !== undefined
            ? "Agents and conversations that use it reach the new address from their next message. A login is kept per address, so you sign in again at the new one."
            : "Installs a plugin of this one server. A chat or an agent that uses the plugin gets the server's tools; if the server asks you to sign in, its plugin page says so."
        }
        onClose={onClose}
        closeDisabled={isAdding}
      />
      <DialogBody>

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-name`} className={FIELD_LABEL_CLASSES}>
          Name
        </label>
        <TextInput
          id={`${baseId}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="linear"
          autoComplete="off"
          spellCheck={false}
          disabled={isAdding}
          readOnly={change !== undefined}
        />
        <p className="stg:text-xs stg:text-muted-foreground">
          {change !== undefined
            ? "The name is part of every tool name its agents use, so it doesn't change."
            : "Lowercase letters, digits, dots and hyphens. The plugin is named after it."}
        </p>
      </div>

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-url`} className={FIELD_LABEL_CLASSES}>
          URL
        </label>
        <TextInput
          id={`${baseId}-url`}
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://mcp.linear.app/mcp"
          autoComplete="off"
          spellCheck={false}
          disabled={isAdding}
        />
      </div>

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-description`} className={FIELD_LABEL_CLASSES}>
          Description <span className="stg:text-muted-foreground">(optional)</span>
        </label>
        <TextInput
          id={`${baseId}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={isAdding}
        />
      </div>

      <HeaderRowsEditor rows={headers} onChange={setHeaders} disabled={isAdding} />

      {error instanceof PluginReadRefusal ? (
        <PrepareRefusal error={error} />
      ) : (
        error && <ErrorMessage error={error} title={change !== undefined ? "Couldn't change the server." : "Couldn't add the server."} />
      )}
      {unchanged && (
        <p className="stg:text-xs stg:text-muted-foreground" role="status">
          Change the address, the description or a header to save a new version.
        </p>
      )}

      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={isAdding}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {change !== undefined ? (isAdding ? "Saving…" : "Save") : isAdding ? "Adding…" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Whether two one-server plugins' documents are byte for byte the same. */
function sameDocuments(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([path, text]) => b.get(path) === text);
}
