module github.com/stigmer/stigmer/client-apps/cli

go 1.24.0

toolchain go1.24.12

replace github.com/stigmer/stigmer => ../..

require (
	github.com/pkg/errors v0.9.1
	github.com/rs/zerolog v1.34.0
	github.com/spf13/cobra v1.8.1
	github.com/stigmer/stigmer v0.0.0-00010101000000-000000000000
	google.golang.org/grpc v1.71.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.19 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/term v0.39.0 // indirect
)
