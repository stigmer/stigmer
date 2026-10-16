// The CLI's command tree: what buildProgram registers, how a retired command
// or a retired run or connect option is answered (commander's error plus one pointer line, never an
// alias that still works, and never a retired option's value), that the
// retired `connect mcp-server` points at `connect plugin` and `mcp add`, that
// the retired `plugin eval` and `agent eval` point at `eval run`, that the
// retired `share` points at `channel link` and the console's Manage access, and
// that the run command's vault and plugin flags reach the wire: My vault
// unless --no-my-vault, and each --plugin as a plugin reference.

import { describe, expect, it } from "vitest";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { Command } from "commander";
import { type AgentExecOptions, toAgentExecFlags } from "../commands/agent-exec-flags.js";
import { buildProgram, RETIRED_COMMANDS, RETIRED_OPTIONS, RETIRED_SUBCOMMANDS } from "../program.js";
import { type ControllerFn, createAgentRun } from "../resources/run/create.js";
import { prepareAgentExec } from "../resources/run/prepare.js";
import { VERSION } from "../version.js";

// prepareAgentExec touches client.run only to upload attachments; these
// runs attach nothing.
const STUB_CLIENT = { run: {} } as unknown as Stigmer;

function RUN_HINT(option: string): string {
  return RETIRED_OPTIONS.get("run")?.get(option) ?? `no retired run option ${option}`;
}

// A program whose errors are captured instead of exiting: `subcommand`'s too,
// since commander copies exitOverride to a command only when it is created.
function capturedProgram(subcommand = "run"): { program: Command; stderr: () => string } {
  const program = buildProgram();
  let stderr = "";
  program.exitOverride().configureOutput({ writeErr: (text) => void (stderr += text) });
  program.commands.find((command) => command.name() === subcommand)?.exitOverride();
  return { program, stderr: () => stderr };
}

