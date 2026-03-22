# Stigmer Documentation

This directory contains the source files for the Stigmer documentation site.

See the rendered documentation at [Stigmer.ai/docs](https://stigmer.ai/docs).

## Local development

```bash
make docs        # Start docs dev server with hot reload
make lint-docs   # Lint prose with Vale
make format-docs # Format with Prettier
```

## Archive

The `_archive/` directory contains legacy documentation preserved for internal
reference. Archived content is excluded from linting, formatting, and the
rendered site.
