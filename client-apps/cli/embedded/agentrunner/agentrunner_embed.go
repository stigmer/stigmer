//go:build embed_agentrunner

package agentrunner

import (
	"embed"
	"io/fs"
)

//go:embed all:source
var embeddedSource embed.FS

func init() {
	sub, err := fs.Sub(embeddedSource, "source")
	if err != nil {
		panic("agentrunner: failed to access embedded source: " + err.Error())
	}
	sourceFS = sub
}
