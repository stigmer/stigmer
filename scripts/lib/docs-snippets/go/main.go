// The docs snippet gate's Go checker: type-checks each docs fence, as the
// gate assembled it, with go/types over the export data `go list -export`
// wrote for the packages the fences import. It uses only the standard
// library, so the gate needs no module beyond the SDK's own.
//
// A docs fragment shows a call, not a program, so the variables it declares
// often go unused; Go's compiler refuses that outright, and this checker
// ignores exactly that error in a fragment and reports every other one. A
// whole file is a program, held to Go's own rule.
//
// Input (stdin, JSON): {"exports": {"<import path>": "<export file>"},
// "units": [{"id": 1, "src": "package main ...", "fragment": true}]}.
// Output (stdout, JSON): [{"id": 1, "line": 3, "message": "..."}].
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"strings"
)

type unit struct {
	ID       int    `json:"id"`
	Src      string `json:"src"`
	Fragment bool   `json:"fragment"`
}

type input struct {
	Exports map[string]string `json:"exports"`
	Units   []unit            `json:"units"`
}

type finding struct {
	ID      int    `json:"id"`
	Line    int    `json:"line"`
	Message string `json:"message"`
}

func main() {
	var in input
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		fmt.Fprintln(os.Stderr, "docs-snippets-check: reading input:", err)
		os.Exit(2)
	}
	findings := []finding{}
	for _, u := range in.Units {
		findings = append(findings, check(u, in.Exports)...)
	}
	if err := json.NewEncoder(os.Stdout).Encode(findings); err != nil {
		fmt.Fprintln(os.Stderr, "docs-snippets-check: writing output:", err)
		os.Exit(2)
	}
}

func check(u unit, exports map[string]string) []finding {
	fset := token.NewFileSet()
	var out []finding
	file, err := parser.ParseFile(fset, "snippet.go", u.Src, parser.AllErrors)
	if err != nil {
		if list, ok := err.(interface{ Unwrap() []error }); ok {
			for _, e := range list.Unwrap() {
				out = append(out, positioned(u.ID, fset, e))
			}
		} else {
			out = append(out, finding{ID: u.ID, Line: 0, Message: err.Error()})
		}
		return out
	}
	lookup := func(path string) (io.ReadCloser, error) {
		f, ok := exports[path]
		if !ok || f == "" {
			return nil, fmt.Errorf("no export data for %q (is it a dependency of the SDK module?)", path)
		}
		return os.Open(f)
	}
	conf := types.Config{
		Importer: importer.ForCompiler(fset, "gc", lookup),
		Error: func(err error) {
			te, ok := err.(types.Error)
			if ok && u.Fragment && unusedVariable(te.Msg) {
				return
			}
			out = append(out, positioned(u.ID, fset, err))
		},
	}
	_, _ = conf.Check("main", fset, []*ast.File{file}, nil)
	return out
}

// unusedVariable reports go/types' "declared and not used" error, the one
// error a fragment that shows a call is allowed; a whole file is not.
func unusedVariable(msg string) bool {
	return strings.HasPrefix(msg, "declared and not used")
}

func positioned(id int, fset *token.FileSet, err error) finding {
	switch e := err.(type) {
	case types.Error:
		return finding{ID: id, Line: fset.Position(e.Pos).Line, Message: e.Msg}
	case interface{ Error() string }:
		msg := e.Error()
		// scanner errors render as "snippet.go:L:C: message".
		var line, col int
		var rest string
		if n, _ := fmt.Sscanf(msg, "snippet.go:%d:%d:", &line, &col); n == 2 {
			if i := strings.Index(msg, ": "); i >= 0 {
				rest = msg[i+2:]
			}
			return finding{ID: id, Line: line, Message: rest}
		}
		return finding{ID: id, Line: 0, Message: msg}
	}
	return finding{ID: id, Line: 0, Message: err.Error()}
}
