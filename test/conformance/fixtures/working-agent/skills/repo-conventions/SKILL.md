---
name: repo-conventions
description: How to change Go code in this repository - error wrapping, table-driven tests, doc comments, no new dependencies, and running go test before finishing.
---
# Repository conventions

Follow these whenever you change Go code here.

1. Read the file and its test before editing.
2. Wrap returned errors with context: `fmt.Errorf("parse %q: %w", s, err)`.
3. Extend the package's table-driven test with a row for every behaviour you
   add or fix; do not add a second test function for the same function.
4. Keep the doc comment of an exported function true; it starts with the
   function's name.
5. Use the standard library only.
6. Run `go test ./...` and report the result.
