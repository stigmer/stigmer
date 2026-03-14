"""Unit tests for tool wrappers (HITL Phase 3B Sub-Task 2).

Tests cover:
- Approval-aware tool wrapper creation
- interrupt() call when approval required
- Handling of approve/skip/reject decisions
- Backward compatibility with non-approval wrappers
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from graphton.core.tool_wrappers import (
    ApprovalRequirement,
    ToolExecutionRejectedError,
    _apply_line_range,
    _check_and_handle_approval,
    _create_edit_tool,
    _create_execute_tool,
    _create_glob_tool,
    _create_grep_tool,
    _create_ls_tool,
    _create_read_tool,
    _create_write_tool,
    _format_shell_failure,
    _format_shell_success,
    _stream_write_content,
    create_approval_aware_tool_wrapper,
    create_platform_tool_wrappers,
)

# =============================================================================
# TestApprovalRequirement - Tests for ApprovalRequirement dataclass
# =============================================================================


class TestApprovalRequirement:
    """Tests for ApprovalRequirement dataclass."""

    def test_default_values(self):
        """Test that default values are correct."""
        req = ApprovalRequirement()
        assert req.requires_approval is False
        assert req.message == ""
        assert req.mcp_server == ""
        assert req.source == "none"

    def test_custom_values(self):
        """Test that custom values are preserved."""
        req = ApprovalRequirement(
            requires_approval=True,
            message="This is dangerous",
            mcp_server="planton-cloud",
            source="mcp_default",
        )
        assert req.requires_approval is True
        assert req.message == "This is dangerous"
        assert req.mcp_server == "planton-cloud"
        assert req.source == "mcp_default"


# =============================================================================
# TestToolExecutionRejectedError - Tests for rejection exception
# =============================================================================


class TestToolExecutionRejectedError:
    """Tests for ToolExecutionRejectedError exception."""

    def test_basic_rejection(self):
        """Test basic rejection error."""
        error = ToolExecutionRejectedError("delete_resource")
        assert error.tool_name == "delete_resource"
        assert "delete_resource" in str(error)
        assert "rejected" in str(error).lower()

    def test_rejection_with_custom_message(self):
        """Test rejection with custom message."""
        error = ToolExecutionRejectedError(
            "delete_resource",
            message="User explicitly rejected this dangerous operation",
        )
        assert error.tool_name == "delete_resource"
        assert error.message == "User explicitly rejected this dangerous operation"
        assert str(error) == "User explicitly rejected this dangerous operation"

    def test_rejection_is_exception(self):
        """Test that rejection error can be raised and caught."""
        with pytest.raises(ToolExecutionRejectedError) as exc_info:
            raise ToolExecutionRejectedError("test_tool")
        assert exc_info.value.tool_name == "test_tool"


# =============================================================================
# TestApprovalAwareWrapperCreation - Tests for wrapper creation
# =============================================================================


class TestApprovalAwareWrapperCreation:
    """Tests for create_approval_aware_tool_wrapper function."""

    def test_creates_wrapper_without_approval_checker(self):
        """Test that wrapper is created without approval checker."""
        # Setup mock middleware
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test tool description"
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=None,
        )
        
        assert wrapper is not None
        assert wrapper.name == "test_tool"  # type: ignore[attr-defined]

    def test_creates_wrapper_with_approval_checker(self):
        """Test that wrapper is created with approval checker."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test tool description"
        mock_middleware.get_tool.return_value = mock_tool
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        assert wrapper is not None
        assert wrapper.name == "test_tool"  # type: ignore[attr-defined]

    def test_raises_error_for_unknown_tool(self):
        """Test that error is raised for unknown tool."""
        mock_middleware = MagicMock()
        mock_middleware.get_tool.side_effect = RuntimeError("Tool not found")
        
        with pytest.raises(RuntimeError) as exc_info:
            create_approval_aware_tool_wrapper(
                tool_name="unknown_tool",
                middleware_instance=mock_middleware,
            )
        
        assert "unknown_tool" in str(exc_info.value)


# =============================================================================
# TestApprovalAwareWrapperExecution - Tests for wrapper execution
# =============================================================================


class TestApprovalAwareWrapperExecution:
    """Tests for approval-aware wrapper execution."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Test tool"
        tool.ainvoke = AsyncMock(return_value="tool_result")
        # Set args_schema to None to avoid issubclass() issues with MagicMock
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_executes_without_approval_check(self, mock_middleware):
        """Test that tool executes when no approval checker provided."""
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=None,
        )
        
        # Use ainvoke for StructuredTool
        result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert result == "tool_result"
        mock_middleware.get_tool.return_value.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_executes_without_approval_required(self, mock_middleware):
        """Test that tool executes when approval not required."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert result == "tool_result"

    @pytest.mark.asyncio
    async def test_calls_interrupt_when_approval_required(self, mock_middleware):
        """Test that interrupt() is called when approval is required."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(
                requires_approval=True,
                message="Dangerous operation",
                mcp_server="test-server",
                source="mcp_default",
            )
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        # Mock interrupt at the langgraph.types module level
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve", "approved_by": "user@test.com"}
            
            result = await wrapper.ainvoke({"arg1": "value1"})
        
        # Verify interrupt was called with correct payload
        mock_interrupt.assert_called_once()
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["tool_name"] == "test_tool"
        assert call_args["message"] == "Dangerous operation"
        assert call_args["mcp_server"] == "test-server"
        assert result == "tool_result"

    @pytest.mark.asyncio
    async def test_returns_skip_message_on_skip_action(self, mock_middleware):
        """Test that skip message is returned when user skips."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "skip", "approved_by": "user@test.com"}
            
            result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert "skipped" in result.lower()
        assert "test_tool" in result

    @pytest.mark.asyncio
    async def test_returns_rejection_message_on_reject_action(self, mock_middleware):
        """Test that a corrective rejection message is returned when user rejects."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "reject", "approved_by": "user@test.com"}
            
            result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert "REJECTED" in result
        assert "test_tool" in result
        assert "Re-evaluate" in result

    @pytest.mark.asyncio
    async def test_returns_rejection_message_on_unknown_action(self, mock_middleware):
        """Test that unknown action returns a rejection message."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "unknown_action"}
            
            result = await wrapper.ainvoke({"arg1": "value1"})
        
        assert "unknown_action" in result
        assert "test_tool" in result
        assert "Re-evaluate" in result


# =============================================================================
# TestApprovalAwareWrapperArgHandling - Tests for argument handling
# =============================================================================