describe("buildProgram", () => {
  it("registers the foundational commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toContain("version");
    expect(names).toContain("completion");
  });

  it("registers the read commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["search", "usage"]));
  });

  it("registers the artifact commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["push", "download"]));
  });

  it("registers the streaming commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(expect.arrayContaining(["run", "resume"]));
  });

  it("has no draft command: a plugin is authored outside Stigmer and installed, never drafted by a system agent", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).not.toContain("draft");
  });

  it("exposes the channel subcommands, link taking --name", () => {
    const program = buildProgram();
    const channel = program.commands.find((command) => command.name() === "channel");
    const subs = channel?.commands.map((command) => command.name());
    expect(subs).toEqual(["link", "enable", "disable"]);
    const link = channel?.commands.find((command) => command.name() === "link");
    expect(link?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--off", "--audience", "--reset-link", "--name", "--open", "--json", "--quiet"]),
    );
  });

  it("has no share group: channel link replaced it, and the old word is not an alias", () => {
    const program = buildProgram();
    const names = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
    expect(names).not.toContain("share");
  });

  it("answers the retired share with channel link and Manage access", async () => {
    const program = buildProgram();
    let stderr = "";
    program.exitOverride().configureOutput({ writeErr: (text) => void (stderr += text) });
    await expect(program.parseAsync(["share", "agent", "support"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr).toContain("unknown command 'share'");
    expect(stderr).toContain(`${RETIRED_COMMANDS.get("share")}\n`);
    expect(stderr).toContain("stigmer channel link");
    expect(stderr).toContain("Manage access");
  });

  it("exposes the usage subcommands", () => {
    const program = buildProgram();
    const usage = program.commands.find((command) => command.name() === "usage");
    const subs = usage?.commands.map((command) => command.name()).sort();
    expect(subs).toEqual(["agent", "hours", "org", "session"]);
  });

  it("exposes the global flags as persistent options", () => {
    const program = buildProgram();
    const longFlags = program.options.map((option) => option.long);
    expect(longFlags).toEqual(
      expect.arrayContaining(["--debug", "--standalone", "--org", "--api-key"]),
    );
  });

  it("exposes the runs subcommands", () => {
    const program = buildProgram();
    const runs = program.commands.find((command) => command.name() === "runs");
    const subs = runs?.commands.map((command) => command.name()).sort();
    expect(subs).toEqual(["approve", "cancel", "logs", "pause", "resume", "scores", "terminate", "to-eval-case", "trace"]);
  });

  it("exposes eval run, which takes its subject by flag, and eval cancel", () => {
    const program = buildProgram();
    const group = program.commands.find((command) => command.name() === "eval");
    const run = group?.commands.find((command) => command.name() === "run");
    expect(group?.commands.map((command) => command.name())).toEqual(["run", "cancel"]);
    expect(run?.registeredArguments).toEqual([]);
    expect(run?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--agent", "--plugin", "--cases-from", "--case", "--tag", "--runs", "--model", "--ablation", "--threshold", "--max-cost-usd", "--concurrency", "--allow-tools", "--judge-model", "--real-mcp-servers", "--json", "--no-wait"]),
    );
  });

  it("lists eval run's exit codes in its help: the format's, and the CLI's own 3 and 4", () => {
    const run = buildProgram()
      .commands.find((command) => command.name() === "eval")
      ?.commands.find((command) => command.name() === "run");
    let help = "";
    run?.configureOutput({ writeOut: (text) => void (help += text) });
    run?.outputHelp();
    for (const code of ["0", "1", "2", "3", "4", "130"]) expect(help).toMatch(new RegExp(`^  ${code} +\\S`, "m"));
  });

  it("has no plugin group and no agent eval: eval run replaced them, and the old words are not aliases", () => {
    const program = buildProgram();
    expect(program.commands.map((command) => command.name())).not.toContain("plugin");
    const agent = program.commands.find((command) => command.name() === "agent");
    expect(agent?.commands.map((command) => command.name())).toEqual(["quality"]);
  });

  it("answers the retired plugin eval with one line pointing at eval run --plugin", async () => {
    const program = buildProgram();
    let stderr = "";
    program.exitOverride().configureOutput({ writeErr: (text) => void (stderr += text) });
    await expect(program.parseAsync(["plugin", "eval", "thermos"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr).toContain("unknown command 'plugin'");
    expect(stderr).toContain(`${RETIRED_COMMANDS.get("plugin")}\n`);
    expect(stderr).toContain("stigmer eval run --plugin <plugin>");
  });

  it("answers the retired agent eval, in the agent group only, with eval run --agent", async () => {
    const { program, stderr } = capturedProgram("agent");
    await expect(program.parseAsync(["agent", "eval", "support-desk"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr()).toContain("unknown command 'eval'");
    expect(stderr()).toContain(`${RETIRED_SUBCOMMANDS.get("agent")?.get("eval") ?? "no retired agent eval"}\n`);
    expect(stderr()).toContain("stigmer eval run --agent <agent>");
    const runs = capturedProgram("runs");
    await expect(runs.program.parseAsync(["runs", "eval"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(runs.stderr()).not.toContain("stigmer eval run");
  });

  it("has no execution group: runs replaced it, and the old word is not an alias", () => {
    const program = buildProgram();
    const names = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
    expect(names).not.toContain("execution");
  });

  it("answers the retired execution group with one line pointing at runs", async () => {
    const program = buildProgram();
    let stderr = "";
    program.exitOverride().configureOutput({ writeErr: (text) => void (stderr += text) });
    await expect(program.parseAsync(["execution", "logs", "aex_1"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr).toContain("unknown command 'execution'");
    expect(stderr).toContain(`${RETIRED_COMMANDS.get("execution")}\n`);
    expect(stderr).toContain("stigmer runs");
  });

  it("answers the retired connect mcp-server with an agent's own mcp_servers, connect plugin and mcp add", async () => {
    const { program, stderr } = capturedProgram("connect");
    await expect(program.parseAsync(["connect", "mcp-server", "github"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr()).toContain("unknown command 'mcp-server'");
    expect(stderr()).toContain("`mcp_servers`");
    expect(stderr()).toContain("stigmer connect plugin <plugin>");
    expect(stderr()).toContain("stigmer mcp add <name> <url>");
  });

  it("keeps stigmer mcp-server, the command that starts Stigmer's own MCP server, beside mcp add", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toContain("mcp-server");
    const mcp = program.commands.find((command) => command.name() === "mcp");
    expect(mcp?.commands.map((command) => command.name())).toEqual(["add"]);
  });

  it("leaves an unknown command that never existed without a pointer", async () => {
    const program = buildProgram();
    let stderr = "";
    program.exitOverride().configureOutput({ writeErr: (text) => void (stderr += text) });
    await expect(program.parseAsync(["nonsense"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownCommand",
    });
    expect(stderr).not.toContain("stigmer runs");
  });

  it("answers a retired run option with the vault command that replaced it", async () => {
    const { program, stderr } = capturedProgram();
    await expect(
      program.parseAsync(["run", "acme/support", "--secret", "TOKEN=abc"], { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.unknownOption" });
    expect(stderr()).toContain("unknown option '--secret'");
    expect(stderr()).toContain(`${RUN_HINT("--secret")}\n`);
    expect(stderr()).toContain("stigmer vault set-secret NAME --mine");
  });

  it.each([
    ["a plain value", "--env=TOKEN=sk-live-123", "sk-live-123"],
    ["a value holding a quote", "--env=TOKEN=ab'cd-secret", "cd-secret"],
    ["a value holding a newline", "--secret=TOKEN=first\nsecond-secret", "second-secret"],
  ])("never echoes any part of a retired option's value written with '=' (%s)", async (_case, arg, leaked) => {
    const { program, stderr } = capturedProgram();
    await expect(program.parseAsync(["run", "-m", "hi", arg], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
    expect(stderr()).toContain(RUN_HINT(arg.slice(0, arg.indexOf("="))));
    expect(stderr()).not.toContain(leaked);
    expect(stderr()).not.toContain("TOKEN");
  });

  it("gives the run hint on run only: another command meeting --secret answers with commander's error", async () => {
    const { program, stderr } = capturedProgram("resume");
    await expect(
      program.parseAsync(["resume", "ses_01hzzzzzzzzzzzzzzzzzzzzzzz", "--secret", "x"], { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.unknownOption" });
    expect(stderr()).toContain("unknown option '--secret'");
    expect(stderr()).not.toContain("stigmer vault set-secret");
  });

  it("names every retired run option and keeps none on the run command", () => {
    const program = buildProgram();
    const run = program.commands.find((command) => command.name() === "run");
    const flags = run?.options.map((option) => option.long) ?? [];
    const retired = [...(RETIRED_OPTIONS.get("run")?.keys() ?? [])];
    expect([...RETIRED_OPTIONS.keys()]).toEqual(["run", "connect"]);
    expect(retired.sort()).toEqual(["--env", "--env-file", "--secret", "--secret-file"]);
    for (const option of retired) expect(flags).not.toContain(option);
    expect(flags).toEqual(expect.arrayContaining(["--vault", "--no-my-vault"]));
  });

  it("answers connect's retired --env with the vault command, never echoing its value", async () => {
    const { program, stderr } = capturedProgram("connect");
    const connect = program.commands.find((command) => command.name() === "connect");
    connect?.commands.find((command) => command.name() === "plugin")?.exitOverride();
    await expect(
      program.parseAsync(["connect", "plugin", "github", "--env=GITHUB_TOKEN=ghp-live-123"], { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.unknownOption" });
    expect(stderr()).toContain("unknown option '--env'");
    expect(stderr()).toContain(`${RETIRED_OPTIONS.get("connect")?.get("--env") ?? "no retired connect option"}\n`);
    expect(stderr()).toContain("stigmer vault set-secret NAME --mine");
    expect(stderr()).not.toContain("ghp-live-123");
    const flags = connect?.commands.find((command) => command.name() === "plugin")?.options.map((o) => o.long);
    expect(flags).not.toContain("--env");
  });

  it.each([
    [[] as string[], true, [], []],
    [["--no-my-vault", "--vault", "ci-keys"], false, ["acme/ci-keys"], []],
    [["--vault", "support-tools", "--vault", "platform/shared"], true, ["acme/support-tools", "platform/shared"], []],
    [["--plugin", "linear", "--plugin", "platform/github"], true, [], ["acme/linear", "platform/github"]],
  ])(
    "sends the vault and plugin choice the run's flags parse to (%j), through commander to the wire",
    async (flags, includeMyVault, vaults, plugins) => {
      const program = buildProgram();
      const run = program.commands.find((command) => command.name() === "run");
      let parsed: AgentExecOptions | undefined;
      run?.action((_agent: string | undefined, options: AgentExecOptions) => {
        parsed = options;
      });
      await program.parseAsync(["run", "-m", "hi", ...flags], { from: "user" });
      if (parsed === undefined) throw new Error("run's action did not run");

      const prepared = await prepareAgentExec(toAgentExecFlags(parsed), STUB_CLIENT, undefined, { org: "acme" });
      let sent: Run | undefined;
      const controller = (() => ({
        create: (run: Run) => {
          sent = run;
          return Promise.resolve(run);
        },
      })) as unknown as ControllerFn;
      await createAgentRun(controller, {
        orgId: "acme",
        message: prepared.message,
        vaults: prepared.vaults,
        includeMyVault: prepared.includeMyVault,
        plugins: prepared.plugins,
        attachments: [],
        workspaceFileRefs: [],
        workspaceEntries: [],
        model: "",
        mode: "",
        serviceTier: "",
        thinking: "",
        autoApproveAll: false,
        harness: "",
      });
      const target = sent?.spec?.target;
      const spec = target?.case === "sessionSpec" ? target.value : undefined;
      expect(spec?.includeMyVault).toBe(includeMyVault);
      expect(spec?.vaults.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(vaults);
      expect(spec?.plugins.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(plugins);
      expect(spec?.plugins.every((ref) => ref.kind === ApiResourceKind.plugin)).toBe(true);
    },
  );

  it("reports a semver-shaped version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
