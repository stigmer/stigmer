// A stdio command that fails to start an MCP server: it writes a diagnostic to
// stderr and exits non-zero. Used to assert connect --dry-run surfaces a clear
// connection error (and the subprocess stderr) rather than hanging.

process.stderr.write("fixture boom: missing CONFIG\n");
process.exit(1);
