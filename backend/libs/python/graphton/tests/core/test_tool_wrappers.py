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
    async def test_raises_error_on_reject_action(self, mock_middleware):
        """Test that rejection error is raised when user rejects."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "reject", "approved_by": "user@test.com"}
            
            with pytest.raises(ToolExecutionRejectedError) as exc_info:
                await wrapper.ainvoke({"arg1": "value1"})
        
        assert exc_info.value.tool_name == "test_tool"

    @pytest.mark.asyncio
    async def test_raises_error_on_unknown_action(self, mock_middleware):
        """Test that unknown action is treated as rejection."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        wrapper = create_approval_aware_tool_wrapper(
            tool_name="test_tool",
            middleware_instance=mock_middleware,
            approval_checker=checker,
        )
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "unknown_action"}
            
            with pytest.raises(ToolExecutionRejectedError) as exc_info:
                await wrapper.ainvoke({"arg1": "value1"})
        
        assert "unknown" in str(exc_info.value).lower() or "test_tool" in str(exc_info.value)


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
        assert result == {"status": "deleted", "id": "res-123"}

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
        assert result == {"status": "deleted", "id": "res-123"}  # Mock returns same for both
        
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

    def test_raises_error_on_reject(self):
        """Test that rejection error is raised when user rejects."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "reject", "approved_by": "user"}
            
            with pytest.raises(ToolExecutionRejectedError) as exc_info:
                _check_and_handle_approval(
                    tool_name="test_tool",
                    tool_args={"arg": "value"},
                    approval_checker=checker,
                )
        
        assert exc_info.value.tool_name == "test_tool"

    def test_raises_error_on_unknown_action(self):
        """Test that unknown action is treated as rejection."""
        def checker(name: str, args: dict) -> ApprovalRequirement:
            return ApprovalRequirement(requires_approval=True, message="Confirm?")
        
        with patch("langgraph.types.interrupt") as mock_interrupt:
            mock_interrupt.return_value = {"action": "something_weird"}
            
            with pytest.raises(ToolExecutionRejectedError):
                _check_and_handle_approval(
                    tool_name="test_tool",
                    tool_args={"arg": "value"},
                    approval_checker=checker,
                )

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

    def test_creates_seven_tools(self, mock_backend):
        """Test that exactly 7 tools are created."""
        tools = create_platform_tool_wrappers(mock_backend)
        assert len(tools) == 7

    def test_creates_tools_with_correct_names(self, mock_backend):
        """Test that tools have correct names."""
        tools = create_platform_tool_wrappers(mock_backend)
        tool_names = [getattr(t, 'name', None) for t in tools]
        
        expected_names = ["read", "ls", "glob", "grep", "write", "edit", "execute"]
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
        assert len(tools) == 7


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
    async def test_edit_raises_when_text_not_found(self, mock_backend):
        """Test that edit raises error when old_text not found."""
        tool = _create_edit_tool(mock_backend)
        
        with pytest.raises(ValueError) as exc_info:
            await tool.ainvoke({
                "path": "test.txt",
                "old_text": "nonexistent",
                "new_text": "new"
            })
        
        assert "not found" in str(exc_info.value).lower()

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
        backend = MagicMock()
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
        
        assert "Exit code: 0" in result
        assert "command output" in result
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
        assert "Exit code: 0" in result


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
