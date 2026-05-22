import { describe, it, expect } from "vitest";
import {
  PLATFORM_PREFIX,
  PLATFORM_DIR_NAME,
  STIGMER_PLATFORM_DIR_ENV,
  classifyPlatformPath,
  humanizePlatformRefs,
  resolvePlatformCommand,
  humanizeSandboxPaths,
  resolveDisplayEnvVars,
} from "../platform-mount.js";

// ── Constants ────────────────────────────────────────────────────────────

describe("constants", () => {
  it("PLATFORM_PREFIX ends with /", () => {
    expect(PLATFORM_PREFIX).toBe(".stigmer/");
  });

  it("PLATFORM_DIR_NAME has no slash", () => {
    expect(PLATFORM_DIR_NAME).toBe(".stigmer");
  });

  it("STIGMER_PLATFORM_DIR_ENV is the canonical env var name", () => {
    expect(STIGMER_PLATFORM_DIR_ENV).toBe("STIGMER_PLATFORM_DIR");
  });
});

// ── classifyPlatformPath ─────────────────────────────────────────────────

describe("classifyPlatformPath", () => {
  it.each([
    [".stigmer/skills/a/SKILL.md", true, "skills/a/SKILL.md"],
    ["/.stigmer/inputs/data.pdf", true, "inputs/data.pdf"],
    [".stigmer", true, ""],
    [".stigmer/", true, ""],
    ["src/main.py", false, "src/main.py"],
    ["/bin/tools", false, "bin/tools"],
    ["", false, ""],
    [".", false, "."],
    [".stigmerx/stuff", false, ".stigmerx/stuff"],
    ["a/.stigmer/b", false, "a/.stigmer/b"],
  ])("classifies %j → isPlatform=%s remainder=%j", (path, expectedPlatform, expectedRemainder) => {
    const result = classifyPlatformPath(path);
    expect(result.isPlatform).toBe(expectedPlatform);
    expect(result.remainder).toBe(expectedRemainder);
  });

  it("strips multiple leading slashes", () => {
    const result = classifyPlatformPath("///.stigmer/skills/x");
    expect(result.isPlatform).toBe(true);
    expect(result.remainder).toBe("skills/x");
  });

  it("handles nested platform paths", () => {
    const result = classifyPlatformPath(".stigmer/skills/deep/nested/file.md");
    expect(result.isPlatform).toBe(true);
    expect(result.remainder).toBe("skills/deep/nested/file.md");
  });

  it("does not match .stigmer embedded in a deeper path", () => {
    const result = classifyPlatformPath("src/.stigmer/foo");
    expect(result.isPlatform).toBe(false);
    expect(result.remainder).toBe("src/.stigmer/foo");
  });
});

// ── humanizePlatformRefs ─────────────────────────────────────────────────

describe("humanizePlatformRefs", () => {
  it("replaces $STIGMER_PLATFORM_DIR with path", () => {
    expect(
      humanizePlatformRefs("python3 $STIGMER_PLATFORM_DIR/skills/s/run.py"),
    ).toBe("python3 .stigmer/skills/s/run.py");
  });

  it("replaces ${STIGMER_PLATFORM_DIR} with path", () => {
    expect(
      humanizePlatformRefs("python3 ${STIGMER_PLATFORM_DIR}/skills/s/run.py"),
    ).toBe("python3 .stigmer/skills/s/run.py");
  });

  it("replaces standalone $STIGMER_PLATFORM_DIR", () => {
    expect(humanizePlatformRefs("echo $STIGMER_PLATFORM_DIR")).toBe(
      "echo .stigmer",
    );
  });

  it("replaces standalone ${STIGMER_PLATFORM_DIR}", () => {
    expect(humanizePlatformRefs("echo ${STIGMER_PLATFORM_DIR}")).toBe(
      "echo .stigmer",
    );
  });

  it("passes through text without env var", () => {
    expect(humanizePlatformRefs("ls -la")).toBe("ls -la");
  });

  it("returns empty string unchanged", () => {
    expect(humanizePlatformRefs("")).toBe("");
  });

  it("handles multiple occurrences", () => {
    expect(
      humanizePlatformRefs(
        "cp $STIGMER_PLATFORM_DIR/a.txt ${STIGMER_PLATFORM_DIR}/b.txt",
      ),
    ).toBe("cp .stigmer/a.txt .stigmer/b.txt");
  });

  it("replaces mid-string occurrence", () => {
    expect(
      humanizePlatformRefs(
        "Execute command: python3 $STIGMER_PLATFORM_DIR/skills/skill-creator/scripts/init_skill.py agent-creator --path .",
      ),
    ).toBe(
      "Execute command: python3 .stigmer/skills/skill-creator/scripts/init_skill.py agent-creator --path .",
    );
  });

  it("does not match partial name $STIGMER_PLATFORM_DIR_EXTRA", () => {
    const text = "echo $STIGMER_PLATFORM_DIR_EXTRA";
    expect(humanizePlatformRefs(text)).toBe(text);
  });

  it("does not match $STIGMER_PLATFORM_DIRECTORY", () => {
    const text = "echo $STIGMER_PLATFORM_DIRECTORY";
    expect(humanizePlatformRefs(text)).toBe(text);
  });
});

