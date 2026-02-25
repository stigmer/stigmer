package clioutput

import (
	"encoding/json"
	"fmt"
	"io"
)

// JSONRenderer outputs CommandResult as machine-readable JSON.
//
// Structured data is written to DataOut (typically stdout).
// Status messages are written to StatusOut (typically stderr)
// so that piping captures only the JSON payload.
type JSONRenderer struct {
	DataOut   io.Writer
	StatusOut io.Writer
}

// jsonResult mirrors CommandResult with string-typed status for clean JSON output.
type jsonResult struct {
	Status   string         `json:"status"`
	Message  string         `json:"message"`
	Sections []*jsonSection `json:"sections,omitempty"`
	Hints    []string       `json:"hints,omitempty"`
}

type jsonSection struct {
	Title  string      `json:"title,omitempty"`
	Fields []jsonField `json:"fields,omitempty"`
	Items  []string    `json:"items,omitempty"`
}

type jsonField struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (j *JSONRenderer) Render(result *CommandResult) {
	jr := jsonResult{
		Status:  result.Status.String(),
		Message: result.Message,
		Hints:   result.Hints,
	}

	for _, sec := range result.Sections {
		js := &jsonSection{Title: sec.Title}
		for _, f := range sec.Fields {
			js.Fields = append(js.Fields, jsonField{Key: f.Key, Value: f.Value})
		}
		js.Items = sec.Items
		jr.Sections = append(jr.Sections, js)
	}

	data, err := json.MarshalIndent(jr, "", "  ")
	if err != nil {
		fmt.Fprintf(j.StatusOut, "✗ failed to marshal result to JSON: %v\n", err)
		return
	}

	fmt.Fprintln(j.DataOut, string(data))
}
