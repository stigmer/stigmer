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
- Cursor also reads `CLAUDE.md`. A repository that ships both a `CLAUDE.md` and
  an `AGENTS.md` (langfuse, symlinked) loads the same text twice in every chat.
- An `AGENTS.md` placed inside a `.agents` folder (a vendored skill bundle's own
  guide) loads as an always-on rule, unscoped. Package guides never live there.

## Layout

```text
AGENTS.md                         the always-on root guide (a real file, not a symlink)
<package>/AGENTS.md               one per package that has binding laws; under 60 lines
.agents/
  README.md                       this file
  ARCHITECTURE_PRINCIPLES.md      what the codebase optimises for; the reasons behind the laws
  skills/<name>/SKILL.md          repo skills, with optional references/ and scripts/
.cursor/rules/agents-<slug>.mdc   generated shim per nested guide; never edited by hand
scripts/agents-check.mjs          the gate: shims in sync, cited paths resolve, no private ids
```

`CLAUDE.md` and a `.claude` skills folder are deliberately absent: no Claude
Code session runs here yet, and Cursor also reads `CLAUDE.md`, so an import file
today would load the root guide twice for a tool nobody uses. When Claude Code
is adopted, add a one-line `CLAUDE.md` containing `@AGENTS.md` beside each
`AGENTS.md`, and teach `scripts/agents-check.mjs` to require it. Codex reads
`AGENTS.md` and `.agents/skills/` natively.

## Adding or changing guidance

1. Decide the mechanism from the table above. If the text is conditional, it is
   not for the root file.
2. A nested guide is an index: read-order over headers and READMEs, the
   package's verification map, the laws a strong model would not infer, the
   skills to load. Under 60 lines. Write it from the tree as it is, not from
   memory.
3. A skill's `description` is its trigger: say what it does and when to use it,
   in the third person. Package doctrine skills carry `paths:`. Keep `SKILL.md`
   under 500 lines and move detail into a `references` folder beside it.
4. Run `make agents-sync` (writes or removes shims) and `make agents-check`
   (fails on drift, a cited path that does not resolve, or a private-record
   identifier). `check-prep` and `ci.docs` run both.
5. Format with the repo's Prettier config; `make format-docs` covers guidance
   files.
6. Nothing in this repository cites a private planning record, task id, ruling
   id or finding id. Say the reason, or cite a PR, an issue, a SHA or a file.

## The learning loop

When a session reveals a durable convention, a recurring pitfall or a
verification pattern, update the smallest guidance file that owns it in the same
PR: the package guide for a package fact, the root guide for a repo-wide law, a
skill for a procedure. Guidance that lives only in a chat is lost with it.
