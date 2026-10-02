/**
 * Reads this repository's Makefiles well enough to say what a `make` call
 * runs: the targets it reaches, the recipe lines of each, and the Makefiles
 * those come from.
 *
 * Why. A CI lane that calls `make build-runner` depends on the Makefile that
 * defines the target, on every target it pulls in, and on the scripts their
 * recipes run. scripts/lane-triggers.test.mjs holds each gate lane to those
 * files (a change to any must select the lane, #1733), and this module is the
 * part that knows make: it walks prerequisites and every
 * `$(MAKE) [-C <dir>] <target>` in a reached recipe, across Makefiles, and
 * places the words of a recipe line in the directory they run in.
 *
 * What it models, and what it refuses. Make is read as these Makefiles use it:
 * plain rules (`target: prerequisites`, with order-only prerequisites after
 * `|`), recipes of tab-prefixed lines with backslash continuations, `=`, `:=`,
 * `::=`, `?=` and `+=` variables, `export NAME`, comments. A file that uses
 * anything else is refused whole, wherever in the file the construct sits,
 * because a reader that guessed at a conditional's branch or an included file's
 * rules would hold a lane to the wrong files and pass green: a conditional,
 * `define`, `include`, `vpath`, a pattern or double-colon rule, a recipe on the
 * rule's own line, a target-specific variable, a function call at the top level
 * (`$(eval ...)`, `$(info ...)`), `override`, a `$(shell ...)` in a rule line,
 * a shell assignment (`!=`), a variable assigned a second time, or after a `:=`
 * used it (make expands a `:=` value when it is assigned, so either would
 * change what this reader reads), a special target other than those that change
 * nothing it reads (`.PHONY`, `.SILENT` and the like; `.ONESHELL`,
 * `.SECONDEXPANSION`, `.POSIX` and a suffix rule are refused), and a `SHELL`
 * other than sh or bash (both run `cd` and subshells as this reader places
 * them; site/Makefile names bash). None of the Makefiles a gate lane reaches
 * used one on 2026-10-03; a new one is taught here first.
 *
 * A make function in a recipe (`$(addsuffix ...)`, `$(patsubst ...)`) is not
 * evaluated: its inner words are read as written, so a script name a function
 * builds is not traced.
 *
 * A recipe's automatic variables are replaced from its own rule (`$@` the
 * target, `$<` the first prerequisite, `$^`, `$+` and `$?` all of them); `$*`
 * and the `D` and `F` forms are refused.
 *
 * Variables are expanded as text, never evaluated: `$(NAME)` and `${NAME}` take
 * their value, recursively; `$$` becomes `$`; a function such as `$(shell node
 * scripts/x.mjs)` stays as written, so the words inside it are still read; a
 * name no file defines (`$(HOME)`, a variable the caller passes) stays as
 * written. `$(CURDIR)`, the directory make runs in, expands to that directory
 * as an absolute path whose root is the checkout's (`$(CURDIR)/x` reads `/x` in
 * the root Makefile, `/sdk/go/x` under `make -C sdk/go`), so a word built on it
 * is placed from the checkout's root whatever directory its line changed to.
 * Since every recipe line runs in its own shell (no `.ONESHELL`), a word whose
 * line changes directory is placed by that change: a leading `cd <dir> &&`
 * places the line, and a `(cd <dir> && ...)` subshell places the words inside
 * it. Any other directory change leaves the line's words unplaceable, and a
 * `$(MAKE)` after a `cd`, or a bare `make` word anywhere outside quotes (after
 * `NAME=value`, behind `timeout`), is refused: a recursion it cannot follow.
 *
 * Pure: `read` is passed in, so fixtures need no files on disk.
 */

import { posix } from "node:path";

