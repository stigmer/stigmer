"""Checkpointer module for LangGraph state persistence.

This module provides a factory async context manager for creating mode-aware
LangGraph checkpointers that enable:
1. HITL (Human-in-the-Loop) approval flow - interrupt/resume execution
2. Conversational context preservation - multi-turn conversations

Supported Checkpointers:
-----------------------
- MemorySaver: In-memory (ephemeral, fast, zero setup)
- AsyncSqliteSaver: File-based (persistent, single-instance)
- MongoDBSaver: Database (persistent, multi-instance safe)

Usage:
------
``create_checkpointer`` is an async context manager that yields a ready-to-use
``BaseCheckpointSaver``. The context manager ensures that underlying resources
(SQLite connections, MongoDB clients) are properly cleaned up on exit.

```python
from stigmer_runner.worker.config import Config
from stigmer_runner.worker.checkpointer import create_checkpointer

config = Config.load_from_env()
async with create_checkpointer(config.checkpointer) as checkpointer:
    agent = create_deep_agent(..., checkpointer=checkpointer)
    # checkpointer is valid for the lifetime of this block
```
"""

from stigmer_runner.worker.checkpointer.factory import create_checkpointer

__all__ = ["create_checkpointer"]
