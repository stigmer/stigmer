package root

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/llm"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

func newServerLLMCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "llm",
		Short: "Manage local LLM models",
		Long: `Manage local LLM models and configuration.
		
This command allows you to:
- List available models
- Pull new models
- Switch between models
- Check LLM provider status`,
	}

	cmd.AddCommand(newServerLLMListCommand())
	cmd.AddCommand(newServerLLMPullCommand())
	cmd.AddCommand(newServerLLMStatusCommand())

	return cmd
}

func newServerLLMListCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List available models",
		Run: func(cmd *cobra.Command, args []string) {
			handleLLMList(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

func newServerLLMPullCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "pull MODEL",
		Short: "Pull a new model",
		Long: `Pull a new model from the LLM provider.

Examples:
  stigmer server llm pull codellama:7b
  stigmer server llm pull deepseek-coder:6.7b`,
		Args: cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			handleLLMPull(args[0])
		},
	}
}

func newServerLLMStatusCommand() *cobra.Command {
	var jsonOutput, quietOutput bool

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show LLM provider status",
		Run: func(cmd *cobra.Command, args []string) {
			handleLLMStatus(resolveResultFormat(jsonOutput, quietOutput))
		},
	}

	addResultFormatFlags(cmd, &jsonOutput, &quietOutput)
	return cmd
}

// handleLLMStatus shows LLM configuration as a standalone command result.
func handleLLMStatus(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		result := clioutput.Warning("Unable to load LLM configuration")
		renderer.Render(result)
		return
	}

	result := clioutput.Success("LLM configuration")
	addLLMSections(result, cfg)
	renderer.Render(result)
}

// addLLMSections appends LLM configuration and runtime status to an existing result.
// Used both by the standalone `stigmer server llm status` and by `handleServerStatus`.
func addLLMSections(result *clioutput.CommandResult, cfg *config.Config) {
	provider := cfg.Backend.Local.ResolveLLMProvider()
	model := cfg.Backend.Local.ResolveLLMModel()

	sec := result.AddSection("LLM Configuration")

	switch provider {
	case "ollama":
		running, pid, models, err := llm.GetStatus()
		if err != nil {
			sec.Fieldf("Provider", "Local (Error: %v)", err)
			return
		}

		if running {
			sec.Field("Provider", "Local ✓ Running")
			if pid > 0 {
				sec.Fieldf("PID", "%d", pid)
			}
			sec.Field("Model", model)
			if len(models) > 0 {
				sec.Field("Available", strings.Join(models, ", "))
			}
		} else {
			sec.Field("Provider", "Local ✗ Not Running")
			sec.Fieldf("Model", "%s (will be downloaded on first use)", model)
		}

	case "anthropic":
		sec.Field("Provider", "Anthropic (Cloud)")
		sec.Field("Model", model)
		if apiKey := cfg.Backend.Local.ResolveLLMAPIKey(); apiKey != "" {
			sec.Field("API Key", "Configured ✓")
		} else {
			sec.Field("API Key", "Not configured ✗")
		}

	case "openai":
		sec.Field("Provider", "OpenAI (Cloud)")
		sec.Field("Model", model)
		if apiKey := cfg.Backend.Local.ResolveLLMAPIKey(); apiKey != "" {
			sec.Field("API Key", "Configured ✓")
		} else {
			sec.Field("API Key", "Not configured ✗")
		}

	default:
		sec.Fieldf("Provider", "Unknown (%s)", provider)
	}
}

func handleLLMList(format clioutput.OutputFormat) {
	renderer := clioutput.NewRenderer(format, os.Stdout, os.Stderr)

	cfg, err := config.Load()
	if err != nil {
		clierr.Handle(err)
		return
	}

	provider := cfg.Backend.Local.ResolveLLMProvider()

	if provider != "ollama" {
		result := clioutput.Warning("Local model management is only available for local LLM provider")
		result.Hintf("Current provider: %s", provider)
		result.Hint("To use local models:")
		result.Hint("  stigmer config set llm.provider ollama")
		renderer.Render(result)
		return
	}

	if !llm.IsRunning() {
		result := clioutput.Warning("Local LLM server is not running")
		result.Hint("Start the server first:")
		result.Hint("  stigmer server")
		renderer.Render(result)
		return
	}

	models, err := llm.ListModels(context.Background())
	if err != nil {
		clierr.Handle(err)
		return
	}

	if len(models) == 0 {
		result := clioutput.Warning("No models installed")
		result.Hint("To pull a model:")
		result.Hint("  stigmer server llm pull qwen2.5-coder:7b")
		renderer.Render(result)
		return
	}

	currentModel := cfg.Backend.Local.ResolveLLMModel()

	result := clioutput.Success("Available models")
	sec := result.AddSection("")
	for _, m := range models {
		if m == currentModel {
			sec.Itemf("%s (current)", m)
		} else {
			sec.Item(m)
		}
	}
	result.Hint("To pull a new model:")
	result.Hint("  stigmer server llm pull <model-name>")
	renderer.Render(result)
}

// handleLLMPull pulls a new model (uses cliprint.ProgressDisplay -- excluded from clioutput migration)
func handleLLMPull(model string) {
	cfg, err := config.Load()
	if err != nil {
		climsg.Error("Failed to load configuration")
		clierr.Handle(err)
		return
	}

	provider := cfg.Backend.Local.ResolveLLMProvider()

	if provider != "ollama" {
		climsg.Warning("Local model management is only available for local LLM provider")
		climsg.Info("Current provider: %s", provider)
		return
	}

	if !llm.IsRunning() {
		climsg.Warning("Local LLM server is not running")
		climsg.Info("")
		climsg.Info("Start the server first:")
		climsg.Info("  stigmer server")
		return
	}

	climsg.Info("Pulling model %s...", model)
	climsg.Info("This may take several minutes depending on model size")
	fmt.Println("")

	progress := cliprint.NewProgressDisplay()
	progress.Start()
	progress.SetPhase(cliprint.PhaseInstalling, fmt.Sprintf("Downloading %s...", model))

	opts := &llm.SetupOptions{
		Progress: progress,
		Model:    model,
	}

	if err := llm.PullModel(context.Background(), model, "", opts); err != nil {
		progress.Stop()
		climsg.Error("Failed to pull model")
		clierr.Handle(err)
		return
	}

	progress.Stop()
	climsg.Success("Model %s is ready", model)
	fmt.Println("")
	climsg.Info("To use this model, update your configuration:")
	climsg.Info("  stigmer config set llm.model %s", model)
}
