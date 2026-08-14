// stubscrub removes @internal comment sections from protoc-generated stubs.
//
// protoc copies proto leading comments into generated code verbatim, which
// makes the stubs the one generated surface the proto2schema strip cannot
// reach (oss#497). This tool applies the same convention — owned by
// tools/codegen/internalcomment — to the generated files themselves:
// everything from a full-line "@internal" marker to the end of its comment
// block is dropped, except @generated machine trailers, which generators
// place at the end of doc blocks and tooling greps for.
//
// It runs inside the stub generation paths (apis/scripts/gen-stubs.sh on
// the pre-swap temp tree, and sdk/go's codegen-stubs target), so committed
// stubs and release-built stubs are scrubbed identically. Release CI
// regenerates stubs from scratch (release.cli.yaml), which is why the strip
// must live here and not as a one-off cleanup.
//
// Usage:
//
//	stubscrub DIR...          scrub .go/.ts/.py files under each DIR in place
//	stubscrub -check DIR...   exit 1 listing files that still carry markers
//
// Java stubs are not processed: protoc-java does not copy leading comments
// into javadoc, so they are clean by construction (verified at oss#497).
package main

import (
	"bytes"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/stigmer/stigmer/tools/codegen/internalcomment"
)

func main() {
	check := flag.Bool("check", false, "report files carrying @internal comment sections instead of rewriting them")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: stubscrub [-check] DIR...\n")
		flag.PrintDefaults()
	}
	flag.Parse()
	if flag.NArg() == 0 {
		flag.Usage()
		os.Exit(2)
	}

	var dirty []string
	scrubbedFiles := 0
	for _, root := range flag.Args() {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				return nil
			}
			scrub := scrubberFor(path)
			if scrub == nil {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if !bytes.Contains(data, []byte(internalcomment.Marker)) {
				return nil
			}
			out, changed := scrub(data)
			if !changed {
				return nil
			}
			if *check {
				dirty = append(dirty, path)
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			if err := os.WriteFile(path, out, info.Mode().Perm()); err != nil {
				return err
			}
			scrubbedFiles++
			return nil
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "stubscrub: %v\n", err)
			os.Exit(1)
		}
	}

	if *check {
		if len(dirty) > 0 {
			fmt.Fprintf(os.Stderr, "stubscrub: %d file(s) carry @internal comment sections — regenerate stubs (make protos):\n", len(dirty))
			for _, f := range dirty {
				fmt.Fprintf(os.Stderr, "  %s\n", f)
			}
			os.Exit(1)
		}
		fmt.Println("stubscrub: no @internal comment sections found")
		return
	}
	fmt.Printf("stubscrub: scrubbed %d file(s)\n", scrubbedFiles)
}

func scrubberFor(path string) func([]byte) ([]byte, bool) {
	switch filepath.Ext(path) {
	case ".go":
		return scrubGo
	case ".ts":
		return scrubTs
	case ".py":
		return scrubPy
	default:
		return nil
	}
}

// scrubGo handles protoc-gen-go(-grpc) output: contiguous runs of "//" line
// comments. Only blocks containing a marker are rewritten; kept lines are
// re-emitted with the block's own "//" prefix.
func scrubGo(data []byte) ([]byte, bool) {
	lines := strings.Split(string(data), "\n")
	var out []string
	changed := false

	for i := 0; i < len(lines); {
		if !isGoComment(lines[i]) {
			out = append(out, lines[i])
			i++
			continue
		}
		start := i
		for i < len(lines) && isGoComment(lines[i]) {
			i++
		}
		block := lines[start:i]

		prefix, texts := goBlockTexts(block)
		kept, stripped := internalcomment.StripLines(texts)
		if !stripped {
			out = append(out, block...)
			continue
		}
		changed = true
		for _, text := range kept {
			if text == "" {
				out = append(out, prefix)
			} else {
				out = append(out, prefix+" "+text)
			}
		}
	}

	if !changed {
		return data, false
	}
	return []byte(strings.Join(out, "\n")), true
}

func isGoComment(line string) bool {
	return strings.HasPrefix(strings.TrimSpace(line), "//")
}

// goBlockTexts splits a "//" block into its shared prefix (indentation plus
// "//", taken from the first line) and the per-line comment text.
func goBlockTexts(block []string) (prefix string, texts []string) {
	idx := strings.Index(block[0], "//")
	prefix = block[0][:idx+2]
	texts = make([]string, len(block))
	for i, line := range block {
		j := strings.Index(line, "//")
		texts[i] = strings.TrimPrefix(line[j+2:], " ")
	}
	return prefix, texts
}

// scrubTs handles protoc-gen-es output: "/** ... */" JSDoc blocks. Kept
// lines are re-emitted as INDENT + " * " + text; a block reduced to nothing
// is removed entirely.
func scrubTs(data []byte) ([]byte, bool) {
	lines := strings.Split(string(data), "\n")
	var out []string
	changed := false

	for i := 0; i < len(lines); {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed != "/**" {
			out = append(out, lines[i])
			i++
			continue
		}
		start := i
		i++
		for i < len(lines) && strings.TrimSpace(lines[i]) != "*/" {
			i++
		}
		if i == len(lines) { // unterminated block: leave untouched
			out = append(out, lines[start:]...)
			break
		}
		closing := lines[i]
		i++
		middle := lines[start+1 : i-1]

		texts := make([]string, len(middle))
		for k, line := range middle {
			texts[k] = tsCommentText(line)
		}
		kept, stripped := internalcomment.StripLines(texts)
		if !stripped {
			out = append(out, lines[start:i]...)
			continue
		}
		changed = true
		if len(kept) == 0 {
			continue // fully internal block: drop it, including the fences
		}
		indent := lines[start][:strings.Index(lines[start], "/**")]
		out = append(out, lines[start])
		for _, text := range kept {
			if text == "" {
				out = append(out, indent+" *")
			} else {
				out = append(out, indent+" * "+text)
			}
		}
		out = append(out, closing)
	}

	if !changed {
		return data, false
	}
	return []byte(strings.Join(out, "\n")), true
}

func tsCommentText(line string) string {
	trimmed := strings.TrimSpace(line)
	trimmed = strings.TrimPrefix(trimmed, "*")
	return strings.TrimPrefix(trimmed, " ")
}

// scrubPy handles grpc-python output: method docstrings in *_pb2_grpc.py.
// Docstring body lines are kept verbatim (they carry their own
// indentation), so only the cut itself is synthesized.
func scrubPy(data []byte) ([]byte, bool) {
	lines := strings.Split(string(data), "\n")
	var out []string
	changed := false

	for i := 0; i < len(lines); {
		trimmed := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(trimmed, `"""`) || isSingleLineDocstring(trimmed) {
			out = append(out, lines[i])
			i++
			continue
		}
		start := i
		i++
		for i < len(lines) && !strings.HasSuffix(strings.TrimSpace(lines[i]), `"""`) {
			i++
		}
		if i == len(lines) { // unterminated: leave untouched
			out = append(out, lines[start:]...)
			break
		}
		closing := lines[i]
		i++
		middle := lines[start+1 : i-1]

		kept, stripped := internalcomment.StripLines(middle)
		if !stripped {
			out = append(out, lines[start:i]...)
			continue
		}
		changed = true
		out = append(out, lines[start])
		out = append(out, kept...)
		out = append(out, closing)
	}

	if !changed {
		return data, false
	}
	return []byte(strings.Join(out, "\n")), true
}

func isSingleLineDocstring(trimmed string) bool {
	return len(trimmed) >= 6 && strings.HasSuffix(trimmed, `"""`) && trimmed != `"""`
}
