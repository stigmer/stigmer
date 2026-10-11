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
 * backdrop, so what was typed is never lost to a stray click. A header's
 * value may name a key as `${NAME}`; the form says so once, under the
 * headers, rather than validating names the reader checks anyway.
 */

import { type FormEvent, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogShell } from "../internal/DialogShell.js";
import { INPUT_CLASS } from "../vault/styles.js";
import { PrepareRefusal } from "./InstallPreview.js";
import { PluginReadRefusal } from "./sources/read.js";
import { useAddMcpServer } from "./useAddMcpServer.js";

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

interface HeaderRow {
  readonly id: number;
  readonly key: string;
  readonly value: string;
}

/**
 * Adds an MCP server at an address as a plugin of one server.
 *
 * @example
 * ```tsx
 * <AddMcpServerDialog
 *   org={org}
 *   open={adding}
 *   onClose={() => setAdding(false)}
 *   onAdded={(plugin) => navigateToDetail("plugins", org, plugin.metadata?.slug ?? "")}
 * />
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
  const [nextId, setNextId] = useState(1);
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
    <form onSubmit={handleSubmit} className="stg:flex stg:max-h-[85vh] stg:flex-col stg:gap-4 stg:overflow-y-auto stg:p-6">
      <header>
        <h2 id={titleId} className="stg:text-base stg:font-semibold stg:text-foreground">
          Add MCP server
        </h2>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
          Installs a plugin of this one server. A chat or an agent that uses the plugin gets the server&apos;s tools; if the server asks you to sign
          in, its plugin page says so.
        </p>
      </header>

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-name`} className="stg:text-xs stg:font-medium stg:text-foreground">
          Name
        </label>
        <input
          id={`${baseId}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="linear"
          autoComplete="off"
          spellCheck={false}
          disabled={isAdding}
          className={INPUT_CLASS}
        />
        <p className="stg:text-xs stg:text-muted-foreground">Lowercase letters, digits, dots and hyphens. The plugin is named after it.</p>
      </div>

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-url`} className="stg:text-xs stg:font-medium stg:text-foreground">
          URL
        </label>
        <input
          id={`${baseId}-url`}
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://mcp.linear.app/mcp"
          autoComplete="off"
          spellCheck={false}
          disabled={isAdding}
          className={INPUT_CLASS}
        />
      </div>

      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-description`} className="stg:text-xs stg:font-medium stg:text-muted-foreground">
          Description <span className="stg:text-muted-foreground-subtle">(optional)</span>
        </label>
        <input
          id={`${baseId}-description`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={isAdding}
          className={INPUT_CLASS}
        />
      </div>

      <fieldset className="stg:space-y-1.5">
        <legend className="stg:text-xs stg:font-medium stg:text-muted-foreground">
          Headers <span className="stg:text-muted-foreground-subtle">(optional)</span>
        </legend>
        {headers.map((row) => (
          <div key={row.id} className="stg:flex stg:items-center stg:gap-2">
            <input
              aria-label="Header name"
              value={row.key}
              onChange={(event) => setHeaders(headers.map((h) => (h.id === row.id ? { ...h, key: event.target.value } : h)))}
              placeholder="Authorization"
              autoComplete="off"
              spellCheck={false}
              disabled={isAdding}
              className={INPUT_CLASS}
            />
            <input
              aria-label="Header value"
              value={row.value}
              onChange={(event) => setHeaders(headers.map((h) => (h.id === row.id ? { ...h, value: event.target.value } : h)))}
              placeholder="Bearer ${LINEAR_API_KEY}"
              autoComplete="off"
              spellCheck={false}
              disabled={isAdding}
              className={INPUT_CLASS}
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={isAdding}
              onClick={() => setHeaders(headers.filter((h) => h.id !== row.id))}
              aria-label={`Remove header ${row.key || "row"}`}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={isAdding}
          onClick={() => {
            setHeaders([...headers, { id: nextId, key: "", value: "" }]);
            setNextId(nextId + 1);
          }}
        >
          Add header
        </Button>
        <p className="stg:text-xs stg:text-muted-foreground">
          Write a key as <code className="stg:font-mono">{"${NAME}"}</code>, never its value: each conversation that uses the server asks for it and
          reads it from a vault.
        </p>
      </fieldset>

      {error instanceof PluginReadRefusal ? (
        <PrepareRefusal error={error} />
      ) : (
        error && <ErrorMessage error={error} title="The server could not be added" />
      )}

      <footer className="stg:flex stg:justify-end stg:gap-2 stg:pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isAdding}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
          {isAdding ? "Adding…" : "Add"}
        </Button>
      </footer>
    </form>
  );
}
