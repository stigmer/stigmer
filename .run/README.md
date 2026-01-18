# IntelliJ/GoLand Run Configurations

This directory contains run configurations for IntelliJ IDEA and GoLand to make development easier.

## Available Configurations

### Build & Generate

- **build-protos** - Generate protobuf stubs using `make protos`
- **gazelle** - Run Gazelle to generate/update BUILD.bazel files
- **bazel-build-all** - Build all Bazel targets with `./bazelw build //...`

### Services

- **stigmer-server.launch** - Launch the Stigmer gRPC server via Bazel
- **stigmer-cli.launch** - Launch the Stigmer CLI via Bazel

### Debugging

- **stigmer-server.remote-debug** - Attach remote Go debugger to running stigmer-server
  - Default port: 2345 (standard Delve port)
  - Start stigmer-server with debugging enabled first

## Usage

### In IntelliJ/GoLand

1. Open the "Run/Debug Configurations" dropdown in the toolbar
2. Select the desired configuration
3. Click Run (▶️) or Debug (🐛)

### Bazel Plugin Required

The `.launch` configurations require the [Bazel plugin](https://plugins.jetbrains.com/plugin/8609-bazel) for IntelliJ.

Install via: **Settings → Plugins → Marketplace → Search "Bazel"**

## Typical Workflow

1. **After proto changes**: Run `build-protos`
2. **After adding new Go files**: Run `gazelle` to update BUILD files
3. **To run the server**: Run `stigmer-server.launch`
4. **To debug the server**: 
   - Start server with `dlv debug` or with `--debug` flag
   - Run `stigmer-server.remote-debug` to attach

## Customization

You can duplicate and customize these configurations:

1. Right-click a configuration in the Run menu
2. Select "Edit Configurations..."
3. Click the duplicate button (📋)
4. Modify as needed (add env vars, args, etc.)

---

**Note**: These configurations are checked into git for team consistency. Personal customizations should be made on duplicates.
