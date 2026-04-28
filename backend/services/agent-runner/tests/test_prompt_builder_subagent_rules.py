"""Tests for sub-agent delegation rules in the system prompt.

Validates that ``_SUB_AGENT_RULES`` in ``prompt_builder.py`` contains
the required sections: concurrency limit, when-NOT-to-delegate guidance,
when-TO-delegate guidance, and delegation best practices.

These rules were accidentally dropped during a refactor on March 26 and
must remain present going forward.
"""

from stigmer_runner.worker.activities.graphton.prompt_builder import _SUB_AGENT_RULES


class TestSubAgentRulesPresence:
    """Guard against regression of sub-agent prompt rules."""

    def test_concurrency_limit_present(self):
        assert "Concurrency limit" in _SUB_AGENT_RULES
        assert "3 sub-agents" in _SUB_AGENT_RULES

    def test_when_not_to_delegate_present(self):
        assert "When NOT to delegate" in _SUB_AGENT_RULES

    def test_read_files_directly_rule(self):
        assert "read" in _SUB_AGENT_RULES.lower()
        assert "directly" in _SUB_AGENT_RULES.lower()

    def test_single_step_lookups_rule(self):
        assert "Single-step lookups" in _SUB_AGENT_RULES

    def test_small_tasks_rule(self):
        assert "fewer than 3 steps" in _SUB_AGENT_RULES

    def test_when_to_delegate_present(self):
        assert "When TO delegate" in _SUB_AGENT_RULES

    def test_delegation_best_practices_present(self):
        assert "Delegation best practices" in _SUB_AGENT_RULES

    def test_result_usage_rule(self):
        assert "MUST reference and synthesize" in _SUB_AGENT_RULES

    def test_cost_awareness_rule(self):
        assert "tokens and time" in _SUB_AGENT_RULES

    def test_runtime_enforcement_mentioned(self):
        """Prompt should tell the LLM that runtime enforcement exists."""
        assert "runtime enforces" in _SUB_AGENT_RULES
