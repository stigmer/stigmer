# Contributing to Stigmer

Thank you for your interest in contributing to Stigmer! This document provides guidelines for contributing to the project.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## Getting Started

### Development Setup

**Prerequisites**:
- Go 1.21 or later
- Python 3.11 or later
- Protocol Buffers compiler (`protoc`)
- `buf` CLI tool

**Clone and build**:

```bash
git clone https://github.com/stigmer/stigmer.git
cd stigmer
make setup    # Install dependencies
make build    # Build CLI and runners
make test     # Run tests
```

### Project Structure

```
stigmer/
├── cmd/stigmer/          # CLI entry point
├── internal/             # Internal packages
│   ├── backend/         # Backend implementations
│   ├── workflow/        # Workflow engine
│   └── agent/           # Agent execution
├── sdk/                 # SDKs for Go and Python
├── runners/             # Workflow and agent runners
├── apis/                # Protobuf definitions
├── docs/                # Documentation
└── examples/            # Example agents and workflows
```

### Running Tests

```bash
# Run all tests
make test

# Run specific package tests
go test ./internal/backend/local/...

# Run with coverage
make coverage
```

### Code Generation

Protocol Buffer definitions are in `apis/`. After modifying protos:

```bash
make proto-gen
```

This generates Go and Python code from `.proto` files.

## How to Contribute

### Reporting Bugs

**Before submitting**:
- Search existing issues to avoid duplicates
- Test against the latest `main` branch
- Gather logs and reproduction steps

**Include in your report**:
- Stigmer version (`stigmer version`)
- Operating system and version
- Complete error messages and stack traces
- Minimal reproduction steps
- Expected vs. actual behavior

### Suggesting Features

Feature requests are welcome! Please include:
- Clear use case (what problem does this solve?)
- Proposed API or user experience
- Examples of how it would work
- Alternative solutions you considered

### Pull Requests

**General workflow**:

1. **Fork and branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes**
   - Write tests for new functionality
   - Update documentation
   - Follow code style guidelines (below)

3. **Run checks**
   ```bash
   make lint      # Run linters
   make test      # Run tests
   make build     # Ensure it builds
   ```

4. **Commit with clear messages**
   ```bash
   git commit -m "feat: add secret rotation for local backend"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `test:` Test additions or fixes
   - `refactor:` Code refactoring
   - `chore:` Build or tooling changes

5. **Push and create PR**
   ```bash
   git push origin feature/my-feature
   ```

   Open a pull request on GitHub with:
   - Clear title and description
   - Reference related issues
   - Screenshots/examples if applicable

### PR Review Process

1. **Automated checks** run on all PRs (tests, linting, build)
2. **Maintainer review** (usually within 2-3 business days)
3. **Address feedback** if requested
4. **Merge** once approved and checks pass

## Code Style

### Go

**Follow standard Go conventions**:
- `gofmt` for formatting (enforced by CI)
- Clear, descriptive variable names
- Comments for exported functions and types
- Error handling with wrapped errors

**Example**:

```go
// CreateExecution creates a new workflow execution in the backend.
// Returns an error if the workflow definition is not found.
func (b *Backend) CreateExecution(ctx context.Context, req *pb.CreateExecutionRequest) (*pb.Execution, error) {
    if req.WorkflowId == "" {
        return nil, errors.New("workflow_id is required")
    }
    
    // Implementation...
    
    return execution, nil
}
```

### Python

**Follow PEP 8**:
- Type hints for function signatures
- Docstrings for classes and functions
- `black` for formatting (enforced by CI)

**Example**:

```python
def create_execution(workflow_id: str, inputs: dict[str, str]) -> Execution:
    """Create a new workflow execution.
    
    Args:
        workflow_id: Unique identifier for the workflow definition
        inputs: Key-value pairs for workflow inputs
        
    Returns:
        The created execution object
        
    Raises:
        ValueError: If workflow_id is empty
    """
    if not workflow_id:
        raise ValueError("workflow_id is required")
    
    # Implementation...
    
    return execution
```

### Protobuf

- Use `buf` for linting and formatting
- Include comments for all messages and fields
- Follow [Buf style guide](https://buf.build/docs/best-practices/style-guide)

## Testing Guidelines

### Unit Tests

**Required for**:
- All new backend functionality
- SDK methods
- Workflow and agent execution logic

**Example**:

```go
func TestCreateExecution(t *testing.T) {
    backend := setupTestBackend(t)
    
    req := &pb.CreateExecutionRequest{
        WorkflowId: "wf-test-123",
        Inputs: map[string]string{"key": "value"},
    }
    
    exec, err := backend.CreateExecution(context.Background(), req)
    assert.NoError(t, err)
    assert.NotEmpty(t, exec.Id)
    assert.Equal(t, "wf-test-123", exec.WorkflowId)
}
```

### Integration Tests

Integration tests live in `tests/integration/`. They test complete workflows:

```go
func TestLocalBackendEndToEnd(t *testing.T) {
    // Initialize local backend
    backend := setupLocalBackend(t)
    
    // Create workflow
    workflow := createTestWorkflow(t, backend)
    
    // Execute
    execution := executeWorkflow(t, backend, workflow.Id)
    
    // Verify results
    assert.Equal(t, pb.ExecutionStatus_COMPLETED, execution.Status)
}
```

### Test Helpers

Use shared test utilities in `internal/testutil/`:

```go
import "github.com/stigmer/stigmer/internal/testutil"

func TestSomething(t *testing.T) {
    db := testutil.NewTestDB(t)           // Auto-cleanup BadgerDB
    backend := testutil.NewTestBackend(t) // Mock backend
    // ...
}
```

## Documentation

### Updating Docs

Documentation lives in `docs/`:

```
docs/
├── architecture/        # System design and architecture
├── getting-started/     # Tutorials and guides
└── api/                 # API reference
```

**When to update**:
- New features require getting-started guides
- API changes need reference doc updates
- Architecture changes need design documentation

**Style**:
- Clear, concise writing
- Code examples that work
- Screenshots for UI-related changes

### API Documentation

Generated from Protobuf comments:

```protobuf
// CreateExecution creates a new workflow execution.
// The workflow definition must exist in the backend.
rpc CreateExecution(CreateExecutionRequest) returns (Execution);
```

Appears in generated docs automatically.

## Release Process

Maintainers handle releases, but here's the process:

1. Version bump in `VERSION` file
2. Update `CHANGELOG.md`
3. Tag release: `git tag v1.2.3`
4. Push tag: `git push origin v1.2.3`
5. CI builds and publishes binaries

## Getting Help

**Questions?**
- **Discord**: [Join #contributors channel](https://discord.gg/stigmer)
- **GitHub Discussions**: [Ask in Q&A](https://github.com/stigmer/stigmer/discussions)
- **Email**: contributors@stigmer.ai

## Recognition

Contributors are recognized in:
- `CONTRIBUTORS.md` file
- Release notes for major contributions
- Annual contributor highlights blog post

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

---

**Thank you for making Stigmer better!** 🚀
