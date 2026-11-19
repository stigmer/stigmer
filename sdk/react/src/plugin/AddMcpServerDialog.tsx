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
 */

import { type FormEvent, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
import { type HeaderRow, HeaderRowsEditor } from "./HeaderRowsEditor.js";
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

function AddMcpServerForm({
  org,
  titleId,
  onClose,
  onAdded,
}: {
  readonly org: string;
  readonly titleId: string;
  readonly onClose: () => void;
  readonly onAdded?: (plugin: Plugin) => void;
}) {
  const baseId = useId();
  const { add, isAdding, error } = useAddMcpServer();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [headers, setHeaders] = useState<readonly HeaderRow[]>([]);
  const canSubmit = name.trim() !== "" && url.trim() !== "" && !isAdding;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    void add(
      {
        name,
        url,
        description,
        headers: Object.fromEntries(headers.map((row) => [row.key, row.value])),
      },
      { org },
    ).then(
      (plugin) => onAdded?.(plugin),
      () => undefined,
    );
  };

  return (
    <form onSubmit={handleSubmit} className="stg:flex stg:max-h-[85vh] stg:flex-col stg:overflow-y-auto">
      <DialogHeader
        id={titleId}
        title="Add MCP server"
        description="Installs a plugin of this one server. A chat or an agent that uses the plugin gets the server's tools; if the server asks you to sign in, its plugin page says so."
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
        />
        <p className="stg:text-xs stg:text-muted-foreground">Lowercase letters, digits, dots and hyphens. The plugin is named after it.</p>
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
        error && <ErrorMessage error={error} title="Couldn't add the server." />
      )}

      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={isAdding}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {isAdding ? "Adding…" : "Add"}
        </Button>
      </DialogFooter>
    </form>
  );
}