// ── resolvePlatformCommand ───────────────────────────────────────────────

describe("resolvePlatformCommand", () => {
  it("replaces .stigmer in a command with $STIGMER_PLATFORM_DIR", () => {
    expect(
      resolvePlatformCommand("python3 .stigmer/skills/s/run.py"),
    ).toBe("python3 $STIGMER_PLATFORM_DIR/skills/s/run.py");
  });

  it("replaces standalone .stigmer", () => {
    expect(resolvePlatformCommand("ls .stigmer")).toBe(
      "ls $STIGMER_PLATFORM_DIR",
    );
  });

  it("does not replace .stigmer inside a path (foo/.stigmer/bar)", () => {
    expect(resolvePlatformCommand("echo foo/.stigmer/bar")).toBe(
      "echo foo/.stigmer/bar",
    );
  });

  it("does not replace .stigmer inside a word (my.stigmer)", () => {
    expect(resolvePlatformCommand("echo my.stigmer")).toBe(
      "echo my.stigmer",
    );
  });

  it("passes through text without .stigmer", () => {
    expect(resolvePlatformCommand("ls -la")).toBe("ls -la");
  });

  it("returns empty string unchanged", () => {
    expect(resolvePlatformCommand("")).toBe("");
  });

  it("handles multiple standalone occurrences", () => {
    expect(
      resolvePlatformCommand("ls .stigmer && cat .stigmer/skills/a.md"),
    ).toBe(
      "ls $STIGMER_PLATFORM_DIR && cat $STIGMER_PLATFORM_DIR/skills/a.md",
    );
  });

  it("is the inverse of humanizePlatformRefs for display→command roundtrip", () => {
    const display = "python3 .stigmer/skills/s/run.py";
    const command = resolvePlatformCommand(display);
    expect(command).toBe("python3 $STIGMER_PLATFORM_DIR/skills/s/run.py");
    expect(humanizePlatformRefs(command)).toBe(display);
  });
});

// ── humanizeSandboxPaths ─────────────────────────────────────────────────

describe("humanizeSandboxPaths", () => {
  const wsRoot = "/home/daytona/workspace";

  it("strips workspace root prefix from paths", () => {
    expect(
      humanizeSandboxPaths("ls /home/daytona/workspace/plantonhq/", wsRoot),
    ).toBe("ls plantonhq/");
  });

  it("replaces bare workspace root with '.'", () => {
    expect(
      humanizeSandboxPaths("cd /home/daytona/workspace && ls", wsRoot),
    ).toBe("cd . && ls");
  });

  it("replaces sandbox home with '~'", () => {
    expect(
      humanizeSandboxPaths("cat /home/daytona/.bashrc", wsRoot),
    ).toBe("cat ~/.bashrc");
  });

  it("passes through text without sandbox paths", () => {
    expect(humanizeSandboxPaths("ls -la", wsRoot)).toBe("ls -la");
  });

  it("returns text unchanged when workspaceRoot is empty", () => {
    expect(humanizeSandboxPaths("anything", "")).toBe("anything");
  });

  it("returns empty string unchanged", () => {
    expect(humanizeSandboxPaths("", wsRoot)).toBe("");
  });

  it("handles trailing slash on workspace root", () => {
    expect(
      humanizeSandboxPaths("ls /home/daytona/workspace/src/", wsRoot + "/"),
    ).toBe("ls src/");
  });

  it("handles multiple path replacements in one string", () => {
    expect(
      humanizeSandboxPaths(
        "diff /home/daytona/workspace/a.ts /home/daytona/workspace/b.ts",
        wsRoot,
      ),
    ).toBe("diff a.ts b.ts");
  });

  it("replaces workspace root even when embedded in longer path", () => {
    // Simple string replacement (matches Python behavior) — workspace2
    // becomes .2 because the replacement is not word-boundary-aware.
    expect(
      humanizeSandboxPaths("echo /home/daytona/workspace2/foo", wsRoot),
    ).toBe("echo .2/foo");
  });

  it("replaces home directory for paths outside workspace", () => {
    expect(
      humanizeSandboxPaths("cat /home/daytona/.git-credentials", wsRoot),
    ).toBe("cat ~/.git-credentials");
  });

  it("handles workspace root at filesystem root level", () => {
    expect(
      humanizeSandboxPaths("ls /workspace/foo", "/workspace"),
    ).toBe("ls foo");
  });
});

