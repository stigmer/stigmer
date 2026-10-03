// Tests for scripts/make-targets.mjs: reading a Makefile well enough to say
// what a `make` call runs.
// Run via `node --test scripts/make-targets.test.mjs` (wired into root `npm test`).
//
// What these guard: scripts/lane-triggers.test.mjs holds each gate lane to
// the Makefiles and scripts its `make` calls reach, so a misread here holds a
// lane to the wrong files and passes green. Fixtures pin each part of the
// read:
//   - the rules, prerequisites and recipes as make reads them;
//   - each construct the reader refuses rather than guesses at;
//   - variable expansion as text, with `$(CURDIR)` rooted at the checkout;
//   - the closure across prerequisites and `$(MAKE) -C` hops;
//   - where a recipe line's words run.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commandWords,
  curdirOf,
  directoryOf,
  expand,
  makefileIn,
  parseMakeArguments,
  placeWords,
  readMakefile,
  targetClosure,
} from "./make-targets.mjs";

/** A script word, as scripts/lane-triggers.test.mjs spells it. */
const SCRIPT = /[^\s"'`()=;|&<>]+\.(?:mjs|ts|sh)(?=$|[\s"'`()=;|&<>])/g;

/** Makefile text from lines; a leading `>` marks a recipe line (a tab). */
const mk = (...lines) => lines.map((line) => line.replace(/^>/, "\t")).join("\n");

/** A `read` over a map of Makefile paths to text. */
const files = (map) => (path) => map[path];

test("readMakefile reads rules, prerequisites, recipes and variables as make does", () => {
  const { rules, variables, refusals } = readMakefile(
    mk(
      "# a comment",
      "RUNNER_DIR := backend/services/runner",
      "FLAGS = -a",
      "FLAGS += -b",
      "MODE ?= fast",
      "FLAGS ?= -c",
      "export STUBS_FORCE",
      ".PHONY: build test",
      ".DELETE_ON_ERROR:",
      "",
      "build: deps | order ## Build it (needs: docker; tools)",
      ">@echo build \\",
      ">  --flag",
      "# a comment inside a recipe does not end it",
      "",
      ">-rm -f out",
      ">+$(MAKE) -C sub all",
      "build: extra",
      "a b: shared",
      ">touch $@",
    ),
  );
  assert.deepEqual(refusals, []);
  assert.deepEqual(rules.get("build"), {
    line: 11,
    prerequisites: ["deps", "order", "extra"],
    recipe: [
      { line: 12, text: "echo build --flag" },
      { line: 16, text: "rm -f out" },
      { line: 17, text: "$(MAKE) -C sub all" },
    ],
  });
  assert.deepEqual(rules.get("a").recipe, [{ line: 20, text: "touch $@" }], "a multi-target rule gives each target the recipe");
  assert.deepEqual(rules.get("b").prerequisites, ["shared"]);
  assert.deepEqual(Object.fromEntries(variables), {
    RUNNER_DIR: "backend/services/runner",
    FLAGS: "-a -b",
    MODE: "fast",
  });
});

test("readMakefile refuses every construct it does not model, wherever it sits", () => {
  const cases = [
    ["ifeq ($(X),1)", /`ifeq` is not read/],
    ["ifdef X", /`ifdef` is not read/],
    ["define BLOCK", /`define` is not read/],
    ["include other.mk", /`include` is not read/],
    ["-include other.mk", /`-include` is not read/],
    ["vpath %.c src", /`vpath` is not read/],
    ["FILES != ls", /runs a shell when the file is read/],
    ["SHELL := /bin/zsh", /SHELL is \/bin\/zsh; this reader places words as sh and bash run them/],
    [".ONESHELL:", /\.ONESHELL runs a recipe in one shell/],
    [".SECONDEXPANSION:", /the special target \.SECONDEXPANSION is not read/],
    [".POSIX:", /the special target \.POSIX is not read/],
    [".c.o:", /the special target \.c\.o is not read/],
    ["%.o: %.c", /a pattern, static-pattern or double-colon rule/],
    ["objs: %.o: %.c", /a pattern, static-pattern or double-colon rule/],
    ["all:: one", /a pattern, static-pattern or double-colon rule/],
    ["all: ; echo inline", /a recipe on the rule's own line/],
    ["all: MODE = fast", /a target-specific variable/],
    ["just some words", /is neither a rule nor an assignment/],
    ["$(info hello: world)", /a function call at the top level/],
    ["$(eval $(call TPL,a:b))", /a function call at the top level/],
    ["override TOOL = a.mjs", /`override` makes the file's value win/],
    ["stamp: $(shell date)", /a rule line runs `\$\(shell \.\.\.\)` when the file is read/],
    ["\techo orphan", /a recipe line outside any rule/],
  ];
  for (const [line, expected] of cases) {
    const { refusals } = readMakefile(mk(line));
    assert.equal(refusals.length, 1, line);
    assert.match(refusals[0], expected, line);
    assert.match(refusals[0], /^line 1: /, line);
  }
  for (const shell of ["/bin/bash", "/bin/sh", "/usr/bin/bash", "/usr/bin/env bash"]) {
    assert.deepEqual(readMakefile(mk(`SHELL := ${shell}`)).refusals, [], shell);
  }
  const again = readMakefile(mk("A := one.mjs", "B := $(A)", "A := two.mjs", "C = x", "C += y"));
  assert.deepEqual(again.refusals, ["line 3: A is assigned again (first at line 1); this reader expands each name with one value"]);
  assert.equal(again.variables.get("C"), "x y", "+= appends and is not a second assignment");
  assert.deepEqual(readMakefile(mk("A := $$HOME $(B)/x.mjs ${B}/y.mjs", "B := tools")).refusals, ["line 2: B is assigned after the := at line 1 used it; make expanded it there with its value at that line"]);
  assert.deepEqual(readMakefile(mk("A = scripts", "B := $(A)/x.mjs", "A += extra")).refusals, ["line 3: A is assigned after the := at line 2 used it; make expanded it there with its value at that line"], "an append counts too");
  assert.deepEqual(readMakefile(mk("A = $(B)/x.mjs", "B := tools", "C := $(CURDIR)/y $(HOME)")).refusals, [], "a recursive = reads B when it is used; CURDIR and HOME are never assigned");
  const twice = readMakefile(mk("x:", ">echo one", "x: more", ">echo two", ">echo three"));
  assert.deepEqual(twice.refusals, ["line 4: x gets a second recipe (its first is at line 1)"]);
  assert.deepEqual(twice.rules.get("x").recipe, [{ line: 2, text: "echo one" }], "the second recipe is not merged in");
});

test("expand substitutes variables as text, recursively, and never evaluates a function", () => {
  const variables = new Map([
    ["SERVER_DIR", "backend/services/stigmer-server"],
    ["VERSION", "$$(node $(CURDIR)/scripts/lib/source-version.mjs)"],
    ["DOCS", "$(shell node scripts/agents-check.mjs --list)"],
    ["LOOP", "$(LOOP) again"],
    ["NESTED", "${SERVER_DIR}/x"],
  ]);
  assert.equal(expand("cd $(SERVER_DIR) && V=$(VERSION)", variables), "cd backend/services/stigmer-server && V=$(node /scripts/lib/source-version.mjs)");
  assert.equal(expand("$(VERSION)", variables, { curdir: "/sdk/go" }), "$(node /sdk/go/scripts/lib/source-version.mjs)");
  assert.equal(expand("$(DOCS)", variables), "$(shell node scripts/agents-check.mjs --list)", "a function stays as written");
  assert.equal(expand("$(LOOP)", variables), "$(LOOP) again", "a self-reference is left as written instead of looping");
  assert.equal(expand("$(NESTED) $(HOME)/bin $@ $$HOME", variables), "backend/services/stigmer-server/x $(HOME)/bin $@ $HOME");
  const overrides = new Map([
    ["SERVER_DIR", "elsewhere"],
    ["ARTIFACT", null],
  ]);
  assert.equal(expand("$(SERVER_DIR) up-$(ARTIFACT)", variables, { overrides }), "elsewhere up-$(ARTIFACT)", "an override wins; an unknown one stays");
  assert.equal(curdirOf("."), "");
  assert.equal(curdirOf("sdk/go"), "/sdk/go");
  assert.equal(makefileIn("."), "Makefile");
  assert.equal(makefileIn("sdk/go"), "sdk/go/Makefile");
  assert.deepEqual(["sdk/go/", "./sdk//go/", "/", ".", ""].map(directoryOf), ["sdk/go", "sdk/go", ".", ".", "."]);
});

test("commandWords splits one shell command into words, keeping references and quotes whole", () => {
  assert.deepEqual(commandWords(`make rehearse-$(ARTIFACT) STAMP=$(shell date | tr -d ' ') MSG="a b" && echo done`), [
    "make",
    "rehearse-$(ARTIFACT)",
    "STAMP=$(shell date | tr -d ' ')",
    'MSG="a b"',
  ]);
  assert.deepEqual(commandWords("x; make -C ${DIR} all)", 3), ["make", "-C", "${DIR}", "all"]);
  assert.deepEqual(commandWords("make a\nmake b"), ["make", "a"], "a step's next line is the next command");
  assert.deepEqual(commandWords("  "), []);
});

test("parseMakeArguments reads a make command's directory, targets and overrides, and refuses what moves the read", () => {
  assert.deepEqual(parseMakeArguments(["-C", "sdk/go", "-s", "--no-print-directory", "codegen", "verify"], "."), {
    dir: "sdk/go",
    targets: ["codegen", "verify"],
    overrides: new Map(),
  });
  assert.equal(parseMakeArguments(["-C", "/sdk/go/x", "all"], "sdk/go").dir, "sdk/go/x", "a $(CURDIR) directory is rooted at the checkout");
  assert.equal(parseMakeArguments(["-C", "/", "all"], "sdk/go").dir, ".");
  assert.equal(parseMakeArguments(["-C", "sdk/go/", "x"], ".").dir, "sdk/go", "a trailing slash names the same directory");
  assert.equal(parseMakeArguments(["x"], "sdk/go/").dir, "sdk/go");
  assert.deepEqual(parseMakeArguments(["-C../../apis", "go-stubs-tools"], "sdk/go"), {
    dir: "apis",
    targets: ["go-stubs-tools"],
    overrides: new Map(),
  });
  assert.deepEqual(parseMakeArguments(["rehearse", 'ARTIFACT="${ARTIFACT}"', "MODE='fast'"], "."), {
    dir: ".",
    targets: ["rehearse"],
    overrides: new Map([
      ["ARTIFACT", null],
      ["MODE", "fast"],
    ]),
  });
  assert.match(parseMakeArguments(["-C", "${{ inputs.dir }}", "x"], ".").refusal, /names its directory with an expression/);
  assert.match(parseMakeArguments(["-C"], ".").refusal, /names its directory with an expression/);
  for (const flag of ["-f", "--file=x.mk", "--makefile=x.mk", "-I", "--include-dir=d", "--directory=d"]) {
    assert.match(parseMakeArguments([flag, "x"], ".").refusal, /reads a file or directory this reader does not follow/, flag);
  }
  assert.match(parseMakeArguments(["-s"], ".").refusal, /names no target/);
});

test("targetClosure follows prerequisites and $(MAKE) hops across Makefiles, expanding target names", () => {
  const read = files({
    Makefile: mk(
      "RUNNER_DIR := backend/services/runner",
      "build: stubs $(RUNNER_DIR)/node_modules some/file.txt",
      ">cd $(RUNNER_DIR) && npm run build",
      "stubs:",
      "># a shell comment runs nothing",
      ">$(MAKE) -C sdk/go codegen MODE=strict",
      "$(RUNNER_DIR)/node_modules: $(RUNNER_DIR)/package-lock.json",
      ">cd $(RUNNER_DIR) && npm ci",
    ),
    "sdk/go/Makefile": mk("codegen:", ">echo $(MODE) $(CURDIR)/gen.sh"),
  });
  const closure = targetClosure({ read, dir: ".", targets: ["build"] });
  assert.deepEqual(closure.refusals, []);
  assert.deepEqual(closure.makefiles, ["Makefile", "sdk/go/Makefile"]);
  assert.deepEqual(
    closure.targets.map(({ makefile, target }) => `${makefile} ${target}`),
    ["Makefile build", "Makefile stubs", "sdk/go/Makefile codegen", "Makefile backend/services/runner/node_modules"],
  );
  assert.deepEqual(
    closure.lines.map(({ dir, target, text }) => `${dir} ${target}: ${text}`),
    [
      ". stubs: $(MAKE) -C sdk/go codegen MODE=strict",
      "sdk/go codegen: echo strict /sdk/go/gen.sh",
      ". backend/services/runner/node_modules: cd backend/services/runner && npm ci",
      ". build: cd backend/services/runner && npm run build",
    ],
    "an override reaches the recursion, and $(CURDIR) is the hop's directory",
  );
});

test("targetClosure reaches every rule a variable target's prefix starts, and refuses what it cannot follow", () => {
  const read = files({
    Makefile: mk(
      "rehearse:",
      ">$(MAKE) rehearse-$(ARTIFACT) STAMP=$(shell date | tr -d ' ') && echo done",
      "rehearse-compose:",
      ">node test/compose.mjs",
      "rehearse-helm:",
      ">node test/helm.mjs",
      "other:",
      ">node test/other.mjs",
    ),
  });
  const closure = targetClosure({ read, dir: ".", targets: ["rehearse"], overrides: new Map([["ARTIFACT", null]]) });
  assert.deepEqual(closure.refusals, []);
  assert.deepEqual(closure.targets.map(({ target }) => target), ["rehearse", "rehearse-compose", "rehearse-helm"]);
  const refused = (makefile, targets = ["t"]) => targetClosure({ read: files({ Makefile: makefile }), dir: ".", targets }).refusals;
  assert.deepEqual(refused(mk("t:", ">echo"), ["missing"]), ["Makefile defines no target missing"]);
  assert.deepEqual(refused(mk("t:", ">$(MAKE) $(ANY)")), ["Makefile: $(ANY) is named wholly by a reference this reader could not expand"]);
  assert.deepEqual(refused(mk("t: $(ANY)", ">echo")), ["Makefile: $(ANY) is named wholly by a reference this reader could not expand"], "a prerequisite too");
  assert.deepEqual(refused(mk("t:", ">$(MAKE) gone-$(ANY)")), ["Makefile: gone-$(ANY) matches no target this reader can name"]);
  assert.deepEqual(refused(mk("t: gone-$(ANY)", ">echo")), [], "a prerequisite that matches no rule is a file");
  assert.deepEqual(refused(mk("t:", ">cd sub && $(MAKE) all")), ["Makefile:2 (t) runs `$(MAKE)` after changing directory; pass `-C <dir>` instead"]);
  assert.deepEqual(refused(mk("t:", ">make all")), ["Makefile:2 (t) runs `make` directly; spell it `$(MAKE)` so this reader follows it"]);
  assert.deepEqual(refused(mk("t:", ">test -f x || make all")), ["Makefile:2 (t) runs `make` directly; spell it `$(MAKE)` so this reader follows it"]);
  for (const recipe of [">if true; then make all; fi", ">FOO=1 make other", ">timeout 5 make all"]) {
    assert.deepEqual(refused(mk("t:", recipe)), ["Makefile:2 (t) runs `make` directly; spell it `$(MAKE)` so this reader follows it"], recipe);
  }
  assert.deepEqual(refused(mk("t:", ">cmake --build . && node scripts/make-targets.mjs")), [], "cmake and a file named make-… are not make");
  assert.deepEqual(refused(mk("t:", `>echo "run 'make all' first"; echo 'cd elsewhere'`)), [], "a message naming make or cd runs neither");
  assert.deepEqual(refused(mk("t:", ">$(MAKE) -f other.mk all")), ["Makefile:2 (t) make -f reads a file or directory this reader does not follow"]);
  assert.deepEqual(refused(mk("ifdef X", "t:", ">echo")), ["Makefile line 1: `ifdef` is not read by this reader; teach it the construct first"]);
  assert.deepEqual(
    targetClosure({ read: files({ Makefile: mk("t:", ">$(MAKE) -C nowhere all") }), dir: ".", targets: ["t"] }).refusals,
    ["nowhere/Makefile does not exist, yet a make call reads it for all"],
  );
  const automatic = targetClosure({
    read: files({ Makefile: mk("gen: scripts/gen.mjs lib.mjs", ">node $< --all $^ --out $@ && echo $$@ $(@)", "bare:", ">echo [$<]") }),
    dir: ".",
    targets: ["gen", "bare"],
  });
  assert.deepEqual(automatic.refusals, []);
  assert.deepEqual(
    automatic.lines.map(({ text }) => text),
    ["node scripts/gen.mjs --all scripts/gen.mjs lib.mjs --out gen && echo $@ gen", "echo []"],
    "automatic variables come from the rule; $$@ stays the shell's",
  );
  for (const recipe of [">node $*.mjs", ">node $(@D)/x.mjs", ">cp $< $(<F)"]) {
    assert.match(refused(mk("t: a.mjs", recipe)).join("\n"), /uses the automatic variable .+, which this reader does not expand/, recipe);
  }
  const inherited = targetClosure({
    read: files({
      Makefile: mk("all:", ">$(MAKE) -C sub gen", ">$(MAKE) -C sub gen TOOL=b.mjs"),
      "sub/Makefile": mk("TOOL = default.mjs", "STAMP := $(shell node $(TOOL) --version)", "gen:", ">node $(TOOL)"),
    }),
    dir: ".",
    targets: ["all"],
    overrides: new Map([["TOOL", "a.mjs"]]),
  });
  assert.deepEqual(inherited.refusals, []);
  assert.deepEqual(
    inherited.lines.filter(({ target }) => target === "gen").map(({ text }) => text),
    ["node a.mjs", "node b.mjs"],
    "a caller's override reaches a sub-make, and one target is read once per override set",
  );
  assert.deepEqual(
    inherited.lines.filter(({ target }) => target === "(read)").map(({ text }) => text),
    ["$(shell node a.mjs --version)"],
    "what the sub-make runs when it reads its file sees the override it inherited",
  );
  const onRead = targetClosure({
    read: files({ Makefile: mk("VERSION := $(shell node $(CURDIR)/scripts/version.mjs)", "LATER = $(shell node lazy.mjs)", "t:", ">echo") }),
    dir: ".",
    targets: ["t"],
  });
  const indirect = targetClosure({
    read: files({ Makefile: mk("A = $(shell node a.mjs)", "B := $(A)", "C := x", "C += $(shell node c.mjs)", "D = y", "D += $(shell node d.mjs)", "t:", ">echo") }),
    dir: ".",
    targets: ["t"],
  });
  assert.deepEqual(
    indirect.lines.map(({ target, text }) => `${target}: ${text}`),
    ["(read): $(shell node a.mjs)", "(read): $(shell node c.mjs)", "t: echo"],
    "a := reaching a shell through another variable, and a += onto a :=, run when the file is read; a += onto a recursive = does not",
  );
  assert.deepEqual(
    onRead.lines.map(({ target, text }) => `${target}: ${text}`),
    ["(read): $(shell node /scripts/version.mjs)", "t: echo"],
    "a := that runs a shell runs whenever the file is read; a recursive = only where it is used",
  );
  const cycle = targetClosure({ read: files({ Makefile: mk("a: b", ">echo a", "b: a", ">echo b") }), dir: ".", targets: ["a"] });
  assert.deepEqual(cycle.targets.map(({ target }) => target), ["a", "b"], "a prerequisite cycle is visited once");
});

test("placeWords places a recipe line's words where they run", () => {
  const paths = (text, dir = ".") => placeWords(text, dir, SCRIPT);
  assert.deepEqual(paths("node scripts/a.mjs && bash ./tools/b.sh").words.map(({ path }) => path), ["scripts/a.mjs", "tools/b.sh"]);
  assert.deepEqual(paths("scripts/run.sh --fast").words.map(({ path }) => path), ["scripts/run.sh"], "a script that is the line's first word");
  assert.deepEqual(paths("node gen.mjs", "sdk/go").words.map(({ path }) => path), ["sdk/go/gen.mjs"], "a package Makefile's line runs in its directory");
  assert.deepEqual(
    paths("cd backend/svc && V=$(node /scripts/lib/v.mjs) node scripts/bundle.mjs").words,
    [
      { word: "/scripts/lib/v.mjs", path: "scripts/lib/v.mjs" },
      { word: "scripts/bundle.mjs", path: "backend/svc/scripts/bundle.mjs" },
    ],
    "a leading cd places the line; a $(CURDIR) path stays rooted at the checkout",
  );
  assert.deepEqual(
    paths(`tmp=$(mktemp -d) && (cd client-apps/cli && npx tsx scripts/gen.ts --out "$tmp" --note "a (b) c") && node scripts/after.mjs`).words.map(({ path }) => path),
    ["client-apps/cli/scripts/gen.ts", "scripts/after.mjs"],
    "a subshell's cd places only the words inside it",
  );
  assert.deepEqual(paths("cd .. && node tools/gen.ts", "mcp-server").words.map(({ path }) => path), ["tools/gen.ts"]);
  assert.deepEqual(
    paths("(cd a && (cd b && node x.mjs) && node y.mjs) && node z.mjs").words.map(({ path }) => path),
    ["a/b/x.mjs", "a/y.mjs", "z.mjs"],
    "a word runs in its innermost subshell, whose cd starts from the one around it",
  );
  assert.deepEqual(
    paths("cd /sdk/go/tools && node gen.mjs && (cd / && node root.mjs)", "sdk/go").words.map(({ path }) => path),
    ["sdk/go/tools/gen.mjs", "root.mjs"],
    "a cd to a $(CURDIR) path is rooted at the checkout, not joined onto the line's directory",
  );
  assert.deepEqual(paths("(cd $DIR && node gen.mjs)").refusals, ['"gen.mjs" runs in a directory named by a reference this reader could not expand']);
  assert.deepEqual(paths("cd ${DIR} && node a.mjs; (cd $$X && node b.mjs)").refusals, [
    '"a.mjs" runs in a directory named by a reference this reader could not expand',
    '"b.mjs" runs in a directory named by a reference this reader could not expand',
  ]);
  assert.deepEqual(paths("cd $(TOOLS) && node gen.mjs").refusals, ['"gen.mjs" runs after a directory change this reader cannot place']);
  for (const text of ["node a.mjs; cd sub; node b.mjs", "pushd sub && node b.mjs", "echo && cd sub && node b.mjs"]) {
    const { words, refusals } = paths(text);
    assert.deepEqual(words, [], text);
    assert.ok(refusals.length > 0 && refusals.every((refusal) => /a directory change this reader cannot place/.test(refusal)), text);
  }
  assert.deepEqual(paths("echo 'cd elsewhere' && node a.mjs").words.map(({ path }) => path), ["a.mjs"], "a quoted cd changes nothing");
  assert.deepEqual(paths("node $(TOOLS)/x.mjs ${DIR}/y.mjs").refusals, [
    '"/x.mjs" follows a reference this reader could not expand, so its directory cannot be named',
  ], "a brace reference stays inside the word, for the caller to judge");
  assert.deepEqual(paths("cd sub && node /abs.mjs; cd other").words, [{ word: "/abs.mjs", path: "abs.mjs" }], "an absolute word needs no directory");
});
