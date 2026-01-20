module github.com/stigmer/stigmer/backend/services/stigmer-server

go 1.24.0

toolchain go1.24.12

// Local development: Use APIs from monorepo
replace github.com/stigmer/stigmer/apis/stubs/go => ../../../apis/stubs/go

// Local development: Use backend libs from monorepo
replace github.com/stigmer/stigmer/backend/libs/go => ../../../backend/libs/go

require (
	github.com/google/uuid v1.6.0
	github.com/rs/zerolog v1.34.0
	github.com/stigmer/stigmer/apis/stubs/go v0.0.0-00010101000000-000000000000
	github.com/stigmer/stigmer/backend/libs/go v0.0.0-00010101000000-000000000000
	go.temporal.io/sdk v1.39.0
	google.golang.org/grpc v1.78.0
	google.golang.org/protobuf v1.36.11
)

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1 // indirect
	buf.build/go/protovalidate v1.1.0 // indirect
	cel.dev/expr v0.24.0 // indirect
	github.com/antlr4-go/antlr/v4 v4.13.1 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/dgraph-io/badger/v4 v4.5.0 // indirect
	github.com/dgraph-io/ristretto/v2 v2.0.0 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/facebookgo/clock v0.0.0-20150410010913-600d898af40a // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/golang/groupcache v0.0.0-20200121045136-8c9f03a8e57e // indirect
	github.com/golang/mock v1.6.0 // indirect
	github.com/google/cel-go v0.26.1 // indirect
	github.com/google/flatbuffers v24.3.25+incompatible // indirect
	github.com/grpc-ecosystem/go-grpc-middleware/v2 v2.3.3 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.27.4 // indirect
	github.com/klauspost/compress v1.18.0 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/nexus-rpc/sdk-go v0.5.1 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/robfig/cron v1.2.0 // indirect
	github.com/stoewer/go-strcase v1.3.1 // indirect
	github.com/stretchr/objx v0.5.3 // indirect
	github.com/stretchr/testify v1.11.1 // indirect
	go.opencensus.io v0.24.0 // indirect
	go.temporal.io/api v1.59.0 // indirect
	golang.org/x/exp v0.0.0-20250813145105-42675adae3e6 // indirect
	golang.org/x/net v0.48.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/text v0.32.0 // indirect
	golang.org/x/time v0.14.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260114163908-3f89685c29c3 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251222181119-0a764e51fe1b // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)
