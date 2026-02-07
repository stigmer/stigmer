package root

import (
	"os"

	"github.com/spf13/cobra"
)

// NewCompletionCommand creates the shell completion command.
func NewCompletionCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "completion [bash|zsh|fish|powershell]",
		Short: "Generate shell completion scripts",
		Long: `Generate shell completion scripts for Stigmer CLI.

Completions allow you to press Tab to auto-complete commands, flags, and arguments.

To load completions:

Bash:
  # Add to ~/.bashrc:
  source <(stigmer completion bash)

  # Or install permanently:
  stigmer completion bash > /etc/bash_completion.d/stigmer

Zsh:
  # Add to ~/.zshrc:
  source <(stigmer completion zsh)

  # Or if shell completion is not already enabled:
  echo "autoload -U compinit; compinit" >> ~/.zshrc

Fish:
  # Add to config:
  stigmer completion fish | source

  # Or install permanently:
  stigmer completion fish > ~/.config/fish/completions/stigmer.fish

PowerShell:
  # Add to $PROFILE:
  stigmer completion powershell | Out-String | Invoke-Expression
`,
		DisableFlagsInUseLine: true,
		ValidArgs:             []string{"bash", "zsh", "fish", "powershell"},
		Args:                  cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
		Run: func(cmd *cobra.Command, args []string) {
			switch args[0] {
			case "bash":
				_ = cmd.Root().GenBashCompletion(os.Stdout)
			case "zsh":
				_ = cmd.Root().GenZshCompletion(os.Stdout)
			case "fish":
				_ = cmd.Root().GenFishCompletion(os.Stdout, true)
			case "powershell":
				_ = cmd.Root().GenPowerShellCompletionWithDesc(os.Stdout)
			}
		},
	}

	return cmd
}