/** A variable assignment: an optional `export`, the name, the operator, the value (`override` is refused first). */
const ASSIGNMENT = /^(?:export\s+)?([A-Za-z0-9_.-]+)\s*(::=|:=|\?=|\+=|!=|=)\s*(.*)$/;
/** A rule line: its targets, one or two colons, then the rest of the line. */
const RULE = /^([^:=#]+?)\s*(::?)(?!=)\s*(.*)$/;
/** The directives and constructs this reader does not model. */
const REFUSED_DIRECTIVE = /^(ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|include|-include|sinclude|vpath)\b/;
/** A variable reference this reader expands, or `$$`. */
const REFERENCE = /\$\$|\$\(([A-Za-z0-9_.-]+)\)|\$\{([A-Za-z0-9_.-]+)\}/g;
/** The shells whose `cd` and subshells this reader places: sh and bash, by path or through env. */
const POSIX_SHELL = /^(?:\/usr)?\/bin\/(?:ba)?sh$|^\/usr\/bin\/env\s+(?:ba)?sh$/;
/** The special targets that change nothing this reader reads: which targets are files, what is echoed, kept or run in parallel. */
const INERT_SPECIAL_TARGETS = new Set([
  ".PHONY",
  ".SILENT",
  ".IGNORE",
  ".PRECIOUS",
  ".INTERMEDIATE",
  ".SECONDARY",
  ".DELETE_ON_ERROR",
  ".NOTPARALLEL",
  ".EXPORT_ALL_VARIABLES",
]);
/** `make` as a word of its own: not `cmake`, not `make-targets.mjs`. */
const MAKE_WORD = /(^|[\s;&|(`])make(?=[\s;&|)`]|$)/;
/** A directory change at a command's start: `cd`, `pushd`, `popd`. */
const DIRECTORY_CHANGE = /(^|[\s;&|(])(cd|pushd|popd)\b/;

/** A checkout-relative directory in one spelling: normalized, no trailing slash, "." for the root. */
export function directoryOf(path) {
  return posix.normalize(path).replace(/(.)\/+$/, "$1").replace(/^\/$/, ".");
}

/** The path of the Makefile make reads in `dir` ("." for the checkout's root). */
export function makefileIn(dir) {
  return dir === "." ? "Makefile" : `${dir}/Makefile`;
}

/** What `$(CURDIR)` names in `dir`: the directory as an absolute path whose root is the checkout's. */
export function curdirOf(dir) {
  return dir === "." ? "" : `/${dir}`;
}

/**
 * One Makefile's rules and variables: `{ rules, variables, refusals }`.
 * `rules` maps each target to `{ line, prerequisites, recipe }`, where
 * `recipe` holds `{ line, text }` per logical recipe line (continuations
 * joined, the `@`, `-` and `+` prefixes stripped). A target named on two rule
 * lines gathers both lines' prerequisites, as make does; a second recipe for
 * one target is refused. `variables` maps each name to its value's text
 * (`+=` appends). `refusals` name each construct this reader does not model,
 * with its line.
 */
export function readMakefile(text) {
  const lines = text.split("\n");
  const rules = new Map();
  const variables = new Map();
  // The line each variable was first assigned on, so a second assignment is refused rather than guessed at.
  const assigned = new Map();
  // Names a `:=` value used: make expanded them there, so assigning or appending to one later is refused.
  const usedEarly = new Map();
  // The `:=` values that run a shell: make runs them whenever it reads the file, whichever target is asked for.
  const onRead = [];
  // The names assigned with `:=`, whose `+=` also expands at once.
  const simple = new Set();
  const refusals = [];
  // The rule line whose recipe the next tab-prefixed lines belong to: its entries, and whether a recipe may follow.
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const number = index + 1;
    let line = lines[index];
    // Both a recipe line and any other line continue on the next with a trailing backslash.
    while (line.endsWith("\\") && index + 1 < lines.length) {
      index += 1;
      line = `${line.slice(0, -1).trimEnd()} ${lines[index].trim()}`;
    }
    if (line.startsWith("\t")) {
      if (current === null) {
        refusals.push(`line ${number}: a recipe line outside any rule`);
      } else if (current.second) {
        refusals.push(`line ${number}: ${current.second} gets a second recipe (its first is at line ${rules.get(current.second).line})`);
        current = { entries: [], second: null };
      } else {
        const step = { line: number, text: line.slice(1).replace(/^[@+\-\s]+/, "").trim() };
        for (const entry of current.entries) entry.recipe.push(step);
      }
      continue;
    }
    const content = line.replace(/(^|\s)#.*$/, "").trim();
    // Blank and comment lines do not end a recipe in make, so `current` stays.
    if (content === "") continue;
    current = null;
    const directive = REFUSED_DIRECTIVE.exec(content);
    if (directive) {
      refusals.push(`line ${number}: \`${directive[1]}\` is not read by this reader; teach it the construct first`);
      continue;
    }
    if (/^(export|unexport)\s+[A-Za-z0-9_.-]+$/.test(content)) continue;
    if (/^override\s/.test(content)) {
      refusals.push(`line ${number}: \`override\` makes the file's value win over a command line's; this reader does not model it`);
      continue;
    }
    if (/^\$[({][A-Za-z-]+\s/.test(content)) {
      refusals.push(`line ${number}: a function call at the top level (\`$(eval ...)\`, \`$(info ...)\`) is not read by this reader`);
      continue;
    }
    const assignment = ASSIGNMENT.exec(content);
    if (assignment) {
      const [, name, operator, value] = assignment;
      if (operator === "!=") {
        refusals.push(`line ${number}: \`${name} !=\` runs a shell when the file is read; this reader does not evaluate it`);
      } else if (name === "SHELL" && !POSIX_SHELL.test(value.trim())) {
        refusals.push(`line ${number}: SHELL is ${value.trim()}; this reader places words as sh and bash run them`);
      } else {
        // `?=` sets only a name not yet defined; `+=` appends to one that is.
        if (operator === "?=" && variables.has(name)) continue;
        if (operator !== "+=" && assigned.has(name)) {
          refusals.push(`line ${number}: ${name} is assigned again (first at line ${assigned.get(name)}); this reader expands each name with one value`);
          continue;
        }
        if (usedEarly.has(name)) {
          refusals.push(`line ${number}: ${name} is assigned after the := at line ${usedEarly.get(name)} used it; make expanded it there with its value at that line`);
          continue;
        }
        if (operator === ":=" || operator === "::=") {
          for (const [, paren, brace] of value.matchAll(REFERENCE)) {
            const used = paren ?? brace;
            if (used !== undefined && !usedEarly.has(used)) usedEarly.set(used, number);
          }
        }
        if (!assigned.has(name)) assigned.set(name, number);
        // A `:=` (or a `+=` onto one) expands now, so a shell it reaches, directly or through another variable, runs now.
        const immediate = operator === ":=" || operator === "::=" || (operator === "+=" && simple.has(name));
        if (operator === ":=" || operator === "::=") simple.add(name);
        if (immediate && /\$[({]shell\s/.test(expand(value, variables))) onRead.push({ line: number, text: value });
        variables.set(name, operator === "+=" && variables.has(name) ? `${variables.get(name)} ${value}` : value);
      }
      continue;
    }
    const rule = RULE.exec(content);
    if (!rule) {
      refusals.push(`line ${number}: "${content}" is neither a rule nor an assignment this reader reads`);
      continue;
    }
    const [, targetText, colons, rest] = rule;
    const targets = targetText.trim().split(/\s+/);
    if (targets.includes(".ONESHELL")) {
      refusals.push(`line ${number}: .ONESHELL runs a recipe in one shell; this reader places each line in its own`);
      continue;
    }
    const special = targets.filter((target) => target.startsWith("."));
    if (special.some((target) => !INERT_SPECIAL_TARGETS.has(target))) {
      refusals.push(`line ${number}: the special target ${special.find((target) => !INERT_SPECIAL_TARGETS.has(target))} is not read by this reader`);
      continue;
    }
    if (special.length > 0) continue;
    if (colons === "::" || targets.some((target) => target.includes("%")) || rest.includes(":")) {
      refusals.push(`line ${number}: a pattern, static-pattern or double-colon rule is not read by this reader`);
      continue;
    }
    if (/\$[({]shell\s/.test(content)) {
      refusals.push(`line ${number}: a rule line runs \`$(shell ...)\` when the file is read; this reader does not evaluate it`);
      continue;
    }
    if (rest.includes(";")) {
      refusals.push(`line ${number}: a recipe on the rule's own line is not read by this reader`);
      continue;
    }
    if (ASSIGNMENT.test(rest)) {
      refusals.push(`line ${number}: a target-specific variable is not read by this reader`);
      continue;
    }
    // Order-only prerequisites follow a `|`; they are prerequisites all the same.
    const prerequisites = rest.split("|").join(" ").split(/\s+/).filter(Boolean);
    current = { entries: [], second: null };
    for (const target of targets) {
      const entry = rules.get(target) ?? { line: number, prerequisites: [], recipe: [] };
      entry.prerequisites.push(...prerequisites);
      rules.set(target, entry);
      // A later rule line may add prerequisites; only a recipe under it would be a second one.
      if (entry.recipe.length > 0) current.second ??= target;
      current.entries.push(entry);
    }
  }
  return { rules, variables, refusals, onRead };
}

/**
 * `text` with its variable references expanded as text (the header says
 * how): `variables` from the file, `overrides` from the command line, where
 * a `null` value marks a variable passed with a value this reader cannot
 * know, left as written. `curdir` is what `$(CURDIR)` names.
 */
export function expand(text, variables, { overrides = new Map(), curdir = "" } = {}) {
  const walk = (value, seen) =>
    value.replace(REFERENCE, (whole, paren, brace) => {
      if (whole === "$$") return "$";
      const name = paren ?? brace;
      if (name === "CURDIR") return curdir;
      if (overrides.has(name)) return overrides.get(name) ?? whole;
      if (!variables.has(name) || seen.has(name)) return whole;
      return walk(variables.get(name), new Set([...seen, name]));
    });
  return walk(text, new Set());
}

/**
 * A recipe line with make's automatic variables replaced, as make replaces
 * them for this rule: `$@` the target, `$<` the first prerequisite, `$^`,
 * `$+` and `$?` the prerequisites (`$?` names only the newer ones, so naming
 * all of them can only hold a lane to more files). `$$` is left for
 * `expand`. `$*` (a pattern rule's stem, and pattern rules are refused) and
 * the `D` and `F` forms are refused: `{ text }` or `{ refusal }`.
 */
function automaticVariables(text, target, prerequisites) {
  let refusal = null;
  const replaced = text.replace(/\$\$|\$([@<^+?*])|\$\(([@<^+?*])([DF]?)\)/g, (whole, bare, paren, form) => {
    if (whole === "$$") return whole;
    const name = bare ?? paren;
    if (name === "*" || form) {
      refusal ??= `uses the automatic variable ${whole}, which this reader does not expand`;
      return whole;
    }
    if (name === "@") return target;
    if (name === "<") return prerequisites[0] ?? "";
    return prerequisites.join(" ");
  });
  return refusal ? { refusal } : { text: replaced };
}

/** `text` with its quoted strings blanked, so a word inside a message is not read as a command. */
function unquoted(text) {
  return text.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (quoted) => " ".repeat(quoted.length));
}

/** The `$(MAKE)` invocations in an expanded recipe line: `{ dir, targets, overrides }` or `{ refusal }` each. */
function recursions(text, dir) {
  const found = [];
  const plain = unquoted(text);
  if (MAKE_WORD.test(plain)) {
    found.push({ refusal: "runs `make` directly; spell it `$(MAKE)` so this reader follows it" });
  }
  for (const match of text.matchAll(/\$[({]MAKE[)}]/g)) {
    if (DIRECTORY_CHANGE.test(plain.slice(0, match.index))) {
      found.push({ refusal: "runs `$(MAKE)` after changing directory; pass `-C <dir>` instead" });
      continue;
    }
    found.push(parseMakeArguments(commandWords(text, match.index + match[0].length), dir));
  }
  return found;
}

/**
 * The words of the shell command that starts at `from` in `text`, up to the
 * first newline, `;`, `&`, `|` or closing parenthesis outside quotes and
 * outside a `$(...)` or `${...}`. Words split on whitespace at the same level, so
 * `rehearse-$(ARTIFACT)` and `STAMP=$(shell date | tr -d ' ')` are one word
 * each, and a quoted argument keeps its quotes.
 */
export function commandWords(text, from = 0) {
  const words = [];
  let word = "";
  let depth = 0;
  let quote = null;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if ((char === "(" || char === "{") && text[index - 1] === "$") {
      depth += 1;
    } else if ((char === ")" || char === "}") && depth > 0) {
      depth -= 1;
    } else if (depth === 0 && ";&|)\n".includes(char)) {
      break;
    } else if (depth === 0 && /\s/.test(char)) {
      if (word !== "") words.push(word);
      word = "";
      continue;
    }
    word += char;
  }
  if (word !== "") words.push(word);
  return words;
}

/**
 * A `make` command's arguments, read as `{ dir, targets, overrides }`, or
 * `{ refusal }` when they move the read somewhere this reader cannot follow
 * (another file, an include directory, a directory it cannot name). `dir` is
 * the directory the command runs in. A `VAR=value` argument is an override;
 * a value holding `$` is one this reader cannot know.
 */
export function parseMakeArguments(words, dir) {
  let into = directoryOf(dir);
  const targets = [];
  const overrides = new Map();
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index].replace(/^(["'])(.*)\1$/, "$2");
    if (word === "-C" || word.startsWith("-C")) {
      const named = word === "-C" ? words[(index += 1)] : word.slice(2);
      if (named === undefined || named.includes("$")) return { refusal: `make -C names its directory with an expression` };
      // An absolute directory (`$(CURDIR)/x`) is rooted at the checkout, as placeWords roots a `cd` to one.
      into = directoryOf(named.startsWith("/") ? named.slice(1) || "." : posix.join(into, named));
    } else if (/^(-f|--file|--makefile|-I|--include-dir|--directory)/.test(word)) {
      return { refusal: `make ${word} reads a file or directory this reader does not follow` };
    } else if (word.startsWith("-")) {
      continue; // -s, -j, -k, --no-print-directory: they change how make runs, not what it reads
    } else if (/^[A-Za-z0-9_.-]+=/.test(word)) {
      const [name, ...value] = word.split("=");
      const text = value.join("=").replace(/^(["'])(.*)\1$/, "$2");
      overrides.set(name, text.includes("$") ? null : text);
    } else {
      targets.push(word);
    }
  }
  if (targets.length === 0) return { refusal: "make names no target, so it runs the file's default goal" };
  return { dir: into, targets, overrides };
}

/**
 * Everything a `make` call reaches: `{ makefiles, targets, lines, refusals }`.
 * `read(path)` returns a Makefile's text, or undefined when there is none.
 * `targets` are `{ makefile, target }`; `lines` are `{ makefile, dir, target,
 * text }`, one per reached recipe line, expanded, shell comments left out. Each
 * Makefile read adds its `:=` values that run a shell, as target `(read)`,
 * since make runs those whenever it reads the file. A target that still holds a
 * reference this reader could not expand reaches every rule its literal prefix
 * starts (`rehearse-upgrade-$(ARTIFACT)` reaches each `rehearse-upgrade-*`), so
 * a lane can only be held to more files, never fewer; one named wholly by such
 * a reference (`$(TARGET)`) has no prefix to match on and is refused.
 */
export function targetClosure({ read, dir, targets, overrides = new Map() }) {
  const parsed = new Map();
  const makefiles = new Set();
  const reached = [];
  const lines = [];
  const refusals = [];
  const seen = new Set();
  const load = (makefile, at) => {
    if (!parsed.has(makefile)) {
      const text = read(makefile);
      let file = null;
      if (text !== undefined) {
        file = readMakefile(text);
        // Make expands target names when it reads them: `$(RUNNER_DIR)/node_modules` is a path.
        file.byName = new Map(
          [...file.rules].map(([name, rule]) => [expand(name, file.variables, { curdir: curdirOf(at) }), rule]),
        );
        refusals.push(...file.refusals.map((refusal) => `${makefile} ${refusal}`));
      }
      parsed.set(makefile, file);
    }
    return parsed.get(makefile);
  };
  const visit = (at, target, passed, explicit) => {
    const makefile = makefileIn(at);
    const file = load(makefile, at);
    if (file === null) {
      refusals.push(`${makefile} does not exist, yet a make call reads it for ${target}`);
      return;
    }
    if (!makefiles.has(makefile)) {
      makefiles.add(makefile);
      // What the file runs when it is read, before any target: each `:=` value's `$(shell ...)`.
      for (const { text } of file.onRead) {
        lines.push({ makefile, dir: at, target: "(read)", text: expand(text, file.variables, { overrides: passed, curdir: curdirOf(at) }) });
      }
    }
    let names = [target];
    if (target.includes("$")) {
      const prefix = target.slice(0, target.indexOf("$"));
      if (prefix === "") {
        // Nothing to match on: it could name any rule, so the lane cannot be held to the right ones.
        refusals.push(`${makefile}: ${target} is named wholly by a reference this reader could not expand`);
        return;
      }
      names = [...file.byName.keys()].filter((name) => name.startsWith(prefix));
      // A prerequisite that matches no rule is a file; a target a command asks for must name one.
      if (names.length === 0 && explicit) refusals.push(`${makefile}: ${target} matches no target this reader can name`);
    }
    for (const name of names) {
      const rule = file.byName.get(name);
      if (rule === undefined) {
        // A prerequisite that names no rule is a file; a target a command asks for must exist.
        if (explicit) refusals.push(`${makefile} defines no target ${name}`);
        continue;
      }
      const key = `${makefile}\0${name}\0${JSON.stringify([...passed])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reached.push({ makefile, target: name });
      const context = { overrides: passed, curdir: curdirOf(at) };
      const prerequisites = rule.prerequisites.flatMap((prerequisite) =>
        expand(prerequisite, file.variables, context).split(/\s+/).filter(Boolean),
      );
      for (const each of prerequisites) visit(at, each, passed, false);
      for (const { line, text } of rule.recipe) {
        const automatic = automaticVariables(text, name, prerequisites);
        if (automatic.refusal) {
          refusals.push(`${makefile}:${line} (${name}) ${automatic.refusal}`);
          continue;
        }
        const expanded = expand(automatic.text, file.variables, context);
        if (expanded.startsWith("#")) continue; // a shell comment runs nothing
        lines.push({ makefile, dir: at, target: name, text: expanded });
        for (const call of recursions(expanded, at)) {
          if (call.refusal) {
            refusals.push(`${makefile}:${line} (${name}) ${call.refusal}`);
            continue;
          }
          const inherited = new Map([...passed, ...call.overrides]);
          for (const next of call.targets) visit(call.dir, next, inherited, true);
        }
      }
    }
  };
  for (const target of targets) visit(dir, target, overrides, true);
  return { makefiles: [...makefiles].sort(), targets: reached, lines, refusals };
}

/**
 * The words of one expanded recipe line that `pattern` matches, each with
 * the checkout path it names: `{ words: [{ word, path }], refusals }`. `dir`
 * is the directory the line runs in. A word starting with `/` is absolute
 * and, through `$(CURDIR)`, rooted at the checkout. Every other word is
 * placed in `dir`, in the directory of the line's leading `cd <dir> &&`, or
 * in that of the `(cd <dir> && ...)` subshell holding it. A word in a line
 * that changes directory any other way is refused, since the directory it
 * runs in cannot be named, and so is a word glued to a reference left
 * unexpanded (`$(TOOLS)/x.mjs`).
 */
export function placeWords(text, dir, pattern) {
  const words = [];
  const refusals = [];
  // A `cd` to an absolute path (`$(CURDIR)/...`) is rooted at the checkout, as a word is; one to a
  // directory still holding a reference cannot be named.
  const into = (from, target) =>
    target.includes("$") ? null : directoryOf(target.startsWith("/") ? target.slice(1) || "." : posix.join(from, target));
  const leading = /^cd\s+([^\s;&|()]+)\s*&&/.exec(text);
  const base = leading ? into(dir, leading[1]) : dir;
  // Quoted text is blanked to its length, so a parenthesis in a message neither opens nor closes a subshell.
  const plain = unquoted(text);
  const subshells = [];
  for (const open of plain.matchAll(/\(\s*cd\s+([^\s;&|()]+)\s*&&/g)) {
    let depth = 0;
    let end = plain.length;
    for (let index = open.index; index < plain.length; index += 1) {
      if (plain[index] === "(") depth += 1;
      else if (plain[index] === ")" && (depth -= 1) === 0) {
        end = index;
        break;
      }
    }
    // A nested subshell's cd starts from the directory of the subshell around it.
    const outer = subshells.findLast((shell) => open.index > shell.start && open.index < shell.end);
    const from = outer ? outer.dir : base;
    subshells.push({ start: open.index, end, dir: from === null ? null : into(from, open[1]) });
  }
  // A change this reader cannot place: any `cd`, `pushd` or `popd` left once both shapes above are taken out.
  const others = plain
    .replace(/^cd\s+[^\s;&|()]+\s*&&/, "")
    .replace(/\(\s*cd\s+[^\s;&|()]+\s*&&/g, "(");
  const unplaceable = DIRECTORY_CHANGE.test(others);
  for (const match of text.matchAll(pattern)) {
    const word = match[0];
    // A word glued to a reference left unexpanded (`$(TOOLS)/x.mjs`) starts where the reference ends.
    if (/[)}]/.test(text[match.index - 1] ?? "")) {
      refusals.push(`"${word}" follows a reference this reader could not expand, so its directory cannot be named`);
      continue;
    }
    if (word.startsWith("/")) {
      words.push({ word, path: posix.normalize(word).slice(1) });
      continue;
    }
    if (unplaceable) {
      refusals.push(`"${word}" runs after a directory change this reader cannot place`);
      continue;
    }
    // The innermost subshell holding the word: subshells open in order, so the last that holds it.
    const subshell = subshells.findLast(({ start, end }) => match.index > start && match.index < end);
    const at = subshell ? subshell.dir : base;
    if (at === null) {
      refusals.push(`"${word}" runs in a directory named by a reference this reader could not expand`);
      continue;
    }
    words.push({ word, path: posix.normalize(posix.join(at, word)) });
  }
  return { words, refusals };
}