class TestApprovalAwareWrapperArgHandling:
    """Tests for argument handling in approval-aware wrapper."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Test tool"
        tool.ainvoke = AsyncMock(return_value="tool_result")
        # Set args_schema to None to avoid issubclass() issues with MagicMock
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_unwraps_input_nested_args(self, mock_middleware):
        """Test that input-nested args are unwrapped."""
        captured_args = {}
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            captured_args.update(args)
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        await wrapper.ainvoke({"input": {"real_arg": "value"}})
        
        # Args should be unwrapped
        assert "real_arg" in captured_args
        assert captured_args["real_arg"] == "value"

    @pytest.mark.asyncio
    async def test_unwraps_kwargs_nested_args(self, mock_middleware):
        """Test that kwargs-nested args are unwrapped."""
        captured_args = {}
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            captured_args.update(args)
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        await wrapper.ainvoke({"kwargs": {"real_arg": "value"}})
        
        # Args should be unwrapped
        assert "real_arg" in captured_args

    @pytest.mark.asyncio
    async def test_passes_args_to_approval_checker(self, mock_middleware):
        """Test that args are passed to approval checker."""
        captured_args = {}
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            captured_args["name"] = name
            captured_args["args"] = args
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        await wrapper.ainvoke({"arg1": "value1", "arg2": "value2"})
        
        assert captured_args["name"] == "test_tool"
        assert captured_args["args"]["arg1"] == "value1"
        assert captured_args["args"]["arg2"] == "value2"


# =============================================================================
# TestApprovalAwareWrapperMetadata - Tests for metadata copying
# =============================================================================


class TestApprovalAwareWrapperMetadata:
    """Tests for metadata preservation in approval-aware wrapper."""

    def test_copies_tool_name(self):
        """Test that tool name is copied to wrapper."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test description"
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="my_tool",
            middleware_instance=mock_middleware,
        )
        
        assert wrapper.name == "my_tool"  # type: ignore[attr-defined]

    def test_copies_tool_description(self):
        """Test that tool description is copied to wrapper."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "This is a test tool for doing things"
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
        )
        
        assert wrapper.description == "This is a test tool for doing things"  # type: ignore[attr-defined]

    def test_copies_args_schema(self):
        """Test that args_schema is copied to wrapper."""
        mock_middleware = MagicMock()
        mock_tool = MagicMock()
        mock_tool.description = "Test"
        mock_tool.args_schema = {"type": "object", "properties": {"arg1": {"type": "string"}}}
        mock_middleware.get_tool.return_value = mock_tool
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
        )
        
        assert wrapper.args_schema == mock_tool.args_schema  # type: ignore[attr-defined]


# =============================================================================
# TestApprovalAwareWrapperIntegration - Integration tests
# =============================================================================


class TestApprovalAwareWrapperSubAgent:
    """Tests for sub-agent context in approval-aware wrapper."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Test tool"
        tool.ainvoke = AsyncMock(return_value="tool_result")
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_main_agent_interrupt_has_from_sub_agent_false(self, mock_middleware):
        """Test that main agent interrupt has from_sub_agent=False."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            sub_agent_name="",  # Empty = main agent
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await wrapper.ainvoke({})
        
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is False
        assert call_args["sub_agent_name"] == ""

    @pytest.mark.asyncio
    async def test_sub_agent_interrupt_has_from_sub_agent_true(self, mock_middleware):
        """Test that sub-agent interrupt has from_sub_agent=True."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            sub_agent_name="code-reviewer",  # Sub-agent name
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await wrapper.ainvoke({})
        
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is True
        assert call_args["sub_agent_name"] == "code-reviewer"

    @pytest.mark.asyncio
    async def test_sub_agent_context_preserved_in_skip_flow(self, mock_middleware):
        """Test that sub-agent context is preserved even when skipping."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            sub_agent_name="researcher",
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "skip"}
            result = await wrapper.ainvoke({})
        
        # Verify interrupt was called with sub-agent context
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is True
        assert call_args["sub_agent_name"] == "researcher"
        # Skip message returned
        assert "skipped" in result.lower()


class TestApprovalAwareWrapperIntegration:
    """Integration tests for approval-aware wrapper."""

    @pytest.fixture
    def mock_middleware(self):
        """Create mock middleware with async tool."""
        middleware = MagicMock()
        tool = MagicMock()
        tool.description = "Delete a cloud resource"
        tool.ainvoke = AsyncMock(return_value={"status": "deleted", "id": "res-123"})
        # Set args_schema to None to avoid issubclass() issues with MagicMock
        tool.args_schema = None
        middleware.get_tool.return_value = tool
        return middleware

    @pytest.mark.asyncio
    async def test_full_approval_flow(self, mock_middleware):
        """Test complete approval flow from check to execution."""
        approval_log = []
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            approval_log.append(f"Checking {name} with {args}")
            if name == "delete_resource":
                return ApprovalRequirement(
                    requires_approval=True,
                    message=f"Are you sure you want to delete {args.get('resource_id')}?",
                    mcp_server="cloud-api",
                    source="mcp_default",
                )
            return ApprovalRequirement(requires_approval=False)
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="delete_resource",
            middleware_instance=mock_middleware,
            approval_checker=checker,
            mcp_server_name="cloud-api",
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve", "approved_by": "admin@test.com"}
            
            result = await wrapper.ainvoke({"resource_id": "res-123"})
        
        # Verify the full flow
        assert len(approval_log) == 1
        assert "delete_resource" in approval_log[0]
        mock_interrupt.assert_called_once()
        interrupt_payload = mock_interrupt.call_args[0][0]
        assert "res-123" in interrupt_payload["message"]
        assert "deleted" in result
        assert "res-123" in result

    @pytest.mark.asyncio
    async def test_multiple_tools_different_policies(self, mock_middleware):
        """Test that different tools can have different approval policies."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            if name == "delete_resource":
                return ApprovalRequirement(requires_approval=True, message="Confirm delete?")
            elif name == "list_resources":
                return ApprovalRequirement(requires_approval=False)
            return ApprovalRequirement(requires_approval=False)
        
        delete_wrapper = create_approval_aware_tool_wrapper(
            tool_name="delete_resource",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        list_wrapper = create_approval_aware_tool_wrapper(
            tool_name="list_resources",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        # list_resources should execute without interrupt
        result = await list_wrapper.ainvoke({})
        assert "deleted" in result
        assert "res-123" in result
        
        # delete_resource should require interrupt
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await delete_wrapper.ainvoke({})
        
        mock_interrupt.assert_called_once()


# =============================================================================
# Platform Tool Wrapper Tests (Phase 5.6 Fixes)
# =============================================================================


class TestCheckAndHandleApproval:
    """Tests for the shared _check_and_handle_approval function."""

    def test_returns_none_when_no_checker(self):
        """Test that None is returned when no approval checker provided."""
        result = _check_and_handle_approval(
            tool_name="test_tool",
            tool_args={"arg": "value"},
            approval_checker=None,
        )
        assert result is None

    def test_returns_none_when_approval_not_required(self):
        """Test that None is returned when approval not required."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=False)
        
        result = _check_and_handle_approval(
            tool_name="test_tool",
            tool_args={"arg": "value"},
            approval_checker=checker,
        )
        assert result is None

    def test_returns_none_on_approve(self):
        """Test that None is returned when user approves."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve", "approved_by": "user"}
            
            result = _check_and_handle_approval(
                tool_name="test_tool",
                tool_args={"arg": "value"},
                approval_checker=checker,
            )
        
        assert result is None

    def test_returns_skip_message_on_skip(self):
        """Test that skip message is returned when user skips."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "skip", "approved_by": "user"}
            
            result = _check_and_handle_approval(
                tool_name="test_tool",
                tool_args={"arg": "value"},
                approval_checker=checker,
            )
        
        assert result is not None
        assert "skipped" in result.lower()
        assert "test_tool" in result

    def test_returns_reject_message_on_reject(self):
        """Test that reject returns an error message string."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "reject", "approved_by": "user"}
            
            result = _check_and_handle_approval(
                tool_name="test_tool",
                tool_args={"arg": "value"},
                approval_checker=checker,
            )
        
        assert result is not None
        assert "test_tool" in result
        assert "REJECTED" in result

    def test_returns_reject_message_on_unknown_action(self):
        """Test that unknown action returns a rejection message."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "something_weird"}
            
            result = _check_and_handle_approval(
                tool_name="test_tool",
                tool_args={"arg": "value"},
                approval_checker=checker,
            )
        
        assert result is not None
        assert "test_tool" in result
        assert "something_weird" in result

    def test_includes_sub_agent_context_in_payload(self):
        """Test that sub-agent context is included in interrupt payload."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            
            _check_and_handle_approval(
                tool_name="test_tool",
                tool_args={"arg": "value"},
                approval_checker=checker,
                mcp_server="test-server",
                from_sub_agent=True,
                sub_agent_name="code_reviewer",
            )
        
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is True
        assert call_args["sub_agent_name"] == "code_reviewer"
        assert call_args["mcp_server"] == "test-server"

    def test_uses_platform_server_by_default(self):
        """Test that __platform__ is used as default server."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            
            _check_and_handle_approval(
                tool_name="write",
                tool_args={"path": "test.txt"},
                approval_checker=checker,
            )
        
        call_args = mock_interrupt.call_args[0][0]
        assert call_args["mcp_server"] == "__platform__"


class TestCreatePlatformToolWrappers:
    """Tests for create_platform_tool_wrappers function."""

    @pytest.fixture
    def mock_backend(self):
        """Create a mock backend with all required methods."""
        backend = MagicMock()
        backend.read.return_value = "file content"
        backend.write.return_value = None
        backend.execute.return_value = MagicMock(stdout="output", stderr="", exit_code=0)
        backend.list_files.return_value = ["file1.txt", "file2.py"]
        return backend

    def test_creates_platform_tools(self, mock_backend):
        """Test that 11 tools are created (8 primary + 3 aliases)."""
        tools = create_platform_tool_wrappers(mock_backend)
        assert len(tools) == 11

    def test_creates_tools_with_correct_names(self, mock_backend):
        """Test that tools have correct names."""
        tools = create_platform_tool_wrappers(mock_backend)
        tool_names = [getattr(t, 'name', None) for t in tools]
        
        expected_names = [
            "read", "ls", "glob", "grep", "search",
            "write", "edit", "execute",
            "read_file", "write_file", "edit_file",
        ]
        for name in expected_names:
            assert name in tool_names, f"Tool '{name}' not found in {tool_names}"

    def test_tools_are_invokable(self, mock_backend):
        """Test that all tools have ainvoke method (are LangChain tools)."""
        tools = create_platform_tool_wrappers(mock_backend)
        for tool in tools:
            # LangChain tools have ainvoke method
            assert hasattr(tool, 'ainvoke'), f"Tool {tool} missing ainvoke method"

    def test_creates_tools_with_approval_checker(self, mock_backend):
        """Test that tools are created with approval checker."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=False)
        
        tools = create_platform_tool_wrappers(mock_backend, approval_checker=checker)
        assert len(tools) == 11

    def test_alias_tools_have_redirect_descriptions(self, mock_backend):
        """Alias tools should steer the LLM toward canonical names."""
        tools = create_platform_tool_wrappers(mock_backend)
        tools_by_name = {getattr(t, "name", None): t for t in tools}

        aliases_to_canonical = {
            "read_file": "read",
            "write_file": "write",
            "edit_file": "edit",
        }

        for alias_name, canonical_name in aliases_to_canonical.items():
            alias = tools_by_name[alias_name]
            canonical = tools_by_name[canonical_name]
            desc = alias.description

            assert "do not call directly" in desc.lower(), (
                f"{alias_name} description must discourage direct use"
            )
            assert canonical_name in desc, (
                f"{alias_name} description must reference canonical tool '{canonical_name}'"
            )
            assert desc != canonical.description, (
                f"{alias_name} must not share the same description as '{canonical_name}'"
            )


class TestApplyLineRange:
    """Tests for the _apply_line_range helper."""

    SAMPLE = "line1\nline2\nline3\nline4\nline5\n"

    def test_no_slicing_when_defaults(self):
        assert _apply_line_range(self.SAMPLE, offset=0, limit=0) == self.SAMPLE

    def test_negative_values_treated_as_defaults(self):
        assert _apply_line_range(self.SAMPLE, offset=-3, limit=-1) == self.SAMPLE

    def test_offset_only(self):
        result = _apply_line_range(self.SAMPLE, offset=3, limit=0)
        assert result.startswith("[Lines 3-5 of 5 total]")
        assert "line3\n" in result
        assert "line1" not in result

    def test_limit_only(self):
        result = _apply_line_range(self.SAMPLE, offset=0, limit=2)
        assert result.startswith("[Lines 1-2 of 5 total]")
        assert "line1\n" in result
        assert "line2\n" in result
        assert "line3" not in result

    def test_offset_and_limit(self):
        result = _apply_line_range(self.SAMPLE, offset=2, limit=2)
        assert result.startswith("[Lines 2-3 of 5 total]")
        assert "line2\n" in result
        assert "line3\n" in result
        assert "line1" not in result
        assert "line4" not in result

    def test_offset_beyond_file(self):
        result = _apply_line_range(self.SAMPLE, offset=100, limit=0)
        assert "5 lines" in result
        assert "offset 100" in result
        assert "beyond end of file" in result

    def test_limit_exceeds_remaining(self):
        result = _apply_line_range(self.SAMPLE, offset=4, limit=50)
        assert "[Lines 4-5 of 5 total]" in result
        assert "line4\n" in result
        assert "line5\n" in result

    def test_single_line_file(self):
        result = _apply_line_range("only line", offset=1, limit=1)
        assert "[Lines 1-1 of 1 total]" in result
        assert "only line" in result

    def test_empty_content(self):
        result = _apply_line_range("", offset=1, limit=5)
        assert "0 lines" in result
        assert "beyond end of file" in result


class TestReadToolWrapper:
    """Tests for _create_read_tool wrapper."""

    @pytest.fixture
    def mock_backend(self):
        backend = MagicMock()
        backend.read.return_value = "Hello, world!"
        return backend

    @pytest.mark.asyncio
    async def test_reads_file(self, mock_backend):
        """Test that read tool reads file correctly."""
        tool = _create_read_tool(mock_backend)
        result = await tool.ainvoke({"path": "test.txt"})

        assert result == "Hello, world!"
        mock_backend.read.assert_called_once_with("test.txt")

    @pytest.mark.asyncio
    async def test_read_with_approval_check(self, mock_backend):
        """Test that read tool checks approval."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=False)

        tool = _create_read_tool(mock_backend, approval_checker=checker)
        result = await tool.ainvoke({"path": "test.txt"})

        assert result == "Hello, world!"

    @pytest.mark.asyncio
    async def test_read_returns_skip_message(self, mock_backend):
        """Test that read returns skip message when skipped."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm read?")

        tool = _create_read_tool(mock_backend, approval_checker=checker)

        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "skip"}
            result = await tool.ainvoke({"path": "test.txt"})

        assert "skipped" in result.lower()
        mock_backend.read.assert_not_called()

    @pytest.mark.asyncio
    async def test_read_with_offset_and_limit(self):
        """Test that read tool applies offset/limit to file content."""
        backend = MagicMock()
        backend.read.return_value = "a\nb\nc\nd\ne\n"

        tool = _create_read_tool(backend)
        result = await tool.ainvoke({"path": "f.txt", "offset": 2, "limit": 2})

        assert "[Lines 2-3 of 5 total]" in result
        assert "b\n" in result
        assert "c\n" in result
        assert "a\n" not in result

    @pytest.mark.asyncio
    async def test_read_defaults_return_full_content(self):
        """Test that default offset=0, limit=0 returns unmodified content."""
        backend = MagicMock()
        backend.read.return_value = "full content"

        tool = _create_read_tool(backend)
        result = await tool.ainvoke({"path": "f.txt"})

        assert result == "full content"


