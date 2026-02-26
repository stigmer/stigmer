// Package clioutput provides a structured output system for CLI commands.
//
// Instead of ad-hoc fmt.Println calls, commands build a CommandResult that
// captures status, message, structured sections, and hints. A Renderer
// then formats the result for human, JSON, or quiet output.
package clioutput

import "fmt"

// ResultStatus represents the outcome of a command execution.
type ResultStatus int

const (
	StatusSuccess ResultStatus = iota
	StatusWarning
	StatusError
)

// String returns the lowercase name of the status.
func (s ResultStatus) String() string {
	switch s {
	case StatusSuccess:
		return "success"
	case StatusWarning:
		return "warning"
	case StatusError:
		return "error"
	default:
		return "unknown"
	}
}

// CommandResult is the structured output of a CLI command.
// Build one using Success(), Warning(), or Error(), then attach
// sections and hints before passing it to a Renderer.
type CommandResult struct {
	Status   ResultStatus
	Message  string
	Sections []*Section
	Hints    []string
}

// Section groups related output fields under an optional title.
type Section struct {
	Title  string
	Fields []KeyValue
	Items  []string
}

// KeyValue is a labeled datum within a section.
type KeyValue struct {
	Key   string
	Value string
}

// Success creates a CommandResult with StatusSuccess.
func Success(message string, args ...any) *CommandResult {
	return &CommandResult{
		Status:  StatusSuccess,
		Message: fmt.Sprintf(message, args...),
	}
}

// Warning creates a CommandResult with StatusWarning.
func Warning(message string, args ...any) *CommandResult {
	return &CommandResult{
		Status:  StatusWarning,
		Message: fmt.Sprintf(message, args...),
	}
}

// Error creates a CommandResult with StatusError.
func Error(message string, args ...any) *CommandResult {
	return &CommandResult{
		Status:  StatusError,
		Message: fmt.Sprintf(message, args...),
	}
}

// AddSection appends a new section and returns a pointer to it.
// The pointer is heap-allocated and remains valid regardless of
// how many subsequent sections are added.
func (r *CommandResult) AddSection(title string) *Section {
	s := &Section{Title: title}
	r.Sections = append(r.Sections, s)
	return s
}

// Hint appends a hint line to the result.
func (r *CommandResult) Hint(text string) *CommandResult {
	r.Hints = append(r.Hints, text)
	return r
}

// Hintf appends a formatted hint line to the result.
func (r *CommandResult) Hintf(format string, args ...any) *CommandResult {
	r.Hints = append(r.Hints, fmt.Sprintf(format, args...))
	return r
}

// Field appends a key-value pair to the section.
func (s *Section) Field(key, value string) *Section {
	s.Fields = append(s.Fields, KeyValue{Key: key, Value: value})
	return s
}

// Fieldf appends a key with a formatted value to the section.
func (s *Section) Fieldf(key, format string, args ...any) *Section {
	s.Fields = append(s.Fields, KeyValue{Key: key, Value: fmt.Sprintf(format, args...)})
	return s
}

// Item appends a bullet-list item to the section.
func (s *Section) Item(text string) *Section {
	s.Items = append(s.Items, text)
	return s
}

// Itemf appends a formatted bullet-list item to the section.
func (s *Section) Itemf(format string, args ...any) *Section {
	s.Items = append(s.Items, fmt.Sprintf(format, args...))
	return s
}
