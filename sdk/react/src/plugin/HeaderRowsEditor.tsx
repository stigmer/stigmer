"use client";

/**
 * The rows of headers an MCP server is sent with, each a name and a value,
 * added and removed in place. Two forms use it and must read alike: the
 * "Add MCP server" dialog, which installs a plugin of one server, and the
 * form for an MCP server an agent writes itself. A header's value may name
 * a key as `${NAME}`; the editor says so once, under the rows, rather than
 * validating names: the save that follows judges them.
 *
 * Controlled: the host holds the rows and their ids, so a row keeps its
 * identity (and its inputs their focus) while its neighbours come and go.
 *
 * Pinned by `__tests__/AddMcpServerDialog.test.tsx` and
 * `../agent/__tests__/AgentDetailView.mcpServers.test.tsx`.
 */

import { cn } from "@stigmer/theme";
import { Button } from "../button/Button.js";
import { INPUT_CLASS } from "../vault/styles.js";

/** One header being edited: its name and value, under an id stable for the edit. */
export interface HeaderRow {
  readonly id: number;
  readonly key: string;
  readonly value: string;
}

/** Props for {@link HeaderRowsEditor}. */
export interface HeaderRowsEditorProps {
  readonly rows: readonly HeaderRow[];
  /** Called with the rows after every change. */
  readonly onChange: (rows: readonly HeaderRow[]) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** `headers` as rows, in their order, numbered from 1. */
export function headerRowsOf(headers: Readonly<Record<string, string>>): HeaderRow[] {
  return Object.entries(headers).map(([key, value], index) => ({ id: index + 1, key, value }));
}

/**
 * Edits the headers an MCP server is sent with.
 *
 * @example
 * ```tsx
 * const [rows, setRows] = useState<readonly HeaderRow[]>([]);
 * <HeaderRowsEditor rows={rows} onChange={setRows} />
 * ```
 */
export function HeaderRowsEditor({ rows, onChange, disabled = false, className }: HeaderRowsEditorProps) {
  const nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  return (
    <fieldset className={cn("stg:space-y-1.5", className)}>
      <legend className="stg:text-xs stg:font-medium stg:text-muted-foreground">
        Headers <span className="stg:text-muted-foreground-subtle">(optional)</span>
      </legend>
      {rows.map((row) => (
        <div key={row.id} className="stg:flex stg:items-center stg:gap-2">
          <input
            aria-label="Header name"
            value={row.key}
            onChange={(event) => onChange(rows.map((h) => (h.id === row.id ? { ...h, key: event.target.value } : h)))}
            placeholder="Authorization"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className={INPUT_CLASS}
          />
          <input
            aria-label="Header value"
            value={row.value}
            onChange={(event) => onChange(rows.map((h) => (h.id === row.id ? { ...h, value: event.target.value } : h)))}
            placeholder="Bearer ${LINEAR_API_KEY}"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className={INPUT_CLASS}
          />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => onChange(rows.filter((h) => h.id !== row.id))}
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
        disabled={disabled}
        onClick={() => onChange([...rows, { id: nextId, key: "", value: "" }])}
      >
        Add header
      </Button>
      <p className="stg:text-xs stg:text-muted-foreground">
        Write a key as <code className="stg:font-mono">{"${NAME}"}</code>, never its value: each conversation that uses the server asks for it and
        reads it from a vault.
      </p>
    </fieldset>
  );
}
