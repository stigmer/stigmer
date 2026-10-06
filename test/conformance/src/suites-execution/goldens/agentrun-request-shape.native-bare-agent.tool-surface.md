<<< tool 1 of 11: think >>>

Record your reasoning when a decision is genuinely hard: choosing between approaches, or working out why something failed. It reads nothing and changes nothing. Do not use it to restate a tool result or to announce your next step; take the step.

input_schema:

```json
{
  "type": "object",
  "properties": {
    "thought": {
      "type": "string",
      "description": "Your reasoning, analysis, or plan."
    }
  },
  "required": [
    "thought"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

<<< tool 2 of 11: web_fetch >>>

Fetch the contents of a URL over http(s). HTML pages are converted to Markdown; plain text, Markdown, JSON, and other text formats are returned as-is. Binary content is not supported.

Large pages are windowed: at most max_length characters are returned per call (default 20000). If the result ends with a truncation notice, call web_fetch again with the same url and the start_index the notice gives you to continue reading.

input_schema:

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The http(s) URL to fetch."
    },
    "max_length": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 100000,
      "description": "Maximum characters to return (default 20000)."
    },
    "start_index": {
      "type": "integer",
      "minimum": 0,
      "description": "Character offset to start from, for paginating large pages (default 0)."
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

<<< tool 3 of 11: ls >>>

Lists all files in a directory.

This is useful for exploring the filesystem and finding the right file to read or edit.
You should almost ALWAYS use this tool before using the read_file or edit_file tools.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path": {
      "default": "/",
      "type": "string"
    }
  },
  "required": [
    "path"
  ],
  "additionalProperties": false
}
```

<<< tool 4 of 11: read_file >>>

Reads a file from the filesystem. Assume any path the user provides is valid; reading a missing file returns an error.

Usage:
- By default, it reads up to 100 lines starting from the beginning of the file. Use `offset`/`limit` to page through large files instead of reading them whole.
- A status header, `@@ field | field | ... @@`, sits above the file content, and every line after it is unmodified file content. When content is truncated, there may be an explanation before the header. Never include the header when editing.
- Speculatively batch multiple `read_file` calls in one response when several files may be useful.
- An empty file returns a system-reminder warning in place of contents.
- Large tool results may be offloaded to a file; the tool message gives the path. Read that path here, paging with `offset`/`limit`.
- Images (`.png`, `.jpg`, etc.), audio, video, and PDFs return multimodal content blocks (https://docs.langchain.com/javascript/langchain/messages#multimodal).
- For images and PDFs, pagination via `offset`/`limit` is text-only - supply `file_path` only.
- Always read a file before editing it.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string"
    },
    "offset": {
      "default": 0,
      "type": "number"
    },
    "limit": {
      "default": 100,
      "type": "number"
    }
  },
  "required": [
    "file_path",
    "offset",
    "limit"
  ],
  "additionalProperties": false
}
```

<<< tool 5 of 11: write_file >>>

Writes content to a file. Creates the file if it does not exist; replaces it entirely if it does.

Usage:
- Use this tool when you intend to create a new file or replace the whole file. You do not need to read the file first.
- Prefer to edit existing files (with the edit_file tool) over creating new ones when possible.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string"
    },
    "content": {
      "type": "string"
    }
  },
  "required": [
    "file_path",
    "content"
  ],
  "additionalProperties": false
}
```

<<< tool 6 of 11: edit_file >>>

Performs exact string replacements in files.

Usage:
- You must read the file before editing; this tool errors otherwise.
- Preserve the exact source indentation from the read output, and never include the read status header in old_string or new_string.
- Prefer editing an existing file over creating a new one.
- Only use emojis if the user explicitly requests it.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string"
    },
    "old_string": {
      "type": "string"
    },
    "new_string": {
      "type": "string"
    },
    "replace_all": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string",
    "replace_all"
  ],
  "additionalProperties": false
}
```

<<< tool 7 of 11: glob >>>

Find files matching a glob pattern, returning absolute paths.

Supports `*` (any characters), `**` (any directories), `?` (single character), e.g. `**/*.py`, `*.txt`, `/subdir/**/*.md`.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string"
    },
    "path": {
      "type": "string"
    }
  },
  "required": [
    "pattern"
  ],
  "additionalProperties": false
}
```

<<< tool 8 of 11: grep >>>

Search for a LITERAL text pattern across files (NOT regex).

