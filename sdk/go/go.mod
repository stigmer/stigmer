module github.com/stigmer/stigmer/sdk/go

go 1.25.0

require (
	github.com/google/uuid v1.6.0
	github.com/stigmer/stigmer/apis/stubs/go v0.0.0
	github.com/stretchr/testify v1.11.1
	google.golang.org/protobuf v1.36.11
)

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1 // indirect
	github.com/davecgh/go-spew v1.1.1 // indirect
	github.com/pmezard/go-difflib v1.0.0 // indirect
	golang.org/x/net v0.47.0 // indirect
	golang.org/x/sys v0.38.0 // indirect
	golang.org/x/text v0.31.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251029180050-ab9386a59fda // indirect
	google.golang.org/grpc v1.78.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

// Use local proto stubs from the main stigmer repository
replace github.com/stigmer/stigmer/apis/stubs/go => ../../apis/stubs/go
