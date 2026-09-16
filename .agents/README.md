# Repo-owned agent guidance

This folder and the `AGENTS.md` files across the tree are the one source of
truth for how coding agents work in this repository. Nothing durable lives only
in a tool-specific folder. What each tool needs to discover the guidance is
either read natively or generated from here.

## The three mechanisms, and which content goes to which

| Content                                       | Where it lives                   | How it loads                                                              |
| --------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| Repo-wide facts and hard laws                 | root `AGENTS.md`                 | always, in every conversation                                             |
| A package's binding laws and read-order       | `<package>/AGENTS.md`            | when files in that directory are touched, through a generated Cursor shim |
| Engineering procedures and long-form doctrine | `.agents/skills/<name>/SKILL.md` | on demand, by task match or `/name`; `paths:` narrows when it is offered  |

Precedence when two disagree, nearest to the code first: a module's intent
header, then the folder's `README.md`, then the package `AGENTS.md`, then the
root `AGENTS.md`, then a skill. Correct the farther one. A guide is an index
that points at headers and READMEs; it does not restate them, because a second
copy is the one that drifts.

A package guide binds exactly the directory it lives in: its shim's `globs:` is
that directory and nothing else. A sibling tree that shares the laws (`demos/`
and `site/` with `docs/`, `backend/libs/ts/` with the server) is reached by its
own `README.md`, by the root guide, and by a skill's `paths:`, never by a guide
that lives elsewhere.

## Measured loading behaviour (Cursor 3.20.17, 2026-09-16)

Re-test these when Cursor changes its discovery rules; the design below rests on
them.

- A root `AGENTS.md` in a workspace folder loads at once, as an always-applied
  rule, with no window reload.
- In a multi-root window, every folder's root `AGENTS.md` loads in every chat,
  whatever repo the chat works in. Keep root files short and windows lean.
- A nested `AGENTS.md` does not attach when files in its directory are read. A
  `.cursor/rules/*.mdc` whose `globs:` match does attach, and an `@<path>` line
  in its body makes Cursor attach the referenced file beside it. That is why
  each nested guide has a generated shim.
- Skills under `.agents/skills/` are listed by name and description at launch;
  `paths:` frontmatter and package-local skill folders both defer a skill until
  a matching file is touched.
- Nothing inside a git worktree is discovered unless the worktree is a workspace
  folder, and the primary checkout's glob rules do not fire for worktree paths.
  Add the worktree to the window when you create it (`cursor --add <worktree>`)
  and reload the window: instruction files are enumerated per folder at window
  load, so a folder added mid-session is not scanned until then.
- In a folder added mid-session, before the reload, a glob shim already fires on
  a matching read but its `@<path>` line arrives literal and the nested guide is
  not attached; after the reload the same read attaches the shim, the guide and
  any other matching rule. A shim seen without its guide means the window has
  not been reloaded since the folder was added.
- Cursor also reads `CLAUDE.md`. A repository that ships both a `CLAUDE.md` and
  an `AGENTS.md` (langfuse, symlinked) loads the same text twice in every chat.
- An `AGENTS.md` placed inside a `.agents` folder (a vendored skill bundle's own
  guide) loads as an always-on rule, unscoped. Package guides never live there.

## Layout

```text
AGENTS.md                         the always-on root guide (a real file, not a symlink)
<package>/AGENTS.md               one per package that has binding laws; at most 600 words
.agents/
  README.md                       this file
  ARCHITECTURE_PRINCIPLES.md      what the codebase optimises for; the reasons behind the laws
  skills/<name>/SKILL.md          repo skills, with optional references/ beside each
.cursor/rules/agents-<slug>.mdc   generated shim per nested guide; the ONLY files allowed in .cursor/rules
scripts/agents-check.mjs          the gate: shims in sync, cited paths resolve, no private ids, guides within
                                  budget, skill frontmatter well-formed, nothing hand-written in .cursor/rules
```

The skills are of two kinds. Package doctrine skills carry `paths:` and surface
when a matching file is touched: `ts-server-dev-guidelines`,
`sdk-console-architecture`, `runner-dev-guidelines`, `docs-writing`,
`conformance-test-authoring`, `model-proto-resource`. Action skills are
procedures a person invokes by name (`disable-model-invocation: true`), because
they act on git, GitHub or a release: `commit-stigmer-oss-changes`,
`create-stigmer-oss-pull-request`, `release-stigmer-oss`,
`wrap-up-github-issue`, and `test-gate` (a posture rather than an action, but
one a session should not adopt uninvited). `verify-stigmer-oss-changes` is the
one action skill the model may reach for on its own, because a session should
verify before it commits.

`CLAUDE.md` and a `.claude` skills folder are deliberately absent: no Claude
Code session runs here yet, and Cursor also reads `CLAUDE.md`, so an import file
today would load the root guide twice for a tool nobody uses. When Claude Code
is adopted, add a one-line `CLAUDE.md` containing `@AGENTS.md` beside each
`AGENTS.md`, and teach `scripts/agents-check.mjs` to require it. Codex reads
`AGENTS.md` and `.agents/skills/` natively.

## Adding or changing guidance

1. Decide the mechanism from the table above. If the text is conditional, it is
   not for the root file.
2. A nested guide is an index, opened with `# Agent guide: <package path>`:
   read-order over headers and READMEs, the laws a strong model would not infer,
   the gates only that package runs (the root guide already holds the
   verification map by path prefix; do not copy its rows), the skills to load.
   At most 600 words; the root at most 1,200. The budget is a ceiling, not a
   target: a guide that needs more room is restating something it should point
   at. Write it from the tree as it is, not from memory.
3. A skill's `description` is its trigger: say what it does and when to use it,
   in the third person, within sixty words (it is listed in every conversation).
   Package doctrine skills carry `paths:`; skills that act carry
   `disable-model-invocation: true`. Keep `SKILL.md` under 500 lines and move
   detail into a `references` folder beside it. Write it from the tree as it is,
   never from the rule or document it replaces.
4. Guidance cross-references are paths, never bare names: a guide names its
   skill as `.agents/skills/<name>/SKILL.md`, and a skill that hands to another
   cites it the same way, so the gate fails on a renamed or deleted skill.
   Cursor's `/name` form appears only where a person is told what to type.
5. Run `make agents-sync` (writes or removes shims) and `make agents-check`
   (fails on drift, a cited path that does not resolve, a private-record
   identifier, a guide over budget, malformed skill frontmatter, or any file in
   `.cursor/rules/` that is not a generated shim). `check-prep` and `ci.docs`
   run both.
6. Format with the repo's Prettier config; `make format-docs` covers guidance
   files.
7. Nothing in this repository cites a private planning record, task id, ruling
   id or finding id. Say the reason, or cite a PR, an issue, a SHA or a file.

## The learning loop

When a session reveals a durable convention, a recurring pitfall or a
verification pattern, update the smallest guidance file that owns it in the same
PR: the package guide for a package fact, the root guide for a repo-wide law, a
skill for a procedure. Guidance that lives only in a chat is lost with it.
