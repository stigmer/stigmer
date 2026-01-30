"""Checkpointer module for LangGraph state persistence.

This module provides factory functions for creating mode-aware LangGraph
checkpointers that enable:
1. HITL (Human-in-the-Loop) approval flow - interrupt/resume execution
2. Conversational context preservation - multi-turn conversations

Supported Checkpointers:
-----------------------
- MemorySaver: In-memory (ephemeral, fast, zero setup)
- AsyncSqliteSaver: File-based (persistent, single-instance)
- AsyncMongoDBSaver: Database (persistent, multi-instance safe)

Usage:
------
```python
from worker.config import Config
from worker.checkpointer import create_checkpointer

config = Config.load_from_env()
checkpointer = await create_checkpointer(config.checkpointer)
```
"""

from worker.checkpointer.factory import create_checkpointer

__all__ = ["create_checkpointer"]