The pattern is matched verbatim: regex metacharacters are ordinary characters, not operators. To match any of several strings, run a separate grep for each; `grep(pattern="foo|bar")` searches for the literal text "foo|bar", and `.*` or `\\.` match those characters literally.
- If you genuinely need regex, use the execute tool with `rg '<regex>'` instead.

Returns matching files or content per `output_mode`. Offloaded large tool results live under the artifacts root (`/large_tool_results/` by default); grep that directory to search them when you do not know the exact path.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string"
    },
    "path": {
      "default": "/",
      "type": "string"
    },
    "glob": {
      "default": null,
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "max_count": {
      "default": null,
      "anyOf": [
        {
          "type": "number"
        },
        {
          "type": "null"
        }
      ]
    },
    "output_mode": {
      "default": "content",
      "type": "string",
      "enum": [
        "files_with_matches",
        "content",
        "count"
      ]
    }
  },
  "required": [
    "pattern",
    "path",
    "glob",
    "max_count",
    "output_mode"
  ],
  "additionalProperties": false
}
```

<<< tool 9 of 11: execute >>>

Executes a shell command in an isolated sandbox and returns combined stdout/stderr with the exit code (truncated if very large).

Usage:
- Quote paths containing spaces (e.g. cd "/path/with spaces").
- Chain commands with ';' or '&&' (use '&&' when a command depends on the previous); do not use newlines except inside quoted strings.
- Use absolute paths and avoid `cd` so the working directory stays stable.
- You MUST avoid using search commands like find and grep. Instead use the grep, glob tools to search. Use read_file rather than cat/head/tail.
- execute(command="find . -name '*.py'") # Use glob tool instead
- execute(command="grep -r 'pattern' .") # Use grep tool instead

Only available on backends implementing SandboxBackendProtocol; otherwise it returns an error.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "command": {
      "type": "string"
    },
    "description": {
      "type": "string",
      "description": "A short present-tense phrase describing what this command does and why, shown to the user as the title of this action (5-10 words, e.g. 'Run unit tests for the parser'). Do not restate the command syntax."
    }
  },
  "required": [
    "command"
  ],
  "additionalProperties": false
}
```

<<< tool 10 of 11: task >>>

Launch an ephemeral subagent to handle a complex, multi-step task.

Available agent types and the tools they have access to:
- explore: Read-only codebase exploration specialist. Use for searching, reading files, finding patterns, and understanding code structure. Cannot write files or execute commands.
- shell: Command execution specialist. Use for running shell commands, build operations, and system tasks. Has minimal file read access.
- general-purpose: Runs a multi-step task with the same tools as you, in its own context, and returns one report. Use it only for independent work you need as a summary.

Specify subagent_type to select the agent. Usage notes:
- Launch multiple agents concurrently when their tasks are independent, using a single message with multiple tool calls.
- Each invocation is stateless by default: the agent sees only the prompt you give it and returns a single final report. Put full detail in the prompt and state exactly what it should return — unless an agent type below says it inherits your conversation instead.
- The agent's report is not shown to the user; relay a summary yourself.
- Tell the agent whether to create content, analyze, or only research, since it can't necessarily see the user's intent unless it inherits your conversation, as noted per agent type below.
- If an agent's description says to use it proactively, do so without waiting to be asked.
- When only general-purpose is available, use it for any complex, context-heavy task; it has the same capabilities as the main agent.

input_schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "description": {
      "type": "string"
    },
    "subagent_type": {
      "type": "string"
    }
  },
  "required": [
    "description",
    "subagent_type"
  ],
  "additionalProperties": false
}
```

<<< tool 11 of 11: write_todos >>>

Your to-do list, shown to the user as your progress. Use it when a request has several separate parts, or when the user asks for one. Skip it for a single change, however many steps it takes, and for questions.
- Send the whole list each time. Each item is pending, in_progress or completed; keep exactly one in_progress while you work.
- A `write_todos` call always shares its response with another tool call: update the list alongside your next action, never in a response of its own, and send the last update with your last tool call.
- Call this tool at most once per response.

input_schema:

```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "content": {
            "type": "string",
            "description": "Content of the todo item"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ],
            "description": "Status of the todo"
          }
        },
        "required": [
          "content",
          "status"
        ],
        "additionalProperties": false
      },
      "description": "List of todo items to update"
    }
  },
  "required": [
    "todos"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
