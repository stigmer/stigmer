// `stigmer completion <shell>` — emit a shell completion script.
//
// Wave 1 provides top-level command completion derived from the live commander
// tree (so new commands appear automatically — the tree is the source of
// truth). Flag-level and dynamic resource completion are a T06 enhancement;
// DD-001 records completion parity as a T04/T06 checklist item, not a
// framework-selection concern.

import type { Command } from "commander";

const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
type Shell = (typeof SHELLS)[number];

export function registerCompletion(program: Command): void {
  program
    .command("completion <shell>")
    .description(`generate a shell completion script (${SHELLS.join(", ")})`)
    .action((shell: string) => {
      if (!isShell(shell)) {
        throw new Error(`unsupported shell "${shell}" (expected one of: ${SHELLS.join(", ")})`);
      }
      const commandNames = topLevelCommandNames(program);
      process.stdout.write(renderScript(shell, commandNames) + "\n");
    });
}

function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

function topLevelCommandNames(program: Command): string[] {
  return program.commands
    .map((command) => command.name())
    .filter((name) => name.length > 0)
    .sort();
}

function renderScript(shell: Shell, commands: string[]): string {
  switch (shell) {
    case "bash":
      return renderBash(commands);
    case "zsh":
      return renderZsh(commands);
    case "fish":
      return renderFish(commands);
    case "powershell":
      return renderPowershell(commands);
  }
}

function renderBash(commands: string[]): string {
  return [
    "# stigmer bash completion",
    "_stigmer_complete() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  if [ "$COMP_CWORD" -eq 1 ]; then',
    `    COMPREPLY=( $(compgen -W "${commands.join(" ")}" -- "$cur") )`,
    "  fi",
    "}",
    "complete -F _stigmer_complete stigmer",
  ].join("\n");
}

function renderZsh(commands: string[]): string {
  return [
    "#compdef stigmer",
    "_stigmer() {",
    `  local -a commands=(${commands.map((c) => `'${c}'`).join(" ")})`,
    "  _arguments '1: :->command' '*::arg:->args'",
    '  if [ "$state" = command ]; then',
    "    compadd -- $commands",
    "  fi",
    "}",
    "_stigmer",
  ].join("\n");
}

function renderFish(commands: string[]): string {
  return commands
    .map(
      (command) =>
        `complete -c stigmer -n __fish_use_subcommand -a ${command} -d '${command} command'`,
    )
    .join("\n");
}

function renderPowershell(commands: string[]): string {
  return [
    "Register-ArgumentCompleter -Native -CommandName stigmer -ScriptBlock {",
    "  param($wordToComplete, $commandAst, $cursorPosition)",
    `  @(${commands.map((c) => `'${c}'`).join(", ")}) |`,
    "    Where-Object { $_ -like \"$wordToComplete*\" } |",
    "    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }",
    "}",
  ].join("\n");
}
