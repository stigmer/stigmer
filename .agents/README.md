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

The shims and `paths:` fire only for files inside a workspace folder, and code
changes happen in git worktrees, which are never workspace folders (the root
guide says why). For a worktree path, `scripts/agents-context-hook.mjs`, a
Cursor `postToolUse` hook registered by the generated `.cursor/hooks.json`, does
the shims' job: on the first touch of a file under a package it attaches the
package's guide chain and names the skills scoped to that path, once per
conversation. It serves only worktrees of this repository (read from the
worktree's `.git` link), never a path inside a workspace folder, and never fails
closed. `node scripts/agents-context-hook.mjs --explain <path>` shows how a path
resolves when a guide seems not to arrive.

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
- Skills under `.agents/skills/` are listed by path and description at launch;
  `paths:` frontmatter and package-local skill folders both defer a skill until
  a matching file is touched, and `disable-model-invocation: true` keeps a skill
  out of the model's list entirely (it stays in the `/` menu).
- A skill whose frontmatter is not valid YAML is listed by path with no
  description and none of its flags honoured: `paths:` no longer defers it and
  `disable-model-invocation` no longer hides it. The usual cause is a plain
  (unquoted) description containing `: ` or ending a wrapped line with `:`,
  which YAML reads as a nested mapping. `make agents-check` reports it; the fix
  is to rephrase without the colon.
- A skill file is indexed when Cursor first sees it. Later edits are not re-read
  until the window reloads, so a skill you have just written or changed is
  listed as it first was (or not at all) until then.
- A glob shim fires only on paths inside its own workspace folder. Measured
  2026-09-17 with four folders in one window (this repository's primary
  checkout, two of its worktrees, and a second repository whose server tree has
  the same relative path and an identically named shim): reading that second
  repository's `backend/services/stigmer-server/src/main.ts` attached only its
  own shim and guide; none of this repository's server shims fired.
- A git worktree outside the window gets the root guides (every folder's root
  `AGENTS.md` loads in every chat, and the worktree's copy is identical to the
  primary's) and nothing else: neither its nested guides nor its `paths:` skills
  (measured 2026-09-17 on 3.20.21 with a throwaway repository). The hook above
  supplies exactly those two.
- Changing the window's folder set (adding a folder, removing one) disconnects
  the tool layer of every other chat in the window until a reload, and a folder
  still listed after its directory was deleted makes Grep and Glob fail for
  every chat with `Path does not exist`. That is why a worktree is never added
  to the window and never removed from disk while it is still a folder.
- Hooks, measured 2026-09-17 on 3.20.21: a `postToolUse` hook fires for every
  file tool on any path, inside or outside the window, and for every folder's
  `.cursor/hooks.json` at once, so per-repository scoping is the hook's own job.
  `tool_input.file_path` names the file for `Read`, `Write` and `Delete`; an
  edit arrives as a `Read` then a `Write` whose input is the whole new file. A
  `hooks.json` created or edited while the window is open takes effect on the
  next tool call, with no reload and no effect on other chats. The hook process
  starts in its own project root, also as the second folder of a multi-root
  window, but `CURSOR_PROJECT_DIR` names the first folder; it runs under the
  `node` Cursor's environment resolves, not the repository's pinned version. A
  subagent's tool calls fire no hooks.
- A rule deleted from disk stays in Cursor's list, and can still be attached,
  until the window reloads (measured 2026-09-16 on the merged primary: a read
  attached a `.cursor/rules` file that no longer existed). A listing that names
  a deleted rule means the window has not been reloaded since the deletion.
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
.cursor/hooks.json                generated; registers the worktree guidance hook
scripts/agents-check.mjs          the gate: shims and hooks.json in sync, cited paths resolve, no private ids,
                                  guides within budget, skill frontmatter well-formed, nothing hand-written in
                                  .cursor/rules, no .mdc anywhere else (a rule filed where no tool reads it)
scripts/agents-context-hook.mjs   the postToolUse hook: package guides and scoped skills for a worktree path
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
   in the third person, within sixty words (it is listed in every conversation),
   and without `: ` or a trailing `:` in the unquoted text (YAML would read a
   mapping and Cursor would list the skill with no description at all). Package
   doctrine skills carry `paths:`; skills that act carry
   `disable-model-invocation: true`. Keep `SKILL.md` under 500 lines and move
   detail into a `references` folder beside it. Write it from the tree as it is,
   never from the rule or document it replaces.
4. Guidance cross-references are paths, never bare names: a guide names its
   skill as `.agents/skills/<name>/SKILL.md`, and a skill that hands to another
   cites it the same way, so the gate fails on a renamed or deleted skill.
   Cursor's `/name` form appears only where a person is told what to type.
5. Run `make agents-sync` (writes or removes shims, writes `.cursor/hooks.json`)
   and `make agents-check` (fails on drift in either, a cited path that does not
   resolve, a private-record identifier, a guide over budget, malformed skill
   frontmatter or a `paths:` glob beyond `**`, `*` and `?`, any file in
   `.cursor/rules/` that is not a generated shim, or a `.mdc` file anywhere else
   in the tree, since Cursor reads rules from that folder only). `check-prep`
   and `ci.docs` run both; `npm run test:scripts` runs the gate's and the hook's
   tests.
6. Format with the repo's Prettier config; `make format-docs` covers guidance
   files.
7. Nothing in this repository cites a private planning record, task id, ruling
   id or finding id. Say the reason, or cite a PR, an issue, a SHA or a file.

## The learning loop

When a session reveals a durable convention, a recurring pitfall or a
verification pattern, update the smallest guidance file that owns it in the same
PR: the package guide for a package fact, the root guide for a repo-wide law, a
skill for a procedure. Guidance that lives only in a chat is lost with it.