class TestWriteToolWrapper:
    """Tests for _create_write_tool wrapper."""

    @pytest.fixture
    def mock_backend(self):
        backend = MagicMock()
        backend.write.return_value = None
        return backend

    @pytest.mark.asyncio
    async def test_writes_file(self, mock_backend):
        """Test that write tool writes file correctly."""
        tool = _create_write_tool(mock_backend)
        result = await tool.ainvoke({"path": "test.txt", "content": "Hello!"})
        
        assert "Successfully wrote" in result
        mock_backend.write.assert_called_once_with("test.txt", "Hello!")

    @pytest.mark.asyncio
    async def test_write_requires_approval_by_default(self, mock_backend):
        """Test that write tool checks approval."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            if name == "write":
                return ApprovalRequirement(requires_approval=True, message="Write file?")
            return ApprovalRequirement(requires_approval=False)
        
        tool = _create_write_tool(mock_backend, approval_checker=checker)
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            result = await tool.ainvoke({"path": "test.txt", "content": "Hello!"})
        
        mock_interrupt.assert_called_once()
        assert "Successfully wrote" in result


class TestStreamWriteContent:
    """Tests for _stream_write_content progressive streaming helper."""

    @pytest.mark.asyncio
    async def test_small_file_emits_single_chunk(self):
        """Files below the streaming threshold are sent as one chunk."""
        content = "line1\nline2\nline3"
        chunks = []

        with patch("graphton.core.tool_wrappers.dispatch_custom_event") as mock_dispatch:
            mock_dispatch.side_effect = lambda name, data: chunks.append(data["chunk"])
            await _stream_write_content(content)

        assert len(chunks) == 1
        assert chunks[0] == content

    @pytest.mark.asyncio
    async def test_large_file_emits_multiple_chunks(self):
        """Files above the threshold are split into multiple chunks."""
        lines = [f"line {i}" for i in range(50)]
        content = "\n".join(lines)
        chunks = []

        with patch("graphton.core.tool_wrappers.dispatch_custom_event") as mock_dispatch:
            mock_dispatch.side_effect = lambda name, data: chunks.append(data["chunk"])
            with patch("asyncio.sleep", new_callable=AsyncMock):
                await _stream_write_content(content)

        assert len(chunks) > 1
        # Reconstruct: all chunks concatenated must equal the original.
        assert "".join(chunks) == content

    @pytest.mark.asyncio
    async def test_chunks_concatenate_to_original_content(self):
        """Accumulated chunks must exactly reproduce the original content."""
        lines = [f"def func_{i}(): pass" for i in range(100)]
        content = "\n".join(lines)
        chunks = []

        with patch("graphton.core.tool_wrappers.dispatch_custom_event") as mock_dispatch:
            mock_dispatch.side_effect = lambda name, data: chunks.append(data["chunk"])
            with patch("asyncio.sleep", new_callable=AsyncMock):
                await _stream_write_content(content)

        reconstructed = "".join(chunks)
        assert reconstructed == content

    @pytest.mark.asyncio
    async def test_trailing_newline_preserved(self):
        """Content that ends with a newline must be faithfully reproduced."""
        lines = [f"line {i}" for i in range(30)]
        content = "\n".join(lines) + "\n"
        chunks = []

        with patch("graphton.core.tool_wrappers.dispatch_custom_event") as mock_dispatch:
            mock_dispatch.side_effect = lambda name, data: chunks.append(data["chunk"])
            with patch("asyncio.sleep", new_callable=AsyncMock):
                await _stream_write_content(content)

        reconstructed = "".join(chunks)
        assert reconstructed == content
        assert reconstructed.endswith("\n")

    @pytest.mark.asyncio
    async def test_empty_content_emits_single_chunk(self):
        """Empty content is emitted as a single (empty) chunk."""
        chunks = []

        with patch("graphton.core.tool_wrappers.dispatch_custom_event") as mock_dispatch:
            mock_dispatch.side_effect = lambda name, data: chunks.append(data["chunk"])
            await _stream_write_content("")

        # Empty string has 1 "line" (the empty string itself), which is
        # below the threshold, so single-chunk path fires.
        assert len(chunks) == 1

    @pytest.mark.asyncio
    async def test_async_sleep_called_between_chunks(self):
        """asyncio.sleep is called between chunk emissions to yield control."""
        lines = [f"line {i}" for i in range(50)]
        content = "\n".join(lines)

        with patch("graphton.core.tool_wrappers.dispatch_custom_event"):
            with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
                await _stream_write_content(content)

        # Sleep should be called at least once (between first and second chunks),
        # but NOT after the final chunk.
        assert mock_sleep.call_count >= 1

    @pytest.mark.asyncio
    async def test_no_sleep_for_small_files(self):
        """Files below the threshold should not introduce any async delays."""
        content = "short\ncontent"

        with patch("graphton.core.tool_wrappers.dispatch_custom_event"):
            with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
                await _stream_write_content(content)

        mock_sleep.assert_not_called()

    @pytest.mark.asyncio
    async def test_all_events_use_tool_progress_name(self):
        """Every dispatch_custom_event call uses 'tool_progress' as the event name."""
        lines = [f"line {i}" for i in range(30)]
        content = "\n".join(lines)
        event_names = []

        with patch("graphton.core.tool_wrappers.dispatch_custom_event") as mock_dispatch:
            mock_dispatch.side_effect = lambda name, data: event_names.append(name)
            with patch("asyncio.sleep", new_callable=AsyncMock):
                await _stream_write_content(content)

        assert all(name == "tool_progress" for name in event_names)

    @pytest.mark.asyncio
    async def test_chunk_count_scales_with_target(self):
        """For very large files the chunk count stays bounded near the target."""
        lines = [f"line {i}" for i in range(500)]
        content = "\n".join(lines)
        chunks = []

        with patch("graphton.core.tool_wrappers.dispatch_custom_event") as mock_dispatch:
            mock_dispatch.side_effect = lambda name, data: chunks.append(data["chunk"])
            with patch("asyncio.sleep", new_callable=AsyncMock):
                await _stream_write_content(content)

        # chunk_size = max(3, 501 // 20) = 25, giving ~20 chunks.
        # Allow a generous margin for rounding.
        assert 15 <= len(chunks) <= 30


class TestEditToolWrapper:
    """Tests for _create_edit_tool wrapper."""

    @pytest.fixture
    def mock_backend(self):
        backend = MagicMock()
        backend.read.return_value = "old text here"
        backend.write.return_value = None
        return backend

    @pytest.mark.asyncio
    async def test_edits_file(self, mock_backend):
        """Test that edit tool replaces text correctly."""
        tool = _create_edit_tool(mock_backend)
        result = await tool.ainvoke({
            "path": "test.txt",
            "old_text": "old",
            "new_text": "new"
        })
        
        assert "Successfully edited" in result
        mock_backend.read.assert_called_once_with("test.txt")
        mock_backend.write.assert_called_once_with("test.txt", "new text here")

    @pytest.mark.asyncio
    async def test_edit_returns_error_when_text_not_found(self, mock_backend):
        """Test that edit returns error message when old_text not found."""
        tool = _create_edit_tool(mock_backend)
        
        result = await tool.ainvoke({
            "path": "test.txt",
            "old_text": "nonexistent",
            "new_text": "new"
        })
        
        assert "not found" in result.lower()

    @pytest.mark.asyncio
    async def test_edit_requires_approval(self, mock_backend):
        """Test that edit tool checks approval."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            if name == "edit":
                return ApprovalRequirement(requires_approval=True, message="Edit file?")
            return ApprovalRequirement(requires_approval=False)
        
        tool = _create_edit_tool(mock_backend, approval_checker=checker)
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            result = await tool.ainvoke({
                "path": "test.txt",
                "old_text": "old",
                "new_text": "new"
            })
        
        mock_interrupt.assert_called_once()
        assert "Successfully edited" in result


