module github.com/stigmer/stigmer/backend/services/workflow-runner

go 1.25.6

// Local development: Use APIs from monorepo
replace github.com/stigmer/stigmer/apis/stubs/go => ../../../apis/stubs/go

// Force older version of protocompile to avoid vendored protobuf conflicts
// See: https://github.com/bazelbuild/rules_go/issues/1877
replace github.com/bufbuild/protocompile => github.com/bufbuild/protocompile v0.10.0

// Fix temporal-codec-server examples/golang test dependency issue
// The packages/golang module references examples/golang which doesn't have a proper version
exclude github.com/mrsimonemms/temporal-codec-server/examples/golang v0.0.0-00010101000000-000000000000

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1
	buf.build/go/protovalidate v1.1.0
	github.com/Masterminds/semver/v3 v3.4.0
	github.com/aws/aws-sdk-go-v2 v1.41.0
	github.com/aws/aws-sdk-go-v2/config v1.32.6
	github.com/aws/aws-sdk-go-v2/credentials v1.19.6
	github.com/aws/aws-sdk-go-v2/service/s3 v1.95.0
	github.com/fullstorydev/grpcurl v1.9.3
	github.com/go-playground/locales v0.14.1
	github.com/go-playground/universal-translator v0.18.1
	github.com/go-playground/validator/v10 v10.30.1
	github.com/itchyny/gojq v0.12.18
	github.com/mrsimonemms/golang-helpers v0.4.1
	github.com/mrsimonemms/temporal-codec-server/packages/golang v0.0.0-20250917111850-1e5f24c60fac
	github.com/posthog/posthog-go v1.8.2
	github.com/rs/zerolog v1.34.0
	github.com/serverlessworkflow/sdk-go/v3 v3.2.0
	github.com/spf13/cobra v1.10.2
	github.com/spf13/viper v1.21.0
	github.com/stigmer/stigmer/apis/stubs/go v0.0.0-00010101000000-000000000000
	go.temporal.io/sdk v1.39.0
	google.golang.org/grpc v1.78.0
	gopkg.in/yaml.v3 v3.0.1
	sigs.k8s.io/yaml v1.6.0
)

require (
	github.com/BurntSushi/toml v1.6.0 // indirect
	github.com/go-viper/mapstructure/v2 v2.4.0
	github.com/google/uuid v1.6.0
	github.com/joho/godotenv v1.5.1 // Required for .env file loading
	github.com/stretchr/testify v1.11.1
	go.temporal.io/api v1.59.0
	go.temporal.io/sdk/contrib/envconfig v0.1.0 // indirect
	google.golang.org/protobuf v1.36.11 // Required for protobuf types
)

require (
	cel.dev/expr v0.24.0 // indirect
	github.com/antlr4-go/antlr/v4 v4.13.1 // indirect
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.7.4 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.18.16 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.4.16 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.7.16 // indirect
	github.com/aws/aws-sdk-go-v2/internal/ini v1.8.4 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.4.16 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.4 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/checksum v1.9.7 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.13.16 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/s3shared v1.19.16 // indirect
	github.com/aws/aws-sdk-go-v2/service/signin v1.0.4 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.30.8 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.35.12 // indirect
	github.com/aws/aws-sdk-go-v2/service/sts v1.41.5 // indirect
	github.com/aws/smithy-go v1.24.0 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/bufbuild/protocompile v0.14.1 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/cncf/xds/go v0.0.0-20251210132809-ee656c7534f5 // indirect
	github.com/cpuguy83/go-md2man/v2 v2.0.7 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/envoyproxy/go-control-plane/envoy v1.36.0 // indirect
	github.com/envoyproxy/protoc-gen-validate v1.3.0 // indirect
	github.com/facebookgo/clock v0.0.0-20150410010913-600d898af40a // indirect
	github.com/fsnotify/fsnotify v1.9.0 // indirect
	github.com/gabriel-vasile/mimetype v1.4.12 // indirect
	github.com/go-jose/go-jose/v4 v4.1.3 // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/golang/mock v1.6.0 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/google/cel-go v0.26.1 // indirect
	github.com/grpc-ecosystem/go-grpc-middleware/v2 v2.3.3 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.27.4 // indirect
	github.com/hashicorp/golang-lru/v2 v2.0.7 // indirect
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/itchyny/timefmt-go v0.1.7 // indirect
	github.com/jhump/protoreflect v1.17.0 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/nexus-rpc/sdk-go v0.5.1 // indirect
	github.com/pelletier/go-toml/v2 v2.2.4 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/planetscale/vtprotobuf v0.6.1-0.20240319094008-0393e58bdf10 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	github.com/prometheus/client_golang v1.23.2 // indirect
	github.com/prometheus/client_model v0.6.2 // indirect
	github.com/prometheus/common v0.67.4 // indirect
	github.com/prometheus/procfs v0.19.2 // indirect
	github.com/robfig/cron v1.2.0 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/russross/blackfriday/v2 v2.1.0 // indirect
	github.com/sagikazarmark/locafero v0.12.0 // indirect
	github.com/samber/lo v1.52.0 // indirect
	github.com/samber/slog-common v0.19.0 // indirect
	github.com/samber/slog-zerolog/v2 v2.9.0 // indirect
	github.com/spf13/afero v1.15.0 // indirect
	github.com/spf13/cast v1.10.0 // indirect
	github.com/spf13/pflag v1.0.10 // indirect
	github.com/spiffe/go-spiffe/v2 v2.6.0 // indirect
	github.com/stoewer/go-strcase v1.3.1 // indirect
	github.com/stretchr/objx v0.5.3 // indirect
	github.com/subosito/gotenv v1.6.0 // indirect
	github.com/tidwall/gjson v1.18.0 // indirect
	github.com/tidwall/match v1.2.0 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/twmb/murmur3 v1.1.8 // indirect
	github.com/uber-go/tally/v4 v4.1.17 // indirect
	github.com/xeipuuv/gojsonpointer v0.0.0-20190905194746-02993c407bfb // indirect
	github.com/xeipuuv/gojsonreference v0.0.0-20180127040603-bd5ef7bd5415 // indirect
	github.com/xeipuuv/gojsonschema v1.2.0 // indirect
	go.temporal.io/sdk/contrib/tally v0.2.0 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	go.yaml.in/yaml/v2 v2.4.3 // indirect
	go.yaml.in/yaml/v3 v3.0.4 // indirect
	golang.org/x/crypto v0.46.0 // indirect
	golang.org/x/exp v0.0.0-20251023183803-a4bb9ffd2546 // indirect
	golang.org/x/net v0.48.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/sys v0.40.0 // indirect
	golang.org/x/text v0.32.0 // indirect
	golang.org/x/time v0.14.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260114163908-3f89685c29c3 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251222181119-0a764e51fe1b // indirect
)
