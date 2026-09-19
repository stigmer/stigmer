"use client";

/**
 * What a plugin would install, in the CLI's words, before the act.
 *
 * `stigmer validate -f` prints the plugin's name, version and format; what
 * it installs (skills, MCP servers, sub-agents, the variables its tools
 * will ask for); the reader's warnings; what is not installed. Every
 * console path that ends in a push shows the same facts through this one
 * component (the Marketplace's install dialog, the upload page's preview),
 * plus the fact the CLI states only after the act: whether the
 * organization already holds this exact version, or an earlier one an
 * install would replace. The reader's refusal is rendered here too, every
 * sentence, so a refused folder and a refused entry read alike.
 */

import { cn } from "@stigmer/theme";
import type { PluginPackage } from "@stigmer/plugin-package";
import { DIALECT_LABELS } from "@stigmer/plugin-package/client";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import type { InstallOrigin, PreparedInstall } from "./sources/read.js";
import { PluginReadRefusal } from "./sources/read.js";
import type { InstallRelation } from "./useInstallRelation.js";

/** Props for {@link InstallPreview}. */
export interface InstallPreviewProps {
  readonly prepared: PreparedInstall;
  /** How the archive relates to the org's plugin of the same name; `null` while unknown. */
  readonly relation: InstallRelation | null;
  readonly className?: string;
}

/** The `Plugin`, `Installs`, `Warnings` and `Not installed` blocks, then the relation sentence. */
export function InstallPreview({ prepared, relation, className }: InstallPreviewProps) {
  const { plugin } = prepared;
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-5", className)}>
      <Block title="Plugin">
        <Rows
          rows={[
            ["Name", plugin.name],
            ["Version", plugin.version ?? ""],
            ["Format", DIALECT_LABELS[plugin.dialect]],
            ["Files", `${prepared.stats.filesIncluded} read`],
          ]}
        />
      </Block>
      <Block title="Installs">
        <Rows
          rows={[
            ["Skills", named(plugin.skills.map((s) => s.name))],
            ["MCP servers", named(plugin.mcpServers.map((s) => `${s.name} (${s.transport})`))],
            ["Sub-agents", named(plugin.subAgents.map((a) => a.name))],
            [
              "Variables",
              named(
                plugin.variables.map(
                  (v) => `${v.name}${v.optional ? " (optional)" : ""}${v.declaredBy === "inferred" ? " (inferred)" : ""}`,
                ),
              ),
            ],
          ]}
        />
        {plugin.variables.length > 0 && (
          <p className="stg:mt-2 stg:text-xs stg:text-muted-foreground">
            The agent asks for these the first time you start a session on it, and saves them to your personal
            environment.
          </p>
        )}
      </Block>
      {prepared.warnings.length > 0 && (
        <Block title="Warnings">
          <ul className="stg:list-disc stg:space-y-1 stg:pl-5 stg:text-sm stg:text-foreground">
            {prepared.warnings.map((warning, index) => (
              <li key={`${warning.kind}:${index}`}>{warning.message}</li>
            ))}
          </ul>
        </Block>
      )}
      {plugin.ignored.length > 0 && (
        <Block title="Not installed">
          <ul className={cn(UNSTYLED_LIST, "stg:space-y-0.5 stg:text-sm stg:text-muted-foreground")}>
            {plugin.ignored.map((component) => (
              <li key={component.path}>
                {component.kind} <span className="stg:font-mono stg:text-xs">({component.path})</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      {relation && <RelationNotice relation={relation} name={plugin.name} />}
    </div>
  );
}

/** One line saying where the archive came from, for a preview's header. */
export function describeOrigin(origin: InstallOrigin): string {
  switch (origin.kind) {
    case "source":
      return origin.tree;
    case "upload":
      return origin.pick === "zip"
        ? `${origin.name}${origin.rerooted === undefined ? "" : ` (read from its '${origin.rerooted}/' folder)`}`
        : `the folder '${origin.name}'`;
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

function RelationNotice({ relation, name }: { readonly relation: InstallRelation; readonly name: string }) {
  switch (relation) {
    case "installed":
      return (
        <p role="status" className="stg:text-sm stg:text-muted-foreground">
          This exact version of '{name}' is already installed; there is nothing to do.
        </p>
      );
    case "upgrade":
      return (
        <p role="status" className="stg:text-sm stg:text-foreground">
          '{name}' is already installed at another version. Installing replaces its skills, servers and agent with
          this version's, whichever source it came from; the agent is re-created, so a session bound to the previous
          one does not follow.
        </p>
      );
    case "not-installed":
      return null;
    default: {
      const exhaustive: never = relation;
      return exhaustive;
    }
  }
}

/** The reader's refusal with every sentence, the way `validate -f` prints it; any other error as it is. */
export function PrepareRefusal({
  error,
  retry,
  hint,
}: {
  readonly error: Error;
  readonly retry?: () => void;
  /** A sentence the caller adds under the reader's, naming the path that would work. */
  readonly hint?: string;
}) {
  if (error instanceof PluginReadRefusal) {
    return (
      <div role="alert" className="stg:rounded-md stg:border stg:border-destructive stg:p-3 stg:text-sm">
        <p className="stg:font-medium stg:text-foreground">{error.subject}:</p>
        <ul className="stg:mt-1 stg:list-disc stg:space-y-0.5 stg:pl-5 stg:text-foreground">
          {error.errors.map((finding, index) => (
            <li key={`e${index}`}>{finding.message}</li>
          ))}
        </ul>
        {error.warnings.length > 0 && (
          <ul className="stg:mt-2 stg:list-disc stg:space-y-0.5 stg:pl-5 stg:text-muted-foreground">
            {error.warnings.map((finding, index) => (
              <li key={`w${index}`}>{finding.message}</li>
            ))}
          </ul>
        )}
        {hint && <p className="stg:mt-2 stg:text-muted-foreground">{hint}</p>}
      </div>
    );
  }
  return <ErrorMessage error={error} {...(retry && { retry })} title="The plugin could not be read" />;
}

function Block({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section>
      <h3 className="stg:mb-1.5 stg:text-xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
        {title}
      </h3>
      <div className="stg:rounded-md stg:border stg:border-border stg:p-3">{children}</div>
    </section>
  );
}

function Rows({ rows }: { readonly rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="stg:grid stg:grid-cols-[auto_1fr] stg:gap-x-4 stg:gap-y-1 stg:text-sm">
      {rows
        .filter(([, value]) => value !== "")
        .map(([label, value]) => (
          <div key={label} className="stg:contents">
            <dt className="stg:text-muted-foreground">{label}</dt>
            <dd className="stg:min-w-0 stg:break-words stg:text-foreground">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function named(items: readonly string[]): string {
  return items.length === 0 ? "none" : `${items.length}: ${items.join(", ")}`;
}
