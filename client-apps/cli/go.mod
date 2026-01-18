module github.com/stigmer/stigmer/client-apps/cli

go 1.23

replace github.com/stigmer/stigmer => ../..

require (
	github.com/pkg/errors v0.9.1
	github.com/rs/zerolog v1.33.0
	github.com/spf13/cobra v1.8.1
	github.com/stigmer/stigmer v0.0.0-00010101000000-000000000000
	google.golang.org/grpc v1.70.0
	gopkg.in/yaml.v3 v3.0.1
)
