package picker

import (
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
)

const (
	debounceDelay = 300 * time.Millisecond
	maxVisible    = 10
)

// searchResultMsg carries the results of an async search back to the model.
type searchResultMsg struct {
	query string
	items []Item
	err   error
}

// debounceMsg fires after the debounce delay elapses.
type debounceMsg struct {
	query string
}

type model struct {
	prompt    string
	textInput textinput.Model
	searchFn  func(query string) ([]Item, error)

	items    []Item
	cursor   int
	loading  bool
	err      error
	selected *Item
	quit     bool

	lastQuery   string
	pendingTick bool
}

func newModel(cfg Config) model {
	ti := textinput.New()
	ti.Placeholder = "type to search..."
	ti.Prompt = fmt.Sprintf("? %s: ", cfg.Prompt)
	ti.Focus()
	ti.CharLimit = 200

	if cfg.InitQuery != "" {
		ti.SetValue(cfg.InitQuery)
	}

	return model{
		prompt:    cfg.Prompt,
		textInput: ti,
		searchFn:  cfg.SearchFn,
		lastQuery: cfg.InitQuery,
		loading:   true,
	}
}

func (m model) Init() tea.Cmd {
	return tea.Batch(
		textinput.Blink,
		m.performSearch(m.lastQuery),
	)
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		return m.handleKey(msg)
	case searchResultMsg:
		return m.handleSearchResult(msg)
	case debounceMsg:
		if msg.query == m.textInput.Value() {
			m.loading = true
			return m, m.performSearch(msg.query)
		}
		return m, nil
	}

	var cmd tea.Cmd
	m.textInput, cmd = m.textInput.Update(msg)
	return m, cmd
}

func (m model) View() tea.View {
	var b strings.Builder

	b.WriteString(m.textInput.View())
	b.WriteString("\n\n")

	if m.err != nil {
		b.WriteString(errStyle.Render(fmt.Sprintf("  Error: %s", m.err)))
		b.WriteString("\n")
	} else if m.loading {
		b.WriteString(loadingStyle.Render("  searching..."))
		b.WriteString("\n")
	} else if len(m.items) == 0 {
		b.WriteString(emptyStyle.Render("  no results"))
		b.WriteString("\n")
	} else {
		start, end := m.visibleWindow()
		for i := start; i < end; i++ {
			item := m.items[i]
			if i == m.cursor {
				b.WriteString(cursorGlyph)
				b.WriteString(activeItemStyle.Render(item.Title))
			} else {
				b.WriteString(blankCursor)
				b.WriteString(inactiveItemStyle.Render(item.Title))
			}
			if item.Subtitle != "" {
				b.WriteString("  ")
				b.WriteString(subtitleStyle.Render(item.Subtitle))
			}
			if item.Meta != "" {
				b.WriteString("  ")
				b.WriteString(metaStyle.Render(item.Meta))
			}
			b.WriteString("\n")
		}

		b.WriteString("\n")
		countLabel := fmt.Sprintf("%d result", len(m.items))
		if len(m.items) != 1 {
			countLabel += "s"
		}
		b.WriteString(hintStyle.Render(fmt.Sprintf("  %s  |  up/down: navigate  |  enter: select  |  esc: cancel", countLabel)))
		b.WriteString("\n")
	}

	return tea.NewView(b.String())
}

func (m model) handleKey(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "enter":
		if len(m.items) > 0 && m.cursor < len(m.items) {
			selected := m.items[m.cursor]
			m.selected = &selected
			return m, tea.Quit
		}
		return m, nil
	case "esc", "ctrl+c":
		m.quit = true
		return m, tea.Quit
	case "up", "ctrl+p":
		if m.cursor > 0 {
			m.cursor--
		}
		return m, nil
	case "down", "ctrl+n":
		if m.cursor < len(m.items)-1 {
			m.cursor++
		}
		return m, nil
	}

	prevValue := m.textInput.Value()
	var cmd tea.Cmd
	m.textInput, cmd = m.textInput.Update(msg)

	if m.textInput.Value() != prevValue {
		m.cursor = 0
		return m, tea.Batch(cmd, m.scheduleDebouncedSearch())
	}

	return m, cmd
}

func (m model) handleSearchResult(msg searchResultMsg) (tea.Model, tea.Cmd) {
	if msg.query != m.textInput.Value() {
		return m, nil
	}

	m.loading = false
	m.err = msg.err
	m.items = msg.items
	if m.cursor >= len(m.items) {
		m.cursor = max(0, len(m.items)-1)
	}
	return m, nil
}

func (m model) performSearch(query string) tea.Cmd {
	searchFn := m.searchFn
	return func() tea.Msg {
		items, err := searchFn(query)
		return searchResultMsg{query: query, items: items, err: err}
	}
}

func (m model) scheduleDebouncedSearch() tea.Cmd {
	query := m.textInput.Value()
	return tea.Tick(debounceDelay, func(time.Time) tea.Msg {
		return debounceMsg{query: query}
	})
}

func (m model) visibleWindow() (start, end int) {
	total := len(m.items)
	if total <= maxVisible {
		return 0, total
	}
	half := maxVisible / 2
	start = m.cursor - half
	if start < 0 {
		start = 0
	}
	end = start + maxVisible
	if end > total {
		end = total
		start = end - maxVisible
	}
	return start, end
}
