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
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
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
      <div className="stg:flex stg:flex-col stg:gap-3 stg:p-3 stg:text-sm">
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
          <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">Roles</span>
          {roles.length === 0 ? (
            <span className="stg:text-xs stg:text-muted-foreground">none declared</span>
          ) : (
            roles.map((r) => (
              <span
                key={r.name}
                className="stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-xs stg:font-medium stg:text-foreground"
              >
                {r.name}
              </span>
            ))
          )}
        </div>
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
          <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">Default role</span>
          {defaultRole ? (
            <span className="stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-xs stg:font-medium stg:text-foreground">
              {defaultRole}
            </span>
          ) : (
            <span className="stg:text-xs stg:text-muted-foreground">
              none — unbound callers are denied
            </span>
          )}
        </div>
        {bindings.length > 0 && (
          <div className="stg:flex stg:flex-col stg:gap-1">
            <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">
              Bindings ({bindings.length})
            </span>
            <ul className="stg:flex stg:flex-col stg:gap-0.5">
              {bindings.map((b, i) => (
                <li key={i} className="stg:text-xs stg:text-foreground">
                  <code className="stg:font-mono">{formatSubject(b.subject)}</code>
                  <span className="stg:text-muted-foreground"> → </span>
                  {b.role}
                </li>
              ))}
            </ul>
          </div>
        )}
        {timezone && (
          <div className="stg:flex stg:items-center stg:gap-2">
            <span className="stg:text-xs stg:font-medium stg:text-muted-foreground">Timezone</span>
            <span className="stg:text-xs stg:text-foreground">{timezone}</span>
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
      <div className="stg:flex stg:flex-col">
        {collection.description && (
          <p className="stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
            {collection.description}
          </p>
        )}

        <table className="stg:w-full stg:text-left stg:text-xs">
          <thead>
            <tr className="stg:border-b stg:border-border stg:text-muted-foreground">
              <th scope="col" className="stg:px-3 stg:py-2 stg:font-medium">Field</th>
              <th scope="col" className="stg:px-3 stg:py-2 stg:font-medium">Type</th>
              <th scope="col" className="stg:px-3 stg:py-2 stg:font-medium">Required</th>
              <th scope="col" className="stg:px-3 stg:py-2 stg:font-medium">Default</th>
              <th scope="col" className="stg:px-3 stg:py-2 stg:font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {collection.fields.map((f) => (
              <tr key={f.name} className="stg:border-b stg:border-border stg:last:border-b-0">
                <td className="stg:px-3 stg:py-2 stg:font-mono stg:text-foreground">{f.name}</td>
                <td className="stg:px-3 stg:py-2 stg:text-foreground">
                  {FieldType[f.type]}
                  {f.enumValues.length > 0 && (
                    <span className="stg:text-muted-foreground">
                      {" "}
                      ({f.enumValues.join(" | ")})
                    </span>
                  )}
                </td>
                <td className="stg:px-3 stg:py-2 stg:text-muted-foreground">{f.required ? "yes" : ""}</td>
                <td className="stg:px-3 stg:py-2 stg:font-mono stg:text-muted-foreground">
                  {f.default !== undefined
                    ? formatFieldValue(f.type, toJson(ValueSchema, f.default))
                    : ""}
                </td>
                <td className="stg:px-3 stg:py-2 stg:text-muted-foreground">{f.description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {constraints.length > 0 && (
          <div className="stg:border-t stg:border-border">
            <h4 className="stg:px-3 stg:pt-2 stg:text-xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
              Constraints
            </h4>
            <ul className="stg:flex stg:flex-col stg:gap-1 stg:p-3">
              {constraints.map((c) => (
                <li key={`${c.kind}:${c.name}`} className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-2 stg:text-xs">
                  <span className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-medium stg:text-muted-foreground">
                    {c.kind}
                  </span>
                  <code className="stg:font-mono stg:text-foreground">{c.name}</code>
                  {c.fields && <span className="stg:text-muted-foreground">({c.fields})</span>}
                  {c.message && (
                    <span className="stg:text-muted-foreground">— “{c.message}”</span>
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