// ── resolveDisplayEnvVars ────────────────────────────────────────────────

describe("resolveDisplayEnvVars", () => {
  it("resolves $KEY to value", () => {
    expect(
      resolveDisplayEnvVars("--path $OUTPUT_DIR", { OUTPUT_DIR: "." }),
    ).toBe("--path .");
  });

  it("resolves ${KEY} to value", () => {
    expect(
      resolveDisplayEnvVars("--path ${OUTPUT_DIR}", { OUTPUT_DIR: "out" }),
    ).toBe("--path out");
  });

  it("resolves multiple variables", () => {
    expect(
      resolveDisplayEnvVars("$OUTPUT_DIR/$PROJECT_NAME", {
        OUTPUT_DIR: "build",
        PROJECT_NAME: "demo",
      }),
    ).toBe("build/demo");
  });

  it("returns text unchanged when envVars is empty", () => {
    expect(resolveDisplayEnvVars("$OUTPUT_DIR", {})).toBe("$OUTPUT_DIR");
  });

  it("returns empty string unchanged", () => {
    expect(resolveDisplayEnvVars("", { OUTPUT_DIR: "." })).toBe("");
  });

  it("does not resolve secret keys", () => {
    expect(
      resolveDisplayEnvVars(
        "echo $API_TOKEN",
        { API_TOKEN: "sk-secret-xxx" },
        new Set(["API_TOKEN"]),
      ),
    ).toBe("echo $API_TOKEN");
  });

  it("resolves non-secret keys even with sensitive-looking names", () => {
    expect(
      resolveDisplayEnvVars(
        "echo $DB_PASSWORD",
        { DB_PASSWORD: "hunter2" },
        new Set(),
      ),
    ).toBe("echo hunter2");
  });

  it("handles mixed secret and non-secret keys", () => {
    expect(
      resolveDisplayEnvVars(
        "$OUTPUT_DIR $AUTH_TOKEN",
        { OUTPUT_DIR: ".", AUTH_TOKEN: "sk-xxx" },
        new Set(["AUTH_TOKEN"]),
      ),
    ).toBe(". $AUTH_TOKEN");
  });

  it("skips $STIGMER_PLATFORM_DIR (handled by humanizePlatformRefs)", () => {
    expect(
      resolveDisplayEnvVars("$STIGMER_PLATFORM_DIR/skills", {
        STIGMER_PLATFORM_DIR: "/tmp/platform",
      }),
    ).toBe("$STIGMER_PLATFORM_DIR/skills");
  });

  it("does not match partial variable names", () => {
    expect(
      resolveDisplayEnvVars("$OUTPUT_DIR_EXTRA", { OUTPUT_DIR: "." }),
    ).toBe("$OUTPUT_DIR_EXTRA");
  });

  it("resolves all keys when no secretKeys provided", () => {
    expect(
      resolveDisplayEnvVars("$API_TOKEN", { API_TOKEN: "resolved" }),
    ).toBe("resolved");
  });

  it("handles keys with special regex characters", () => {
    expect(
      resolveDisplayEnvVars("$MY_KEY", { "MY_KEY": "value" }),
    ).toBe("value");
  });

  it("handles value at end of string (no trailing char after $KEY)", () => {
    expect(
      resolveDisplayEnvVars("path=$OUTPUT_DIR", { OUTPUT_DIR: "/out" }),
    ).toBe("path=/out");
  });
});

// ── Combined pipeline ────────────────────────────────────────────────────

describe("combined display pipeline", () => {
  it("humanize platform refs first, then resolve env vars", () => {
    let text = "python3 $STIGMER_PLATFORM_DIR/run.py --path $OUTPUT_DIR";
    text = humanizePlatformRefs(text);
    text = resolveDisplayEnvVars(text, { OUTPUT_DIR: "." });
    expect(text).toBe("python3 .stigmer/run.py --path .");
  });

  it("full pipeline: humanize platform → resolve env → humanize sandbox", () => {
    const wsRoot = "/home/daytona/workspace";
    let text =
      "python3 $STIGMER_PLATFORM_DIR/run.py --cwd /home/daytona/workspace/src --out $OUTPUT_DIR";

    text = humanizePlatformRefs(text);
    text = resolveDisplayEnvVars(text, { OUTPUT_DIR: "build" });
    text = humanizeSandboxPaths(text, wsRoot);

    expect(text).toBe("python3 .stigmer/run.py --cwd src --out build");
  });

  it("command roundtrip: display → resolve → humanize", () => {
    const display = "bash .stigmer/skills/lint/run.sh --fix";
    const command = resolvePlatformCommand(display);
    expect(command).toBe("bash $STIGMER_PLATFORM_DIR/skills/lint/run.sh --fix");
    const backToDisplay = humanizePlatformRefs(command);
    expect(backToDisplay).toBe(display);
  });
});
