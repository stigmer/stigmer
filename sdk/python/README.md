# Stigmer Python SDK

Build AI agents and workflows in Python.

## Installation

```bash
pip install stigmer
```

## Quick Start

```python
from stigmer import workflow

@workflow.task
def extract_data(ctx):
    # Your task logic
    ctx.set_output("data", extracted_data)

@workflow.task
def transform_data(ctx):
    data = ctx.get_input("data")
    # Transform logic
    ctx.set_output("result", transformed)

workflow.run("my-pipeline")
```

## Documentation

See the [main documentation](https://docs.stigmer.ai) for complete guides.

## License

Apache License 2.0
