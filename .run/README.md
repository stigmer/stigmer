# IntelliJ IDEA Run Configurations

This directory contains run configurations for IntelliJ IDEA to make development easier.

## Available Configurations

### Build & Generate

- **build-protos** - Generate protobuf stubs using `make protos`

(The Go server/CLI launch and remote-debug configs retired with the Go server — go-server-retirement, D4 #25. The `gazelle` config retired with Bazel — 20260904.04 Stage A; Go packages need no BUILD files now, so there is nothing to regenerate after adding Go code. The TypeScript server runs via `make build-server && node dist/main.js`, or through `stigmer up`.)

## Usage

1. Open the "Run/Debug Configurations" dropdown in the toolbar
2. Select the desired configuration
3. Click Run (▶️) or Debug (🐛)

## Typical Workflow

1. **After proto changes**: Run `build-protos`

## Customization

You can duplicate and customize these configurations:

1. Right-click a configuration in the Run menu
2. Select "Edit Configurations..."
3. Click the duplicate button (📋)
4. Modify as needed (add env vars, args, etc.)

---

**Note**: These configurations are checked into git for team consistency. Personal customizations should be made on duplicates.
