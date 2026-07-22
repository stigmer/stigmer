# Datastore constraint-expression conformance corpus

These fixtures pin the cross-edition CEL contract for datastore
constraint evaluation (DD-004 SD-2): the Go control plane
(`stigmer-server`, cel-go) and the Java control plane (`stigmer-service`,
cel-java) MUST produce identical verdicts for every case in this
directory. The Go tests live next to the engine
(`backend/services/stigmer-server/pkg/domain/datastore/celeval`); the
Java tests consume these same files via the sibling-checkout path with a
parity check (T04).

## The environment under test

Expressions are compiled and evaluated in a scope-fenced environment:

- `this` — the candidate record (post-merge on updates); a map of
  declared field name to typed value
- `that` — a record of the target collection (`exists`/`not_exists`
  `where` expressions only; out of scope everywhere else)
- `tz` — the datastore's IANA timezone string
- the CEL standard library
- exactly two curated functions:
  - `timeOfDay(timestamp, tz) -> string` — canonical `HH:MM:SS`
  - `localDate(timestamp, tz)  -> string` — canonical `YYYY-MM-DD`

Field typing inside `this`/`that`: `timestamp` surfaces as a CEL
timestamp; `date`/`time` as canonical strings (lexicographically
chronological); `integer` as int; `number` as double; `bool` as bool;
`string` as string; `json` as dyn. Absent or null optional fields
surface as CEL `null`.

## Fixture schema (`expressions.yaml`)

```yaml
cases:
  - name: unique_case_name
    expression: "<CEL expression>"
    tz: "Asia/Kolkata"        # value bound to `tz`; may be ""
    this:                      # candidate record activation
      field_name: {type: timestamp, value: "2026-07-21T04:30:00Z"}
    that:                      # optional; brings `that` into scope
      field_name: {type: time, value: "10:00:00"}
    want: true                 # expected boolean verdict
    # OR, for cases that must fail:
    error: compile             # "compile" (rejected at apply time)
                               # or "eval" (data-dependent failure)
```

Value `type` is a `FieldType` enum name (`string`, `integer`, `number`,
`bool`, `timestamp`, `date`, `time`, `json`); `value: null` (or an
omitted field that the schema declares) activates as CEL null.

A `that` key present in the fixture — even empty — compiles the
expression in the exists/not_exists environment (`that` in scope).
