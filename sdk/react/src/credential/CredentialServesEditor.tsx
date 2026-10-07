"use client";

/**
 * "Use for…": the agents, MCP servers and git hosts a credential is used
 * for by default. A run of an agent reads its keys from the credential
 * serving that agent, an MCP server's from the one serving the server,
 * and a repository clone its token from the one serving the git host.
 *
 * Agents and MCP servers are picked from the organization's own lists, so
 * a target is always written with the organization's id and the slug the
 * resource carries: exactly the form the server compares. A git host is
 * typed ("github.com"). At most one of a person's credentials, and one of
 * the organization's, may serve a target; the server refuses a second,
 * naming the first, and the form shows that refusal.
 */
import { useCallback, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { useAgentList } from "../agent/useAgentList.js";
import { useMcpServerList } from "../mcp-server/useMcpServerList.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { GITHUB_HOST, targetRefKey, type CredentialTargetRef } from "./model.js";

/** Props for {@link CredentialServesEditor}. */
export interface CredentialServesEditorProps {
  /** The organization whose agents and MCP servers are offered (an id; a slug is also accepted). */
  readonly org: string;
  /** The targets the credential serves. */
  readonly value: readonly CredentialTargetRef[];
  /** Called with the new list when a target is added or removed. */
  readonly onChange: (next: CredentialTargetRef[]) => void;
  /** Disable every control (while a save is in flight). */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

type AddKind = "agent" | "mcp_server" | "git_host";

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Edits the list of targets a credential serves.
 *
 * @example
 * ```tsx
 * <CredentialServesEditor org={org} value={serves} onChange={setServes} />
 * ```
 */
export function CredentialServesEditor({
  org,
  value,
  onChange,
  disabled = false,
  className,
}: CredentialServesEditorProps) {
  const [adding, setAdding] = useState<AddKind | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const keys = useMemo(() => new Set(value.map(targetRefKey)), [value]);

  const add = useCallback(
    (target: CredentialTargetRef, name?: string) => {
      const key = targetRefKey(target);
      if (name) setNames((prev) => ({ ...prev, [key]: name }));
      if (!keys.has(key)) onChange([...value, target]);
      setAdding(null);
    },
    [keys, onChange, value],
  );

  const remove = useCallback(
    (key: string) => onChange(value.filter((target) => targetRefKey(target) !== key)),
    [onChange, value],
  );

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-2", className)}>
      {value.length === 0 ? (
        <p className="stg:text-xs stg:text-muted-foreground">
          Not used for anything by default. Pick what this is for, or assign it
          where you need it.
        </p>
      ) : (
        <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-wrap stg:gap-1.5")} aria-label="Used for">
          {value.map((target) => {
            const key = targetRefKey(target);
            const label = targetLabel(target, names[key]);
            return (
              <li
                key={key}
                className="stg:inline-flex stg:items-center stg:gap-1 stg:rounded-full stg:border stg:border-border stg:bg-muted-subtle stg:py-0.5 stg:pl-2 stg:pr-1 stg:text-xs stg:text-foreground"
              >
                <span className="stg:text-muted-foreground">{kindWord(target)}</span>
                <span className="stg:font-medium">{label}</span>
                <button
                  type="button"
                  onClick={() => remove(key)}
                  disabled={disabled}
                  aria-label={`Stop using for ${label}`}
                  className="stg:rounded-full stg:px-1 stg:text-muted-foreground stg:hover:text-foreground stg:disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding === null ? (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2 stg:text-xs">
          <span className="stg:text-muted-foreground">Use for</span>
          <AddButton onClick={() => setAdding("agent")} disabled={disabled}>an agent</AddButton>
          <AddButton onClick={() => setAdding("mcp_server")} disabled={disabled}>an MCP server</AddButton>
          <AddButton onClick={() => setAdding("git_host")} disabled={disabled}>a git host</AddButton>
        </div>
      ) : adding === "git_host" ? (
        <GitHostInput onAdd={(host) => add({ kind: "git_host", host })} onCancel={() => setAdding(null)} />
      ) : (
        <ResourceSearch
          org={org}
          kind={adding}
          taken={keys}
          onPick={(result) =>
            add({ kind: adding, org: result.org, slug: result.slug }, result.name || result.slug)
          }
          onCancel={() => setAdding(null)}
        />
      )}
    </div>
  );
}

function kindWord(target: CredentialTargetRef): string {
  switch (target.kind) {
    case "agent":
      return "Agent";
    case "mcp_server":
      return "MCP server";
    case "git_host":
      return "Git host";
    default: {
      const exhaustive: never = target;
      throw new Error(`unknown credential target: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function targetLabel(target: CredentialTargetRef, name: string | undefined): string {
  return target.kind === "git_host" ? target.host : name || target.slug;
}

function AddButton({
  onClick,
  disabled,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="stg:rounded-md stg:border stg:border-dashed stg:border-border stg:px-2 stg:py-0.5 stg:text-xs stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover stg:disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GitHostInput({
  onAdd,
  onCancel,
}: {
  readonly onAdd: (host: string) => void;
  readonly onCancel: () => void;
}) {
  const inputId = useId();
  const [host, setHost] = useState(GITHUB_HOST);
  const trimmed = host.trim().toLowerCase();
  const valid = HOST_PATTERN.test(trimmed);
  return (
    <div className="stg:flex stg:items-center stg:gap-2">
      <label htmlFor={inputId} className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
        Git host
      </label>
      <input
        id={inputId}
        type="text"
        value={host}
        onChange={(e) => setHost(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) {
            e.preventDefault();
            onAdd(trimmed);
          }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="github.com"
        autoFocus
        className={cn(INPUT_CLASSES, "stg:font-mono")}
      />
      <button
        type="button"
        onClick={() => onAdd(trimmed)}
        disabled={!valid}
        className="stg:rounded-md stg:bg-primary stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-primary-foreground stg:hover:bg-primary-hover stg:disabled:opacity-40"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="stg:rounded-md stg:px-2 stg:py-1 stg:text-xs stg:text-muted-foreground stg:hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function ResourceSearch({
  org,
  kind,
  taken,
  onPick,
  onCancel,
}: {
  readonly org: string;
  readonly kind: "agent" | "mcp_server";
  readonly taken: ReadonlySet<string>;
  readonly onPick: (result: SearchResult) => void;
  readonly onCancel: () => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const listOptions = useMemo(() => ({ query: query.trim(), pageSize: 8 }), [query]);
  const agents = useAgentList(kind === "agent" ? org : null, listOptions);
  const servers = useMcpServerList(kind === "mcp_server" ? org : null, listOptions);
  const results = kind === "agent" ? agents.agents : servers.mcpServers;
  const isLoading = kind === "agent" ? agents.isLoading : servers.isLoading;
  const noun = kind === "agent" ? "agent" : "MCP server";

  return (
    <div className="stg:flex stg:flex-col stg:gap-1.5">
      <div className="stg:flex stg:items-center stg:gap-2">
        <label htmlFor={inputId} className="stg:sr-only">
          Find an {noun}
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          placeholder={`Find an ${noun}`}
          autoFocus
          className={INPUT_CLASSES}
        />
        <button
          type="button"
          onClick={onCancel}
          className="stg:rounded-md stg:px-2 stg:py-1 stg:text-xs stg:text-muted-foreground stg:hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      {isLoading ? (
        <p className="stg:text-xs stg:text-muted-foreground">Searching…</p>
      ) : results.length === 0 ? (
        <p className="stg:text-xs stg:text-muted-foreground">No {noun}s match.</p>
      ) : (
        <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:rounded-md stg:border stg:border-border")} aria-label={`${noun}s`}>
          {results.map((result) => {
            const key = targetRefKey({ kind, org: result.org, slug: result.slug });
            const isTaken = taken.has(key);
            return (
              <li key={result.id || key}>
                <button
                  type="button"
                  onClick={() => onPick(result)}
                  disabled={isTaken}
                  className="stg:flex stg:w-full stg:items-baseline stg:justify-between stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-left stg:text-xs stg:hover:bg-accent-hover stg:disabled:opacity-50"
                >
                  <span className="stg:font-medium stg:text-foreground">{result.name || result.slug}</span>
                  <span className="stg:font-mono stg:text-muted-foreground">
                    {isTaken ? "already added" : result.slug}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
