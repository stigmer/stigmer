package ai.stigmer.agentic.workflowexecution.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowExecutionQueryController handles read operations (Get, List, Subscribe) for WorkflowExecution resources.
 * This service follows the Command-Query Separation (CQS) pattern:
 * - CommandController: Write operations (create, update, delete)
 * - QueryController: Read operations (get, list, search, subscribe)
 * Authorization:
 * - get: Standard authorization - user must have "get" permission on the specific WorkflowExecution
 * - list: Custom authorization - filters results based on user's owner scope and permissions
 * - list_by_workflow: Custom authorization - verifies user has access to the Workflow/WorkflowInstance
 * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
 * Service Options:
 * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowExecutionQueryControllerGrpc {

  private WorkflowExecutionQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getGetMethod;
    if ((getGetMethod = WorkflowExecutionQueryControllerGrpc.getGetMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getGetMethod = WorkflowExecutionQueryControllerGrpc.getGetMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> getListMethod;
    if ((getListMethod = WorkflowExecutionQueryControllerGrpc.getListMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getListMethod = WorkflowExecutionQueryControllerGrpc.getListMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> getListByWorkflowMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByWorkflow",
      requestType = ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> getListByWorkflowMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> getListByWorkflowMethod;
    if ((getListByWorkflowMethod = WorkflowExecutionQueryControllerGrpc.getListByWorkflowMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getListByWorkflowMethod = WorkflowExecutionQueryControllerGrpc.getListByWorkflowMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getListByWorkflowMethod = getListByWorkflowMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByWorkflow"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("listByWorkflow"))
              .build();
        }
      }
    }
    return getListByWorkflowMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubscribeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "subscribe",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubscribeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubscribeMethod;
    if ((getSubscribeMethod = WorkflowExecutionQueryControllerGrpc.getSubscribeMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getSubscribeMethod = WorkflowExecutionQueryControllerGrpc.getSubscribeMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getSubscribeMethod = getSubscribeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "subscribe"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("subscribe"))
              .build();
        }
      }
    }
    return getSubscribeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest,
      ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse> getGetEventLogMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getEventLog",
      requestType = ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest,
      ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse> getGetEventLogMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest, ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse> getGetEventLogMethod;
    if ((getGetEventLogMethod = WorkflowExecutionQueryControllerGrpc.getGetEventLogMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getGetEventLogMethod = WorkflowExecutionQueryControllerGrpc.getGetEventLogMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getGetEventLogMethod = getGetEventLogMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest, ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getEventLog"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("getEventLog"))
              .build();
        }
      }
    }
    return getGetEventLogMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent> getSubscribeEventsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "subscribeEvents",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent> getSubscribeEventsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent> getSubscribeEventsMethod;
    if ((getSubscribeEventsMethod = WorkflowExecutionQueryControllerGrpc.getSubscribeEventsMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getSubscribeEventsMethod = WorkflowExecutionQueryControllerGrpc.getSubscribeEventsMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getSubscribeEventsMethod = getSubscribeEventsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "subscribeEvents"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("subscribeEvents"))
              .build();
        }
      }
    }
    return getSubscribeEventsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest,
      ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary> getGetExecutionSummaryMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getExecutionSummary",
      requestType = ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest,
      ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary> getGetExecutionSummaryMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest, ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary> getGetExecutionSummaryMethod;
    if ((getGetExecutionSummaryMethod = WorkflowExecutionQueryControllerGrpc.getGetExecutionSummaryMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getGetExecutionSummaryMethod = WorkflowExecutionQueryControllerGrpc.getGetExecutionSummaryMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getGetExecutionSummaryMethod = getGetExecutionSummaryMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest, ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getExecutionSummary"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("getExecutionSummary"))
              .build();
        }
      }
    }
    return getGetExecutionSummaryMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest,
      ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList> getListPendingApprovalsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listPendingApprovals",
      requestType = ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest,
      ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList> getListPendingApprovalsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest, ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList> getListPendingApprovalsMethod;
    if ((getListPendingApprovalsMethod = WorkflowExecutionQueryControllerGrpc.getListPendingApprovalsMethod) == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        if ((getListPendingApprovalsMethod = WorkflowExecutionQueryControllerGrpc.getListPendingApprovalsMethod) == null) {
          WorkflowExecutionQueryControllerGrpc.getListPendingApprovalsMethod = getListPendingApprovalsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest, ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listPendingApprovals"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerMethodDescriptorSupplier("listPendingApprovals"))
              .build();
        }
      }
    }
    return getListPendingApprovalsMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowExecutionQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerStub>() {
        @java.lang.Override
        public WorkflowExecutionQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionQueryControllerStub(channel, callOptions);
        }
      };
    return WorkflowExecutionQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowExecutionQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowExecutionQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowExecutionQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowExecutionQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowExecutionQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowExecutionQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowExecutionQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionQueryControllerFutureStub>() {
        @java.lang.Override
        public WorkflowExecutionQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionQueryControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowExecutionQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowExecutionQueryController handles read operations (Get, List, Subscribe) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowExecution
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow/WorkflowInstance
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single workflow execution by ID.
     * Retrieves the complete WorkflowExecution resource including:
     * - spec: User inputs (workflow_instance_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    default void get(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List workflow executions with pagination and optional filtering.
     * Returns a paginated list of WorkflowExecution resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    default void list(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow or WorkflowInstance.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    default void listByWorkflow(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByWorkflowMethod(), responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow execution (server streaming).
     * Opens a bidirectional stream that pushes WorkflowExecution updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    default void subscribe(ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubscribeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow execution.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    default void getEventLog(ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetEventLogMethod(), responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowExecutionEvent messages as they occur during execution.
     * Unlike subscribe() which streams full WorkflowExecution snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    default void subscribeEvents(ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubscribeEventsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's workflows.
     * Returns counts by phase, total cost, average duration, top failing
     * workflows, and per-workflow cost breakdown — scoped to a configurable
     * time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    default void getExecutionSummary(ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetExecutionSummaryMethod(), responseObserver);
    }

    /**
     * <pre>
     * List workflow executions with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    default void listPendingApprovals(ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListPendingApprovalsMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowExecutionQueryController.
   * <pre>
   * WorkflowExecutionQueryController handles read operations (Get, List, Subscribe) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowExecution
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow/WorkflowInstance
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static abstract class WorkflowExecutionQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowExecutionQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowExecutionQueryController.
   * <pre>
   * WorkflowExecutionQueryController handles read operations (Get, List, Subscribe) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowExecution
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow/WorkflowInstance
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowExecutionQueryControllerStub> {
    private WorkflowExecutionQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow execution by ID.
     * Retrieves the complete WorkflowExecution resource including:
     * - spec: User inputs (workflow_instance_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public void get(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List workflow executions with pagination and optional filtering.
     * Returns a paginated list of WorkflowExecution resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public void list(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow or WorkflowInstance.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public void listByWorkflow(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByWorkflowMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow execution (server streaming).
     * Opens a bidirectional stream that pushes WorkflowExecution updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    public void subscribe(ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncServerStreamingCall(
          getChannel().newCall(getSubscribeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow execution.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public void getEventLog(ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetEventLogMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowExecutionEvent messages as they occur during execution.
     * Unlike subscribe() which streams full WorkflowExecution snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    public void subscribeEvents(ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncServerStreamingCall(
          getChannel().newCall(getSubscribeEventsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's workflows.
     * Returns counts by phase, total cost, average duration, top failing
     * workflows, and per-workflow cost breakdown — scoped to a configurable
     * time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public void getExecutionSummary(ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetExecutionSummaryMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List workflow executions with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public void listPendingApprovals(ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListPendingApprovalsMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowExecutionQueryController.
   * <pre>
   * WorkflowExecutionQueryController handles read operations (Get, List, Subscribe) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowExecution
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow/WorkflowInstance
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowExecutionQueryControllerBlockingV2Stub> {
    private WorkflowExecutionQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow execution by ID.
     * Retrieves the complete WorkflowExecution resource including:
     * - spec: User inputs (workflow_instance_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution get(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow executions with pagination and optional filtering.
     * Returns a paginated list of WorkflowExecution resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList list(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow or WorkflowInstance.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList listByWorkflow(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByWorkflowMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow execution (server streaming).
     * Opens a bidirectional stream that pushes WorkflowExecution updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<?, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>
        subscribe(ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest request) {
      return io.grpc.stub.ClientCalls.blockingV2ServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow execution.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse getEventLog(ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetEventLogMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowExecutionEvent messages as they occur during execution.
     * Unlike subscribe() which streams full WorkflowExecution snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<?, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent>
        subscribeEvents(ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest request) {
      return io.grpc.stub.ClientCalls.blockingV2ServerStreamingCall(
          getChannel(), getSubscribeEventsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's workflows.
     * Returns counts by phase, total cost, average duration, top failing
     * workflows, and per-workflow cost breakdown — scoped to a configurable
     * time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary getExecutionSummary(ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetExecutionSummaryMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow executions with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList listPendingApprovals(ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListPendingApprovalsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowExecutionQueryController.
   * <pre>
   * WorkflowExecutionQueryController handles read operations (Get, List, Subscribe) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowExecution
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow/WorkflowInstance
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowExecutionQueryControllerBlockingStub> {
    private WorkflowExecutionQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow execution by ID.
     * Retrieves the complete WorkflowExecution resource including:
     * - spec: User inputs (workflow_instance_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution get(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow executions with pagination and optional filtering.
     * Returns a paginated list of WorkflowExecution resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList list(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow or WorkflowInstance.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList listByWorkflow(ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByWorkflowMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow execution (server streaming).
     * Opens a bidirectional stream that pushes WorkflowExecution updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    public java.util.Iterator<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> subscribe(
        ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest request) {
      return io.grpc.stub.ClientCalls.blockingServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow execution.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse getEventLog(ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetEventLogMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowExecutionEvent messages as they occur during execution.
     * Unlike subscribe() which streams full WorkflowExecution snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    public java.util.Iterator<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent> subscribeEvents(
        ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest request) {
      return io.grpc.stub.ClientCalls.blockingServerStreamingCall(
          getChannel(), getSubscribeEventsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's workflows.
     * Returns counts by phase, total cost, average duration, top failing
     * workflows, and per-workflow cost breakdown — scoped to a configurable
     * time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary getExecutionSummary(ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetExecutionSummaryMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow executions with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList listPendingApprovals(ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListPendingApprovalsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowExecutionQueryController.
   * <pre>
   * WorkflowExecutionQueryController handles read operations (Get, List, Subscribe) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowExecution
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow/WorkflowInstance
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowExecutionQueryControllerFutureStub> {
    private WorkflowExecutionQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow execution by ID.
     * Retrieves the complete WorkflowExecution resource including:
     * - spec: User inputs (workflow_instance_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> get(
        ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List workflow executions with pagination and optional filtering.
     * Returns a paginated list of WorkflowExecution resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> list(
        ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow or WorkflowInstance.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList> listByWorkflow(
        ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByWorkflowMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow execution.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse> getEventLog(
        ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetEventLogMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's workflows.
     * Returns counts by phase, total cost, average duration, top failing
     * workflows, and per-workflow cost breakdown — scoped to a configurable
     * time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary> getExecutionSummary(
        ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetExecutionSummaryMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List workflow executions with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList> listPendingApprovals(
        ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListPendingApprovalsMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;
  private static final int METHODID_LIST_BY_WORKFLOW = 2;
  private static final int METHODID_SUBSCRIBE = 3;
  private static final int METHODID_GET_EVENT_LOG = 4;
  private static final int METHODID_SUBSCRIBE_EVENTS = 5;
  private static final int METHODID_GET_EXECUTION_SUMMARY = 6;
  private static final int METHODID_LIST_PENDING_APPROVALS = 7;

  private static final class MethodHandlers<Req, Resp> implements
      io.grpc.stub.ServerCalls.UnaryMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ServerStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ClientStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.BidiStreamingMethod<Req, Resp> {
    private final AsyncService serviceImpl;
    private final int methodId;

    MethodHandlers(AsyncService serviceImpl, int methodId) {
      this.serviceImpl = serviceImpl;
      this.methodId = methodId;
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public void invoke(Req request, io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        case METHODID_GET:
          serviceImpl.get((ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList>) responseObserver);
          break;
        case METHODID_LIST_BY_WORKFLOW:
          serviceImpl.listByWorkflow((ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList>) responseObserver);
          break;
        case METHODID_SUBSCRIBE:
          serviceImpl.subscribe((ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_GET_EVENT_LOG:
          serviceImpl.getEventLog((ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse>) responseObserver);
          break;
        case METHODID_SUBSCRIBE_EVENTS:
          serviceImpl.subscribeEvents((ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent>) responseObserver);
          break;
        case METHODID_GET_EXECUTION_SUMMARY:
          serviceImpl.getExecutionSummary((ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary>) responseObserver);
          break;
        case METHODID_LIST_PENDING_APPROVALS:
          serviceImpl.listPendingApprovals((ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList>) responseObserver);
          break;
        default:
          throw new AssertionError();
      }
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public io.grpc.stub.StreamObserver<Req> invoke(
        io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        default:
          throw new AssertionError();
      }
    }
  }

  public static final io.grpc.ServerServiceDefinition bindService(AsyncService service) {
    return io.grpc.ServerServiceDefinition.builder(getServiceDescriptor())
        .addMethod(
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionId,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsRequest,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList>(
                service, METHODID_LIST)))
        .addMethod(
          getListByWorkflowMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.ListWorkflowExecutionsByWorkflowRequest,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionList>(
                service, METHODID_LIST_BY_WORKFLOW)))
        .addMethod(
          getSubscribeMethod(),
          io.grpc.stub.ServerCalls.asyncServerStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SubscribeWorkflowExecutionRequest,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_SUBSCRIBE)))
        .addMethod(
          getGetEventLogMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.GetEventLogRequest,
              ai.stigmer.agentic.workflowexecution.v1.GetEventLogResponse>(
                service, METHODID_GET_EVENT_LOG)))
        .addMethod(
          getSubscribeEventsMethod(),
          io.grpc.stub.ServerCalls.asyncServerStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SubscribeEventsRequest,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionEvent>(
                service, METHODID_SUBSCRIBE_EVENTS)))
        .addMethod(
          getGetExecutionSummaryMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.GetExecutionSummaryRequest,
              ai.stigmer.agentic.workflowexecution.v1.ExecutionSummary>(
                service, METHODID_GET_EXECUTION_SUMMARY)))
        .addMethod(
          getListPendingApprovalsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.ListPendingApprovalsRequest,
              ai.stigmer.agentic.workflowexecution.v1.PendingApprovalsList>(
                service, METHODID_LIST_PENDING_APPROVALS)))
        .build();
  }

  private static abstract class WorkflowExecutionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowExecutionQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflowexecution.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowExecutionQueryController");
    }
  }

  private static final class WorkflowExecutionQueryControllerFileDescriptorSupplier
      extends WorkflowExecutionQueryControllerBaseDescriptorSupplier {
    WorkflowExecutionQueryControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowExecutionQueryControllerMethodDescriptorSupplier
      extends WorkflowExecutionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowExecutionQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
      this.methodName = methodName;
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.MethodDescriptor getMethodDescriptor() {
      return getServiceDescriptor().findMethodByName(methodName);
    }
  }

  private static volatile io.grpc.ServiceDescriptor serviceDescriptor;

  public static io.grpc.ServiceDescriptor getServiceDescriptor() {
    io.grpc.ServiceDescriptor result = serviceDescriptor;
    if (result == null) {
      synchronized (WorkflowExecutionQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowExecutionQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .addMethod(getListByWorkflowMethod())
              .addMethod(getSubscribeMethod())
              .addMethod(getGetEventLogMethod())
              .addMethod(getSubscribeEventsMethod())
              .addMethod(getGetExecutionSummaryMethod())
              .addMethod(getListPendingApprovalsMethod())
              .build();
        }
      }
    }
    return result;
  }
}
