# Contributing to Stigmer SDK

Thank you for your interest in contributing to Stigmer SDK! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the maintainers.

## How to Contribute

### Reporting Issues

- **Search existing issues** before creating a new one
- **Use issue templates** when available
- **Provide details**: SDK language, version, OS, error messages, minimal reproduction
- **Include code snippets** that demonstrate the issue

### Suggesting Enhancements

- **Check roadmap** to see if the feature is already planned
- **Describe the use case** clearly
- **Explain why it would be useful** to most users
- **Provide examples** of how it would work

### Pull Requests

1. **Fork the repository** and create a branch from `main`
2. **Make your changes** following the style guide
3. **Add tests** for new functionality
4. **Update documentation** if needed
5. **Ensure tests pass** (`make test`)
6. **Submit a pull request** with a clear description

## Development Setup

### Go SDK

```bash
cd go/
go mod download
make test
make lint
```

**Requirements**:
- Go 1.22+
- Make
- golangci-lint (optional, for linting)

### Python SDK

```bash
cd python/
poetry install
poetry run pytest
poetry run mypy stigmer/
```

**Requirements**:
- Python 3.11+
- Poetry

### TypeScript SDK

```bash
cd typescript/
npm install
npm test
npm run lint
```

**Requirements**:
- Node.js 18+
- npm or yarn

## Style Guide

### Go

- **Follow Go conventions**: Use `gofmt` and `goimports`
- **Package comments**: Every package needs a doc comment
- **Exported names**: All exported names must have doc comments
- **Error handling**: Wrap errors with context using `fmt.Errorf("context: %w", err)`
- **Tests**: Use table-driven tests where appropriate
- **Naming**: Use `CamelCase` for exports, `camelCase` for internal

**Example**:

```go
// Package agent provides types and functions for defining AI agent blueprints.
package agent

// Agent represents an AI agent configuration.
type Agent struct {
    Name         string
    Instructions string
}

// New creates a new Agent with the given options.
// Returns an error if validation fails.
func New(opts ...Option) (*Agent, error) {
    a := &Agent{}
    for _, opt := range opts {
        if err := opt(a); err != nil {
            return nil, fmt.Errorf("applying option: %w", err)
        }
    }
    return a, nil
}
```

### Python

- **Follow PEP 8**: Use `black` for formatting
- **Type hints**: All functions must have type hints
- **Docstrings**: Use Google-style docstrings
- **Error handling**: Use specific exception types
- **Tests**: Use pytest with descriptive test names

**Example**:

```python
"""Module for defining AI agent blueprints."""

from dataclasses import dataclass
from typing import List, Optional

@dataclass
class Agent:
    """Represents an AI agent configuration.
    
    Attributes:
        name: The agent's name
        instructions: Instructions for the agent
    """
    name: str
    instructions: str
    skills: List[Skill] = field(default_factory=list)
    
    def add_skill(self, skill: Skill) -> None:
        """Adds a skill to the agent.
        
        Args:
            skill: The skill to add
            
        Raises:
            ValueError: If skill is invalid
        """
        if not skill.name:
            raise ValueError("Skill name cannot be empty")
        self.skills.append(skill)
```

### TypeScript

- **Follow TypeScript conventions**: Use `prettier` and `eslint`
- **Type everything**: No `any` types unless absolutely necessary
- **JSDoc comments**: For all exported functions and classes
- **Error handling**: Use proper Error types
- **Tests**: Use Jest with descriptive test names

## Testing Guidelines

### Unit Tests

- **Test all public APIs**: Every exported function/class should have tests
- **Table-driven tests**: Use parameterized tests for multiple cases
- **Error cases**: Test both success and failure paths
- **Edge cases**: Empty strings, nil/null, boundary values

### Integration Tests

- **End-to-end scenarios**: Test complete workflows
- **Manifest generation**: Verify correct proto output
- **File loading**: Test file I/O operations

### Coverage

- **Minimum 80% coverage** for new code
- **100% coverage** for critical paths (validation, proto conversion)

## Commit Messages

Use **Conventional Commits** format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding/updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks

**Examples**:

```
feat(go): add sub-agent file loading support

Adds WithInstructionsFromFile() method for sub-agents,
completing the file loading pattern across all SDK types.

Closes #123
```

```
fix(python): handle empty skill descriptions

Previously would fail validation. Now treats empty
description as valid (description is optional).
```

## Documentation

### Code Documentation

- **Package-level**: Describe what the package does
- **Type-level**: Explain what the type represents
- **Function-level**: Describe parameters, return values, errors

### User Documentation

- **README**: Update if public API changes
- **Examples**: Add/update examples for new features
- **Migration guides**: Document breaking changes

## Release Process

1. **Version bump**: Update version files/constants
2. **Changelog**: Add entry to CHANGELOG.md
3. **Tag release**: Use semantic versioning (`go/v0.2.0`, `python/v0.2.0`)
4. **GitHub Release**: Create release notes
5. **Publish**: Go (push tag), Python (PyPI), TypeScript (npm)

## Language-Specific Notes

### Go SDK

- **Import paths**: Use `github.com/leftbin/stigmer-sdk/go/...`
- **Modules**: Each SDK is a separate module
- **Testing**: Run `go test ./...` from `go/` directory
- **Linting**: Use `golangci-lint run`

### Python SDK

- **Package**: Published to PyPI as `stigmer`
- **Dependencies**: Managed via Poetry
- **Testing**: Use pytest with coverage
- **Type checking**: Use mypy

### TypeScript SDK

- **Package**: Published to npm as `@stigmer/sdk`
- **Build**: TypeScript → JavaScript with type definitions
- **Testing**: Jest for unit tests
- **Linting**: ESLint + Prettier

## Getting Help

- **Documentation**: [docs.stigmer.ai/sdk](https://docs.stigmer.ai/sdk)
- **Issues**: [GitHub Issues](https://github.com/leftbin/stigmer-sdk/issues)
- **Discussions**: [GitHub Discussions](https://github.com/leftbin/stigmer-sdk/discussions)
- **Discord**: [Join our Discord](https://discord.gg/stigmer) (link TBD)

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.

---

Thank you for contributing to Stigmer SDK! 🎉
