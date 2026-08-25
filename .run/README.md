# IntelliJ IDEA Run Configurations

This directory contains run configurations for IntelliJ IDEA to make development easier.

## Available Configurations

### Build & Generate

- **build-protos** - Generate protobuf stubs using `make protos`
- **gazelle** - Run Gazelle to generate/update BUILD.bazel files

(The Go server/CLI launch and remote-debug configs retired with the Go server — go-server-retirement, D4 #25. The TypeScript server runs via `make build-server && node dist/main.js`, or through `stigmer up`.)

## Usage

1. Open the "Run/Debug Configurations" dropdown in the toolbar
2. Select the desired configuration
3. Click Run (▶️) or Debug (🐛)

### Bazel Plugin Required

The `gazelle` configuration requires the [Bazel plugin](https://plugins.jetbrains.com/plugin/8609-bazel) for IntelliJ.

Install via: **Settings → Plugins → Marketplace → Search "Bazel"**

## Typical Workflow

1. **After proto changes**: Run `build-protos`
2. **After adding new Go files** (sdk/go, tools, seedpack): Run `gazelle` to update BUILD files

## Customization

You can duplicate and customize these configurations:

1. Right-click a configuration in the Run menu
2. Select "Edit Configurations..."
3. Click the duplicate button (📋)
4. Modify as needed (add env vars, args, etc.)

---

**Note**: These configurations are checked into git for team consistency. Personal customizations should be made on duplicates.
