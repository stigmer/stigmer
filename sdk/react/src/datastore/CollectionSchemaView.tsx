"use client";

import { cn } from "@stigmer/theme";
import { toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  FieldType,
  type CollectionDeclaration,
  type DatastoreAuthorization,
  type DatastoreSpec,
  type DatastoreSubject,
} from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/spec_pb";
import { Section } from "../resource-detail/Section.js";
import { formatFieldValue } from "./recordValues.js";

/** Props for {@link CollectionSchemaView}. */
export interface CollectionSchemaViewProps {
  /** The datastore spec — the authoritative source for structure (DD-008 SD-5). */
  readonly spec: DatastoreSpec;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Structural view of a datastore's declared schema, rendered from the
 * loaded resource spec: per-collection typed field tables, the declared
 * constraints with their authored messages (the operator's own copy —
 * the same bytes agents relay), and the authorization block summary
 * (roles, bindings, `default_role` — operator-facing state the
 * describe projection deliberately excludes).
 *
 * Read-only by design: schema changes go through YAML apply, the one
 * write path for structure.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 */
export function CollectionSchemaView({ spec, className }: CollectionSchemaViewProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <AuthorizationSummary authorization={spec.authorization} timezone={spec.timezone} />
      {spec.collections.map((coll) => (
        <CollectionSchema key={coll.name} collection={coll} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Authorization block summary
// ---------------------------------------------------------------------------

function AuthorizationSummary({
  authorization,
  timezone,
}: {
  readonly authorization: DatastoreAuthorization | undefined;
  readonly timezone: string;
}) {
  const roles = authorization?.roles ?? [];
  const bindings = authorization?.bindings ?? [];
  const defaultRole = authorization?.defaultRole ?? "";

  return (
    <Section title="Authorization">
      <div className="flex flex-col gap-3 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Roles</span>
          {roles.length === 0 ? (
            <span className="text-xs text-muted-foreground">none declared</span>
          ) : (
            roles.map((r) => (
              <span
                key={r.name}
                className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
              >
                {r.name}
              </span>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Default role</span>
          {defaultRole ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {defaultRole}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              none — unbound callers are denied
            </span>
          )}
        </div>
        {bindings.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Bindings ({bindings.length})
            </span>
            <ul className="flex flex-col gap-0.5">
              {bindings.map((b, i) => (
                <li key={i} className="text-xs text-foreground">
                  <code className="font-mono">{formatSubject(b.subject)}</code>
                  <span className="text-muted-foreground"> → </span>
                  {b.role}
                </li>
              ))}
            </ul>
          </div>
        )}
        {timezone && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Timezone</span>
            <span className="text-xs text-foreground">{timezone}</span>
          </div>
        )}
      </div>
    </Section>
  );
}

/**
 * Plain kind+value rendering of a datastore subject (DD-008 SD-3: the
 * grant system is the privacy boundary; display is honest).
 */
export function formatSubject(subject: DatastoreSubject | undefined): string {
  switch (subject?.kind.case) {
    case "channelSender": {
      const s = subject.kind.value;
      return `${s.senderKind}:${s.value}`;
    }
    case "principal": {
      const p = subject.kind.value;
      return `${p.kind}/${p.id}`;
    }
    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Per-collection schema
// ---------------------------------------------------------------------------

const CONSTRAINT_KIND_LABELS = {
  uniques: "unique",
  checks: "check",
  exists: "exists",
  notExists: "not exists",
} as const;

function CollectionSchema({ collection }: { readonly collection: CollectionDeclaration }) {
  const constraints = [
    ...collection.uniques.map((c) => ({
      kind: CONSTRAINT_KIND_LABELS.uniques,
      name: c.name,
      fields: c.fields.join(", "),
      message: c.message,
    })),
    ...collection.checks.map((c) => ({
      kind: CONSTRAINT_KIND_LABELS.checks,
      name: c.name,
      fields: "",
      message: c.message,
    })),
    ...collection.exists.map((c) => ({
      kind: CONSTRAINT_KIND_LABELS.exists,
      name: c.name,
      fields: c.collection,
      message: c.message,
    })),
    ...collection.notExists.map((c) => ({
      kind: CONSTRAINT_KIND_LABELS.notExists,
      name: c.name,
      fields: c.collection,
      message: c.message,
    })),
  ];

  return (
    <Section title={collection.name} count={collection.fields.length}>
      <div className="flex flex-col">
        {collection.description && (
          <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            {collection.description}
          </p>
        )}

        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">Field</th>
              <th scope="col" className="px-3 py-2 font-medium">Type</th>
              <th scope="col" className="px-3 py-2 font-medium">Required</th>
              <th scope="col" className="px-3 py-2 font-medium">Default</th>
              <th scope="col" className="px-3 py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {collection.fields.map((f) => (
              <tr key={f.name} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 font-mono text-foreground">{f.name}</td>
                <td className="px-3 py-2 text-foreground">
                  {FieldType[f.type]}
                  {f.enumValues.length > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({f.enumValues.join(" | ")})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{f.required ? "yes" : ""}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {f.default !== undefined
                    ? formatFieldValue(f.type, toJson(ValueSchema, f.default))
                    : ""}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{f.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {constraints.length > 0 && (
          <div className="border-t border-border">
            <h4 className="px-3 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Constraints
            </h4>
            <ul className="flex flex-col gap-1 p-3">
              {constraints.map((c) => (
                <li key={`${c.kind}:${c.name}`} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                    {c.kind}
                  </span>
                  <code className="font-mono text-foreground">{c.name}</code>
                  {c.fields && <span className="text-muted-foreground">({c.fields})</span>}
                  {c.message && (
                    <span className="text-muted-foreground">— “{c.message}”</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
