//go:build embed_cursorrunner

package cursorrunner

import (
	"embed"
	"io/fs"
)

//go:embed all:source
var embeddedSource embed.FS

func init() {
	sub, err := fs.Sub(embeddedSource, "source")
	if err != nil {
		panic("cursorrunner: failed to access embedded source: " + err.Error())
	}
	sourceFS = sub
}

func devRepoRoot() string { return "" }
