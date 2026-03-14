//go:build embed_webconsole

package webconsole

import (
	"embed"
	"io/fs"
)

//go:embed all:out
var embeddedAssets embed.FS

func init() {
	sub, err := fs.Sub(embeddedAssets, "out")
	if err != nil {
		panic("webconsole: failed to access embedded assets: " + err.Error())
	}
	assetsFS = sub
}
