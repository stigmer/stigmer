package root

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// PostExecAction represents an action the user can take after execution completes.
type PostExecAction int

const (
	PostExecViewConversation PostExecAction = iota
	PostExecViewDetails
	PostExecDone
)

// postExecChoice represents a selectable option in the post-execution menu.
type postExecChoice struct {
	action PostExecAction
	label  string
	desc   string
}

// defaultPostExecChoices are the options presented after execution completes.
var defaultPostExecChoices = []postExecChoice{
	{action: PostExecViewConversation, label: "View conversation", desc: "Show all messages inline"},
	{action: PostExecViewDetails, label: "View execution details", desc: "Run stigmer get execution"},
	{action: PostExecDone, label: "Done", desc: "Exit"},
}

// postExecMenuModel is the Bubbletea model for the post-execution menu.
type postExecMenuModel struct {
	choices   []postExecChoice
	cursor    int
	selection PostExecAction
	done      bool
}

// newPostExecMenuModel creates a new post-execution menu model.
func newPostExecMenuModel() postExecMenuModel {
	return postExecMenuModel{
		choices:   defaultPostExecChoices,
		selection: PostExecDone,
	}
}

// Init implements tea.Model.
func (m postExecMenuModel) Init() tea.Cmd {
	return nil
}

// Update implements tea.Model.
func (m postExecMenuModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return m, nil
	}

	switch keyMsg.String() {
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down", "j":
		if m.cursor < len(m.choices)-1 {
			m.cursor++
		}
	case "enter":
		m.selection = m.choices[m.cursor].action
		m.done = true
		return m, tea.Quit
	case "q", "ctrl+c":
		m.selection = PostExecDone
		m.done = true
		return m, tea.Quit
	}

	return m, nil
}

// View implements tea.Model.
func (m postExecMenuModel) View() string {
	var b strings.Builder
	b.WriteString("\n")
	b.WriteString(menuHeaderStyle.Render("What would you like to do?"))
	b.WriteString("\n\n")

	for i, choice := range m.choices {
		if i == m.cursor {
			b.WriteString(menuActiveStyle.Render(fmt.Sprintf("  ▸ %s", choice.label)))
			b.WriteString(menuDescStyle.Render(fmt.Sprintf("  (%s)", choice.desc)))
		} else {
			b.WriteString(menuInactiveStyle.Render(fmt.Sprintf("    %s", choice.label)))
			b.WriteString(menuDescStyle.Render(fmt.Sprintf("  (%s)", choice.desc)))
		}
		b.WriteString("\n")
	}

	b.WriteString("\n")
	b.WriteString(menuHintStyle.Render("  ↑↓ move  enter select  q quit"))
	b.WriteString("\n")

	return b.String()
}

// Styles for post-execution menu rendering.
var (
	menuHeaderStyle   = lipgloss.NewStyle().Bold(true)
	menuActiveStyle   = lipgloss.NewStyle().Bold(true)
	menuInactiveStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	menuDescStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))
	menuHintStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Italic(true)
)

// showPostExecMenu displays an interactive menu after execution completes.
// Returns the selected action. Returns PostExecDone if not in a TTY.
func showPostExecMenu() PostExecAction {
	// Non-interactive: skip menu and exit
	if !display.IsTerminal() {
		return PostExecDone
	}

	model := newPostExecMenuModel()
	program := tea.NewProgram(model)

	finalModel, err := program.Run()
	if err != nil {
		return PostExecDone
	}

	result, ok := finalModel.(postExecMenuModel)
	if !ok {
		return PostExecDone
	}

	return result.selection
}

// displayConversation shows all messages from the execution inline.
func displayConversation(exec *agentexecutionv1.AgentExecution) {
	fmt.Println()
	fmt.Println(menuHeaderStyle.Render("═══ Conversation ═══"))
	fmt.Println()

	messages := exec.GetStatus().GetMessages()
	if len(messages) == 0 {
		fmt.Println(menuDescStyle.Render("  (no messages)"))
		fmt.Println()
		return
	}

	for _, msg := range messages {
		switch msg.Type {
		case agentexecutionv1.MessageType_MESSAGE_HUMAN:
			fmt.Printf("💬 You: %s\n\n", msg.Content)
		case agentexecutionv1.MessageType_MESSAGE_AI:
			if msg.Content != "" {
				fmt.Printf("🤖 Agent: %s\n\n", msg.Content)
			}
		case agentexecutionv1.MessageType_MESSAGE_TOOL:
			// Show tool call summary
			if len(msg.ToolCalls) > 0 {
				for _, tc := range msg.ToolCalls {
					fmt.Printf("  🔧 %s\n", formatToolCallSummary(tc))
				}
				fmt.Println()
			} else if msg.Content != "" {
				// Fallback to content preview
				preview := msg.Content
				if len(preview) > 80 {
					preview = preview[:77] + "..."
				}
				fmt.Printf("  ↳ %s\n\n", preview)
			}
		case agentexecutionv1.MessageType_MESSAGE_SYSTEM:
			fmt.Printf("ℹ️  %s\n\n", msg.Content)
		}
	}
}

// formatToolCallSummary returns a one-line summary of a tool call.
func formatToolCallSummary(tc *agentexecutionv1.ToolCall) string {
	if tc == nil {
		return "(unknown tool)"
	}

	name := tc.Name
	status := mapToolCallStatus(tc.Status)

	// Extract primary arg if available
	var primaryArg string
	if tc.Args != nil {
		argsMap := tc.Args.AsMap()
		// Check common primary fields
		for _, field := range []string{"path", "command", "query", "url"} {
			if val, ok := argsMap[field]; ok {
				if s, ok := val.(string); ok && s != "" {
					primaryArg = s
					if len(primaryArg) > 40 {
						primaryArg = primaryArg[:37] + "..."
					}
					break
				}
			}
		}
	}

	if primaryArg != "" {
		return fmt.Sprintf("%s(%s) [%s]", name, primaryArg, status)
	}
	return fmt.Sprintf("%s [%s]", name, status)
}
