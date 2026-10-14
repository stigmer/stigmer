"use client";

// The list of MCP servers an agent writes itself, and, while editing, the
// form that adds or changes one. Two hosts render it and must read alike:
// the agent page's "MCP servers" section, where each change is a save, and
// the new-agent wizard, where each change updates the draft. Either way a
// change hands the host the whole list, untouched servers as they were, so
// the server's admin check sees them as echoes. A row shows the server's
// name, its URL, the headers it is sent with (a value that only names keys
// shown, any other read as "set": `agentMcpServers.ts`) and whatever the
// host puts beside it. The form checks what the console can see before it
// hands the list on (`agentMcpServerProblem`); the host shows a refusal.
// Pinned by `__tests__/AgentDetailView.mcpServers.test.tsx` and
// `steps/__tests__/CapabilitiesStep.test.tsx`.

import { type ReactNode, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { Button } from "../button/Button.js";
import { INPUT_CLASS } from "../vault/styles.js";
import { McpServerIcon } from "../plugin/McpServerIcon.js";
import { type HeaderRow, HeaderRowsEditor, headerRowsOf } from "../plugin/HeaderRowsEditor.js";
import { type AgentMcpServerValue, agentMcpServerProblem, headerValueShown } from "./agentMcpServers.js";

/** Props for {@link AgentMcpServerList}. */
export interface AgentMcpServerListProps {
  readonly servers: readonly AgentMcpServerValue[];
  /** When `true`, each row can be changed or removed, and a server added. */
  readonly editing: boolean;
  readonly isSaving?: boolean;
  /** Hands the host the whole list after a change. Resolves to whether it was kept; a form closes only then. */
  readonly onChange: (servers: AgentMcpServerValue[]) => Promise<boolean> | boolean;
  /** What the host shows beside a row's name (the agent page: the viewer's login at its address). */
  readonly renderStatus?: (server: AgentMcpServerValue) => ReactNode;
  /** The words shown when there is no server. */
  readonly emptyText: string;
}

/** Lists an agent's own MCP servers and, while editing, adds, changes and removes them. */
export function AgentMcpServerList({ servers, editing, isSaving, onChange, renderStatus, emptyText }: AgentMcpServerListProps) {
  // The form open: a new server, or the row at an index being changed.
  const [open, setOpen] = useState<"new" | number | null>(null);
  const isOpen = editing ? open : null;

  const save = useCallback(
    async (next: AgentMcpServerValue[]) => {
      if (await onChange(next)) setOpen(null);
    },
    [onChange],
  );

  return (
    <div className="stg:flex stg:flex-col">
      {servers.length > 0 ? (
        <ul className="stg:m-0 stg:flex stg:list-none stg:flex-col stg:divide-y stg:divide-border stg:p-0" aria-label="MCP servers">
          {servers.map((server, index) =>
            isOpen === index ? (
              <li key={server.name} className="stg:px-3 stg:py-3">
                <AgentMcpServerForm
                  initial={server}
                  others={servers.filter((_, i) => i !== index).map((s) => s.name)}
                  isSaving={isSaving}
                  submitLabel="Save"
                  onSubmit={(changed) => save(servers.map((s, i) => (i === index ? changed : s)))}
                  onCancel={() => setOpen(null)}
                />
              </li>
            ) : (
              <ServerRow
                key={server.name}
                server={server}
                status={renderStatus?.(server)}
                canEdit={editing && isOpen === null}
                isSaving={isSaving}
                onEdit={() => setOpen(index)}
                onRemove={() => void save(servers.filter((_, i) => i !== index))}
              />
            ),
          )}
        </ul>
      ) : (
        <p className="stg:px-3 stg:py-3 stg:text-xs stg:text-muted-foreground stg:italic">{emptyText}</p>
      )}

      {editing && (
        <div className="stg:border-t stg:border-border stg:px-3 stg:py-2">
          {isOpen === "new" ? (
            <AgentMcpServerForm
              others={servers.map((s) => s.name)}
              isSaving={isSaving}
              submitLabel="Add"
              onSubmit={(added) => save([...servers, added])}
              onCancel={() => setOpen(null)}
            />
          ) : (
            isOpen === null && (
              <button
                type="button"
                onClick={() => setOpen("new")}
                className={cn(
                  "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                  "stg:border stg:border-dashed stg:border-border stg:text-muted-foreground",
                  "stg:hover:border-muted-foreground stg:hover:text-foreground stg:hover:bg-muted-subtle",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  "stg:transition-colors",
                )}
              >
                <PlusIcon className="stg:size-3" />
                Add MCP server
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One server
// ---------------------------------------------------------------------------

function ServerRow({
  server,
  status,
  canEdit,
  isSaving,
  onEdit,
  onRemove,
}: {
  readonly server: AgentMcpServerValue;
  readonly status: ReactNode;
  readonly canEdit: boolean;
  readonly isSaving?: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}) {
  const headers = Object.entries(server.headers);
  return (
    <li className="stg:flex stg:flex-col stg:gap-1 stg:px-3 stg:py-2">
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-1">
        <span className="stg:flex stg:min-w-0 stg:items-center stg:gap-3">
          <McpServerIcon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
          <span className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">{server.name}</span>
        </span>
        <span className="stg:ml-auto stg:flex stg:min-w-0 stg:items-center stg:gap-2">
          {status}
          {canEdit && (
            <>
              <Button type="button" variant="ghost" size="xs" onClick={onEdit} disabled={isSaving} aria-label={`Change ${server.name}`}>
                Change
              </Button>
              <button
                type="button"
                onClick={onRemove}
                disabled={isSaving}
                aria-label={`Remove ${server.name}`}
                className={cn(
                  "stg:inline-flex stg:size-6 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground",
                  "stg:hover:bg-destructive-subtle stg:hover:text-destructive",
                  "stg:disabled:opacity-50",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                <XIcon className="stg:size-3.5" />
              </button>
            </>
          )}
        </span>
      </div>
      <p className="stg:break-all stg:pl-7 stg:font-mono stg:text-xs stg:text-muted-foreground">{server.url}</p>
      {headers.length > 0 && (
        <dl className="stg:m-0 stg:flex stg:flex-col stg:gap-0.5 stg:pl-7 stg:text-xs" aria-label={`Headers ${server.name} is sent with`}>
          {headers.map(([header, value]) => (
            <div key={header} className="stg:flex stg:min-w-0 stg:gap-2">
              <dt className="stg:shrink-0 stg:font-mono stg:text-foreground">{header}</dt>
              <dd className="stg:m-0 stg:min-w-0 stg:break-all stg:font-mono stg:text-muted-foreground">{headerValueShown(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The form for one server
// ---------------------------------------------------------------------------

function AgentMcpServerForm({
  initial,
  others,
  isSaving,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly initial?: AgentMcpServerValue;
  /** The names of the agent's other servers, each taken. */
  readonly others: readonly string[];
  readonly isSaving?: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (server: AgentMcpServerValue) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const baseId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [headers, setHeaders] = useState<readonly HeaderRow[]>(() => headerRowsOf(initial?.headers ?? {}));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = () => {
    const entries = headers.map((row): [string, string] => [row.key.trim(), row.value]);
    const draft = { name: name.trim(), url: url.trim(), headers: entries };
    const found = agentMcpServerProblem(draft, others);
    setProblem(found);
    if (found !== null) return;
    void onSubmit({ ...draft, headers: Object.fromEntries(entries) });
  };

  return (
    <div role="group" aria-label={initial ? `Change ${initial.name}` : "New MCP server"} className="stg:flex stg:flex-col stg:gap-3">
      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-name`} className="stg:text-xs stg:font-medium stg:text-foreground">
          Name
        </label>
        <input
          id={`${baseId}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="zendesk"
          autoComplete="off"
          spellCheck={false}
          disabled={isSaving}
          className={INPUT_CLASS}
        />
        <p className="stg:text-xs stg:text-muted-foreground">
          Lowercase letters, digits and hyphens. Its tools are named <code className="stg:font-mono">{"mcp__<name>__<tool>"}</code>.
        </p>
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
          placeholder="https://acme-co.zendesk.com/mcp"
          autoComplete="off"
          spellCheck={false}
          disabled={isSaving}
          className={INPUT_CLASS}
        />
      </div>

      <HeaderRowsEditor rows={headers} onChange={setHeaders} disabled={isSaving} />

      {problem !== null && (
        <p role="alert" className="stg:text-xs stg:text-destructive">
          {problem}
        </p>
      )}

      <div className="stg:flex stg:justify-end stg:gap-2">
        <Button type="button" variant="outline" size="xs" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" size="xs" onClick={submit} disabled={isSaving}>
          {isSaving ? "Saving…" : submitLabel}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons: inline SVGs, as the agent page draws them
// ---------------------------------------------------------------------------

function PlusIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function XIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