class TestExecuteToolWrapper:
    """Tests for _create_execute_tool wrapper."""

    @pytest.fixture
    def mock_backend(self):
        backend = MagicMock(spec=["execute"])
        result = MagicMock()
        result.stdout = "command output"
        result.stderr = ""
        result.exit_code = 0
        backend.execute.return_value = result
        return backend

    @pytest.mark.asyncio
    async def test_executes_command(self, mock_backend):
        """Test that execute tool runs command correctly."""
        tool = _create_execute_tool(mock_backend)
        result = await tool.ainvoke({"command": "ls -la"})
        
        assert result == "command output"
        mock_backend.execute.assert_called_once_with("ls -la", timeout=120)

    @pytest.mark.asyncio
    async def test_execute_with_custom_timeout(self, mock_backend):
        """Test that execute uses custom timeout."""
        tool = _create_execute_tool(mock_backend)
        await tool.ainvoke({"command": "sleep 10", "timeout": 30})
        
        mock_backend.execute.assert_called_once_with("sleep 10", timeout=30)

    @pytest.mark.asyncio
    async def test_execute_requires_approval(self, mock_backend):
        """Test that execute tool checks approval."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            if name == "execute":
                return ApprovalRequirement(requires_approval=True, message="Execute command?")
            return ApprovalRequirement(requires_approval=False)
        
        tool = _create_execute_tool(mock_backend, approval_checker=checker)
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            result = await tool.ainvoke({"command": "ls"})
        
        mock_interrupt.assert_called_once()
        assert result == "command output"

    @pytest.mark.asyncio
    async def test_uses_streaming_when_available(self):
        """Test that execute uses streaming when backend supports it."""
        backend = MagicMock()
        result = MagicMock()
        result.stdout = "streamed output"
        result.stderr = ""
        result.exit_code = 0
        backend.execute_streaming = AsyncMock(return_value=result)
        backend.execute = MagicMock()

        tool = _create_execute_tool(backend)
        await tool.ainvoke({"command": "ls"})

        backend.execute_streaming.assert_called_once()
        backend.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_falls_back_to_sync_when_no_streaming(self):
        """Test that execute falls back to sync when no execute_streaming."""
        backend = MagicMock(spec=["execute"])
        result = MagicMock()
        result.stdout = "command output"
        result.stderr = ""
        result.exit_code = 0
        backend.execute.return_value = result

        tool = _create_execute_tool(backend)
        await tool.ainvoke({"command": "ls"})

        backend.execute.assert_called_once_with("ls", timeout=120)

    @pytest.mark.asyncio
    async def test_streaming_emits_tool_progress_for_each_chunk(self):
        """Test that streaming path emits tool_progress for command prompt and each chunk."""

        async def streaming_side_effect(command, timeout=120, on_chunk=None):
            if on_chunk:
                on_chunk("output line 1\n")
                on_chunk("output line 2\n")
            result = MagicMock()
            result.exit_code = 0
            result.stdout = "output line 1\noutput line 2\n"
            result.stderr = ""
            return result

        backend = MagicMock()
        backend.execute_streaming = AsyncMock(side_effect=streaming_side_effect)

        with patch(
            "graphton.core.tool_wrappers.dispatch_custom_event"
        ) as mock_dispatch:
            tool = _create_execute_tool(backend)
            await tool.ainvoke({"command": "echo hello"})

        mock_dispatch.assert_any_call("tool_progress", {"chunk": "$ echo hello\n"})
        mock_dispatch.assert_any_call(
            "tool_progress", {"chunk": "output line 1\n"}
        )
        mock_dispatch.assert_any_call(
            "tool_progress", {"chunk": "output line 2\n"}
        )
        assert mock_dispatch.call_count >= 3

    @pytest.mark.asyncio
    async def test_streaming_failure_exit_code(self):
        """Test that streaming path returns failure message on non-zero exit code."""
        backend = MagicMock()
        result = MagicMock()
        result.stdout = ""
        result.stderr = "error"
        result.exit_code = 1
        backend.execute_streaming = AsyncMock(return_value=result)

        tool = _create_execute_tool(backend)
        result_str = await tool.ainvoke({"command": "false"})

        assert "Command failed" in result_str


# =============================================================================
# Shell output formatting helpers
# =============================================================================


class TestFormatShellSuccess:
    """Tests for _format_shell_success output formatting."""

    def test_stdout_only(self):
        assert _format_shell_success("file1\nfile2", "") == "file1\nfile2"

    def test_stderr_only(self):
        assert _format_shell_success("", "warning: something") == "warning: something"

    def test_stdout_and_stderr(self):
        result = _format_shell_success("output", "warning")
        assert result == "output\nwarning"

    def test_no_output(self):
        assert _format_shell_success("", "") == "(no output)"

    def test_no_labels_in_output(self):
        result = _format_shell_success("hello world", "")
        assert "STDOUT" not in result
        assert "STDERR" not in result
        assert "Exit code" not in result

    def test_no_exit_code_in_output(self):
        result = _format_shell_success("ok", "warn")
        assert "Exit code" not in result
        assert "exit code" not in result


class TestFormatShellFailure:
    """Tests for _format_shell_failure output formatting."""

    def test_stderr_only(self):
        result = _format_shell_failure(1, "", "Permission denied")
        assert result == "Command failed (exit code 1)\nPermission denied"

    def test_stdout_only(self):
        result = _format_shell_failure(2, "partial output", "")
        assert result == "Command failed (exit code 2)\npartial output"

    def test_both_streams(self):
        result = _format_shell_failure(1, "out", "err")
        lines = result.split("\n")
        assert lines[0] == "Command failed (exit code 1)"
        assert "err" in result
        assert "out" in result

    def test_no_output_shows_header_only(self):
        result = _format_shell_failure(127, "", "")
        assert result == "Command failed (exit code 127)"

    def test_exit_code_preserved_for_llm(self):
        result = _format_shell_failure(42, "", "bad thing")
        assert "exit code 42" in result

    def test_no_labels_in_output(self):
        result = _format_shell_failure(1, "out", "err")
        assert "STDOUT" not in result
        assert "STDERR" not in result


class TestExecuteToolOutputFormat:
    """Integration tests verifying the execute tool produces clean output."""

    @staticmethod
    def _make_backend(stdout="", stderr="", exit_code=0):
        backend = MagicMock(spec=["execute"])
        result = MagicMock()
        result.stdout = stdout
        result.stderr = stderr
        result.exit_code = exit_code
        backend.execute.return_value = result
        return backend

    @pytest.mark.asyncio
    async def test_success_returns_raw_stdout(self):
        backend = self._make_backend(stdout="file1\nfile2\n")
        tool = _create_execute_tool(backend)
        result = await tool.ainvoke({"command": "ls"})
        assert result == "file1\nfile2\n"

    @pytest.mark.asyncio
    async def test_success_no_exit_code(self):
        backend = self._make_backend(stdout="ok")
        tool = _create_execute_tool(backend)
        result = await tool.ainvoke({"command": "echo ok"})
        assert "Exit code" not in result
        assert "exit code" not in result

    @pytest.mark.asyncio
    async def test_success_no_labels(self):
        backend = self._make_backend(stdout="data", stderr="warn")
        tool = _create_execute_tool(backend)
        result = await tool.ainvoke({"command": "cmd"})
        assert "STDOUT" not in result
        assert "STDERR" not in result

    @pytest.mark.asyncio
    async def test_success_empty_output(self):
        backend = self._make_backend()
        tool = _create_execute_tool(backend)
        result = await tool.ainvoke({"command": "true"})
        assert result == "(no output)"

    @pytest.mark.asyncio
    async def test_failure_shows_exit_code(self):
        backend = self._make_backend(stderr="not found", exit_code=1)
        tool = _create_execute_tool(backend)
        result = await tool.ainvoke({"command": "bad"})
        assert "Command failed (exit code 1)" in result
        assert "not found" in result

    @pytest.mark.asyncio
    async def test_failure_no_labels(self):
        backend = self._make_backend(stdout="x", stderr="y", exit_code=2)
        tool = _create_execute_tool(backend)
        result = await tool.ainvoke({"command": "fail"})
        assert "STDOUT" not in result
        assert "STDERR" not in result


class TestLsToolWrapper:
    """Tests for _create_ls_tool wrapper."""

    @pytest.fixture
    def mock_backend(self):
        backend = MagicMock()
        backend.list_files.return_value = ["file1.txt", "file2.py", "subdir"]
        return backend

    @pytest.mark.asyncio
    async def test_lists_directory(self, mock_backend):
        """Test that ls tool lists directory correctly."""
        tool = _create_ls_tool(mock_backend)
        result = await tool.ainvoke({"path": "."})
        
        assert "file1.txt" in result
        assert "file2.py" in result
        mock_backend.list_files.assert_called_once_with(".")

    @pytest.mark.asyncio
    async def test_lists_empty_directory(self, mock_backend):
        """Test that ls handles empty directory."""
        mock_backend.list_files.return_value = []
        
        tool = _create_ls_tool(mock_backend)
        result = await tool.ainvoke({"path": "empty_dir"})
        
        assert "empty" in result.lower()


class TestGlobToolWrapper:
    """Tests for _create_glob_tool wrapper."""

    @pytest.fixture
    def mock_backend(self):
        backend = MagicMock()
        _dirs = {".", "subdir"}
        def list_files_side_effect(path):
            if path == ".":
                return ["file1.py", "file2.txt", "subdir"]
            elif path == "subdir":
                return ["nested.py"]
            return []
        backend.list_files.side_effect = list_files_side_effect
        backend.is_directory.side_effect = lambda p: p in _dirs
        return backend

    @pytest.mark.asyncio
    async def test_finds_matching_files(self, mock_backend):
        """Test that glob finds files matching pattern."""
        tool = _create_glob_tool(mock_backend)
        result = await tool.ainvoke({"pattern": "*.py"})
        
        assert "file1.py" in result

    @pytest.mark.asyncio
    async def test_glob_no_matches(self, mock_backend):
        """Test that glob handles no matches."""
        tool = _create_glob_tool(mock_backend)
        result = await tool.ainvoke({"pattern": "*.xyz"})
        
        assert "No files matching" in result


class TestGlobToolPathPatterns:
    """Tests for glob pattern matching with path-containing patterns.

    Validates that patterns with '/' match against full paths while
    patterns without '/' match against basenames only.
    """

    @pytest.fixture
    def deep_backend(self):
        """Backend with a realistic nested directory tree."""
        backend = MagicMock()
        _dirs = {
            ".", "docs", "docs/product", "src", "src/utils",
            ".stigmer", ".stigmer/skills", ".stigmer/skills/my-skill",
            ".stigmer/skills/my-skill/scripts",
            ".stigmer/skills/my-skill/references",
        }

        _tree = {
            ".": ["docs", "src", ".stigmer", "README.md"],
            "docs": ["product"],
            "docs/product": [
                "what-is-agent.md",
                "what-is-skill.md",
                "what-is-session.md",
            ],
            "src": ["utils", "main.py"],
            "src/utils": ["helpers.py", "config.py"],
            ".stigmer": ["skills"],
            ".stigmer/skills": ["my-skill"],
            ".stigmer/skills/my-skill": ["SKILL.md", "scripts", "references"],
            ".stigmer/skills/my-skill/scripts": ["init_skill.py", "validate.sh"],
            ".stigmer/skills/my-skill/references": ["schema.md", "examples.md"],
        }

        backend.list_files.side_effect = lambda p: _tree.get(p, [])
        backend.is_directory.side_effect = lambda p: p in _dirs
        return backend

    # -- Pattern with path components (contains '/') -----------------------

    @pytest.mark.asyncio
    async def test_path_pattern_matches_full_path(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "docs/product/what-is-*.md"})

        assert "docs/product/what-is-agent.md" in result
        assert "docs/product/what-is-skill.md" in result
        assert "docs/product/what-is-session.md" in result

    @pytest.mark.asyncio
    async def test_path_pattern_no_false_positives(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "docs/product/what-is-*.md"})

        assert "README.md" not in result
        assert "schema.md" not in result

    @pytest.mark.asyncio
    async def test_path_pattern_subdir_wildcard(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "src/utils/*.py"})

        assert "src/utils/helpers.py" in result
        assert "src/utils/config.py" in result
        assert "main.py" not in result

    @pytest.mark.asyncio
    async def test_path_pattern_exact_file(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "src/main.py"})

        assert "src/main.py" in result

    @pytest.mark.asyncio
    async def test_path_pattern_no_match_wrong_prefix(self, deep_backend):
        """scripts/init_skill.py should NOT match .stigmer/.../scripts/init_skill.py
        because fnmatch requires the full path to match."""
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "scripts/init_skill.py"})

        assert "No files matching" in result

    # -- Recursive ** patterns ---------------------------------------------

    @pytest.mark.asyncio
    async def test_double_star_finds_all_py_files(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "**/*.py"})

        assert "src/main.py" in result
        assert "src/utils/helpers.py" in result
        assert "src/utils/config.py" in result
        assert ".stigmer/skills/my-skill/scripts/init_skill.py" in result

    @pytest.mark.asyncio
    async def test_double_star_finds_nested_exact(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "**/init_skill.py"})

        assert ".stigmer/skills/my-skill/scripts/init_skill.py" in result

    @pytest.mark.asyncio
    async def test_double_star_finds_nested_md(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "**/*.md"})

        # fnmatch requires a literal '/' in the path for **/*.md to match,
        # so root-level README.md is not matched (use "*.md" for those).
        assert "docs/product/what-is-agent.md" in result
        assert ".stigmer/skills/my-skill/SKILL.md" in result
        assert ".stigmer/skills/my-skill/references/schema.md" in result
        assert "README.md" not in result

    # -- Pure filename patterns (no '/') -----------------------------------

    @pytest.mark.asyncio
    async def test_basename_pattern_matches_across_dirs(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "*.py"})

        assert "src/main.py" in result
        assert "src/utils/helpers.py" in result
        assert ".stigmer/skills/my-skill/scripts/init_skill.py" in result

    @pytest.mark.asyncio
    async def test_basename_pattern_exact_filename(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({"pattern": "SKILL.md"})

        assert ".stigmer/skills/my-skill/SKILL.md" in result

    # -- Custom path argument ----------------------------------------------

    @pytest.mark.asyncio
    async def test_path_scoping_limits_search(self, deep_backend):
        tool = _create_glob_tool(deep_backend)
        result = await tool.ainvoke({
            "pattern": "*.py",
            "path": ".stigmer/skills/my-skill/scripts",
        })

        assert "init_skill.py" in result
        assert "helpers.py" not in result
        assert "main.py" not in result


class TestGrepToolWrapper:
    """Tests for _create_grep_tool wrapper."""

    @pytest.fixture
    def mock_backend(self):
        backend = MagicMock()
        _dirs = {"."}
        
        def list_files_side_effect(path):
            if path == ".":
                return ["test.py", "data.txt"]
            return []
        
        def read_side_effect(path):
            if path == "test.py":
                return "def hello():\n    print('Hello world')\n"
            elif path == "data.txt":
                return "some data\nmore data\n"
            raise FileNotFoundError(path)
        
        backend.list_files.side_effect = list_files_side_effect
        backend.read.side_effect = read_side_effect
        backend.is_directory.side_effect = lambda p: p in _dirs
        return backend

    @pytest.mark.asyncio
    async def test_finds_matching_lines(self, mock_backend):
        """Test that grep finds matching lines."""
        tool = _create_grep_tool(mock_backend)
        result = await tool.ainvoke({"pattern": "hello", "include": "*.py"})
        
        assert "test.py" in result.lower()

    @pytest.mark.asyncio
    async def test_grep_no_matches(self, mock_backend):
        """Test that grep handles no matches."""
        tool = _create_grep_tool(mock_backend)
        result = await tool.ainvoke({"pattern": "nonexistent_pattern"})
        
        assert "No matches" in result

    @pytest.mark.asyncio
    async def test_grep_invalid_regex(self, mock_backend):
        """Test that grep handles invalid regex."""
        tool = _create_grep_tool(mock_backend)
        result = await tool.ainvoke({"pattern": "[invalid"})
        
        assert "Invalid regex" in result


class TestPlatformToolApprovalIntegration:
    """Integration tests for platform tool approval flow."""

    @pytest.fixture
    def mock_backend(self):
        """Create a complete mock backend."""
        backend = MagicMock()
        backend.read.return_value = "old content"
        backend.write.return_value = None
        result = MagicMock(stdout="output", stderr="", exit_code=0)
        backend.execute.return_value = result
        backend.list_files.return_value = ["file.txt"]
        return backend

    @pytest.mark.asyncio
    async def test_dangerous_tools_check_approval(self, mock_backend):
        """Test that dangerous tools (write, edit, execute) check approval."""
        checked_tools = []
        
        def checker(name: str, args: dict) -> ApprovalRequirement:
            checked_tools.append(name)
            return ApprovalRequirement(requires_approval=False)
        
        tools = create_platform_tool_wrappers(mock_backend, approval_checker=checker)
        tool_dict = {getattr(t, 'name', ''): t for t in tools}
        
        # Execute each dangerous tool
        await tool_dict["write"].ainvoke({"path": "test.txt", "content": "hi"})
        await tool_dict["edit"].ainvoke({"path": "test.txt", "old_text": "old", "new_text": "new"})
        await tool_dict["execute"].ainvoke({"command": "ls"})
        
        # All dangerous tools should have checked approval
        assert "write" in checked_tools
        assert "edit" in checked_tools
        assert "execute" in checked_tools

    @pytest.mark.asyncio
    async def test_safe_tools_execute_without_interrupt(self, mock_backend):
        """Test that safe tools (ls, glob, grep) don't call interrupt."""
        tools = create_platform_tool_wrappers(mock_backend, approval_checker=None)
        tool_dict = {getattr(t, 'name', ''): t for t in tools}
        
        # Safe tools should work without interrupt
        with patch("langgraph.types.interrupt") as mock_interrupt:
            await tool_dict["ls"].ainvoke({"path": "."})
            await tool_dict["read"].ainvoke({"path": "test.txt"})
        
        # Interrupt should never be called for safe tools without approval_checker
        mock_interrupt.assert_not_called()


