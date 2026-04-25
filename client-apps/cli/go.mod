module github.com/stigmer/stigmer/client-apps/cli

go 1.25.6

replace github.com/stigmer/stigmer => ../..

replace github.com/stigmer/stigmer/sdk/go => ../../sdk/go

replace github.com/stigmer/stigmer/seedpack => ../../seedpack

require (
	buf.build/go/protovalidate v1.1.0
	charm.land/bubbles/v2 v2.0.0
	charm.land/bubbletea/v2 v2.0.1
	charm.land/lipgloss/v2 v2.0.0
	github.com/alecthomas/chroma/v2 v2.23.1
	github.com/charmbracelet/x/ansi v0.11.6
	github.com/fatih/color v1.18.0
	github.com/go-git/go-git/v5 v5.16.4
	github.com/modelcontextprotocol/go-sdk v1.3.0
	github.com/pkg/errors v0.9.1
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2
	github.com/rivo/uniseg v0.4.7
	github.com/rs/zerolog v1.34.0
	github.com/spf13/cobra v1.10.2
	github.com/spf13/pflag v1.0.10
	github.com/stigmer/stigmer/sdk/go v0.0.0-00010101000000-000000000000
	github.com/stigmer/stigmer/seedpack v0.0.0-00010101000000-000000000000
	github.com/stretchr/testify v1.11.1
	golang.org/x/oauth2 v0.34.0
	golang.org/x/sys v0.41.0
	golang.org/x/term v0.39.0
	google.golang.org/grpc v1.79.2
	google.golang.org/protobuf v1.36.11
	gopkg.in/yaml.v3 v3.0.1
)

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1 // indirect
	cel.dev/expr v0.25.1 // indirect
	github.com/antlr4-go/antlr/v4 v4.13.1 // indirect
	github.com/atotto/clipboard v0.1.4 // indirect
	github.com/charmbracelet/colorprofile v0.4.2 // indirect
	github.com/charmbracelet/ultraviolet v0.0.0-20260205113103-524a6607adb8 // indirect
	github.com/charmbracelet/x/term v0.2.2 // indirect
	github.com/charmbracelet/x/termios v0.1.1 // indirect
	github.com/charmbracelet/x/windows v0.2.2 // indirect
	github.com/clipperhouse/displaywidth v0.11.0 // indirect
	github.com/clipperhouse/uax29/v2 v2.7.0 // indirect
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/dlclark/regexp2 v1.11.5 // indirect
	github.com/go-git/gcfg v1.5.1-0.20230307220236-3a3c6141e376 // indirect
	github.com/go-git/go-billy/v5 v5.6.2 // indirect
	github.com/golang-jwt/jwt/v5 v5.3.0 // indirect
	github.com/google/cel-go v0.26.1 // indirect
	github.com/google/jsonschema-go v0.4.2 // indirect
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/jbenet/go-context v0.0.0-20150711004518-d14ea06fba99 // indirect
	github.com/lucasb-eyer/go-colorful v1.3.0 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/mattn/go-runewidth v0.0.20 // indirect
	github.com/muesli/cancelreader v0.2.2 // indirect
	github.com/stoewer/go-strcase v1.3.1 // indirect
	github.com/xo/terminfo v0.0.0-20220910002029-abceb7e1c41e // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	golang.org/x/exp v0.0.0-20251023183803-a4bb9ffd2546 // indirect
	golang.org/x/net v0.48.0 // indirect
	golang.org/x/sync v0.19.0 // indirect
	golang.org/x/text v0.32.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260114163908-3f89685c29c3 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251222181119-0a764e51fe1b // indirect
	gopkg.in/warnings.v0 v0.1.2 // indirect
)
