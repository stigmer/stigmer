---
name: model-fga-authorization
description:
  The procedure for changing the OpenFGA authorization model under
  backend/services/stigmer-server/fga, covering the file and its header, the
  suite that pins it, the regenerated JSON, the one command that proves it on
  the engine and the built-in evaluator, and what a new type needs in the
  server. Use when touching the model or its suites.
paths:
  - backend/services/stigmer-server/fga/**
---

# Modelling authorization

The model is the `.fga` files under `backend/services/stigmer-server/fga/model`,
compiled into the one JSON file every edition reads. Its doctrine (visibility is
a tuple, the access patterns, the shapes to avoid, the compiled file's contract)
is `backend/services/stigmer-server/fga/model/README.md`; read it first, and let
it win when it and this skill disagree. This skill is the order of work.

## 1. Read the nearest precedent

Find the sibling type whose pattern fits (the README's Access Patterns), read
its `.fga` file and the suite under `backend/services/stigmer-server/fga/tests/`
that pins it, and write the change in the same shape.

## 2. Change the file

- Keep the header comment true: what the type is for, the tuples the application
  writes on creation, and the checks the handlers make.
- A new type is a new file, listed in `fga.mod` in dependency order (the
  generator refuses an unlisted file), named by the type.
- A permission an RPC annotation asks (`rpc.config` in `apis/`) must be a
  relation of its kind's type. The server's wire pin
  (`backend/services/stigmer-server/src/authorization/__tests__/wire-permissions.test.ts`)
  fails otherwise, and a known gap it pins asks for its line's removal when the
  model closes it.

## 3. Pin it with a suite

Extend the type's suite, or add `fga/tests/<type>-<facet>.fga.yaml` with
`model_file: ../../src/authorization/model/data/authorization-model.json`. The
cast includes a viewer-role principal whenever the type can be org-visible, an
outsider, and the operator where a platform permission is involved. `check` and
`list_objects` only. A new suite's file name joins `DOCUMENTS` in
`backend/services/stigmer-server/src/authorization/__tests__/store-tests.test.ts`.

## 4. Regenerate and prove

```bash
make test-authorization-model
```

It regenerates
`backend/services/stigmer-server/src/authorization/model/data/authorization-model.json`,
runs every suite on the OpenFGA engine at the pinned `fga` CLI version
(`FGA_CLI_VERSION` in the root `Makefile`; install that release, or point `FGA`
at it), then runs the suites and the model's pins through the built-in
evaluator. Commit the regenerated JSON with the source; CI's
`ci.authorization-model` lane fails on a stale file.

## 5. What a new type or relation needs in the server

- A new type: a row in
  `backend/services/stigmer-server/src/authorization/model/bindings.ts` (its
  message schema, or `ROWLESS` for a type with no stored resource). The model
  refuses to load a type with no binding.
- A relation `kind_meta.authorization` cannot derive from the row: a derived
  rule in the same table (`default-of.ts` and `execution-viewer.ts` are the
  precedents).
- A shape the evaluator does not run (`but not`, a wildcard, a condition): the
  reader
  (`backend/services/stigmer-server/src/authorization/model/openfga-json.ts`)
  refuses it by name. Needing one is a design change of the evaluator, before
  the model.

Then `make test-server`, which runs the whole server suite over the new model.

## 6. Describe it

The pull request says what changed, why, and the suite that pins it; that and
the commit are the change's note, and the release that carries it names it in
its notes. There is no model changelog file. An edition that runs OpenFGA
applies the released JSON as it is.