class TestPlatformToolSubAgentContext:
    """Tests for platform tools carrying sub-agent context in interrupt payloads.

    When platform tools (execute, write, edit, read) are created with
    sub_agent_name, their interrupt payloads must set from_sub_agent=True
    so Phase 2 interrupt matching succeeds for sub-agent tool calls.
    """

    @pytest.fixture
    def mock_backend(self):
        """Create a complete mock backend."""
        backend = MagicMock()
        backend.read.return_value = "file content"
        backend.write.return_value = None
        result = MagicMock(stdout="output", stderr="", exit_code=0)
        backend.execute.return_value = result
        return backend

    @pytest.mark.asyncio
    @pytest.mark.parametrize("tool_name", ["execute", "write", "edit", "read"])
    async def test_sub_agent_platform_tool_interrupt_has_from_sub_agent_true(
        self, mock_backend, tool_name,
    ):
        """Platform tools created with sub_agent_name set from_sub_agent=True."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")

        tools = create_platform_tool_wrappers(
            mock_backend,
            approval_checker=checker,
            sub_agent_name="code-reviewer",
        )
        tool_dict = {getattr(t, "name", ""): t for t in tools}

        invoke_args = {
            "execute": {"command": "ls"},
            "write": {"path": "f.txt", "content": "hi"},
            "edit": {"path": "f.txt", "old_text": "file content", "new_text": "new"},
            "read": {"path": "f.txt"},
        }

        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await tool_dict[tool_name].ainvoke(invoke_args[tool_name])

        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is True
        assert call_args["sub_agent_name"] == "code-reviewer"

    @pytest.mark.asyncio
    async def test_parent_agent_platform_tool_interrupt_has_from_sub_agent_false(
        self, mock_backend,
    ):
        """Platform tools without sub_agent_name keep from_sub_agent=False."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")

        tools = create_platform_tool_wrappers(
            mock_backend,
            approval_checker=checker,
        )
        tool_dict = {getattr(t, "name", ""): t for t in tools}

        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await tool_dict["execute"].ainvoke({"command": "ls"})

        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is False
        assert call_args["sub_agent_name"] == ""

    @pytest.mark.asyncio
    async def test_alias_tools_inherit_sub_agent_context(self, mock_backend):
        """Alias tools (read_file, write_file, edit_file) also carry sub-agent context."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")

        tools = create_platform_tool_wrappers(
            mock_backend,
            approval_checker=checker,
            sub_agent_name="shell-agent",
        )
        tool_dict = {getattr(t, "name", ""): t for t in tools}

        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "approve"}
            await tool_dict["write_file"].ainvoke({"path": "f.txt", "content": "hi"})

        call_args = mock_interrupt.call_args[0][0]
        assert call_args["from_sub_agent"] is True
        assert call_args["sub_agent_name"] == "shell-agent"
