package ai.stigmer.agentic.workflowrun.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowRunQueryController handles read operations (Get, List, Subscribe) for WorkflowRun resources.
 * This service follows the Command-Query Separation (CQS) pattern:
 * - CommandController: Write operations (create, update, delete)
 * - QueryController: Read operations (get, list, search, subscribe)
 * Authorization:
 * - get: Standard authorization - user must have "get" permission on the specific WorkflowRun
 * - list: Custom authorization - filters results based on user's owner scope and permissions
 * - list_by_workflow: Custom authorization - verifies user has access to the Workflow
 * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
 * Service Options:
 * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowRunQueryControllerGrpc {

  private WorkflowRunQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflowrun.v1.WorkflowRunQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRunId,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.workflowrun.v1.WorkflowRunId.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRunId,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRunId, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getGetMethod;
    if ((getGetMethod = WorkflowRunQueryControllerGrpc.getGetMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getGetMethod = WorkflowRunQueryControllerGrpc.getGetMethod) == null) {
          WorkflowRunQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.WorkflowRunId, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> getListMethod;
    if ((getListMethod = WorkflowRunQueryControllerGrpc.getListMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getListMethod = WorkflowRunQueryControllerGrpc.getListMethod) == null) {
          WorkflowRunQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRunList.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> getListByWorkflowMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByWorkflow",
      requestType = ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> getListByWorkflowMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> getListByWorkflowMethod;
    if ((getListByWorkflowMethod = WorkflowRunQueryControllerGrpc.getListByWorkflowMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getListByWorkflowMethod = WorkflowRunQueryControllerGrpc.getListByWorkflowMethod) == null) {
          WorkflowRunQueryControllerGrpc.getListByWorkflowMethod = getListByWorkflowMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByWorkflow"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRunList.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("listByWorkflow"))
              .build();
        }
      }
    }
    return getListByWorkflowMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubscribeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "subscribe",
      requestType = ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubscribeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubscribeMethod;
    if ((getSubscribeMethod = WorkflowRunQueryControllerGrpc.getSubscribeMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getSubscribeMethod = WorkflowRunQueryControllerGrpc.getSubscribeMethod) == null) {
          WorkflowRunQueryControllerGrpc.getSubscribeMethod = getSubscribeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "subscribe"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("subscribe"))
              .build();
        }
      }
    }
    return getSubscribeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest,
      ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse> getGetEventLogMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getEventLog",
      requestType = ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest,
      ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse> getGetEventLogMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest, ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse> getGetEventLogMethod;
    if ((getGetEventLogMethod = WorkflowRunQueryControllerGrpc.getGetEventLogMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getGetEventLogMethod = WorkflowRunQueryControllerGrpc.getGetEventLogMethod) == null) {
          WorkflowRunQueryControllerGrpc.getGetEventLogMethod = getGetEventLogMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest, ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getEventLog"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("getEventLog"))
              .build();
        }
      }
    }
    return getGetEventLogMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent> getSubscribeEventsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "subscribeEvents",
      requestType = ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent> getSubscribeEventsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent> getSubscribeEventsMethod;
    if ((getSubscribeEventsMethod = WorkflowRunQueryControllerGrpc.getSubscribeEventsMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getSubscribeEventsMethod = WorkflowRunQueryControllerGrpc.getSubscribeEventsMethod) == null) {
          WorkflowRunQueryControllerGrpc.getSubscribeEventsMethod = getSubscribeEventsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest, ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "subscribeEvents"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("subscribeEvents"))
              .build();
        }
      }
    }
    return getSubscribeEventsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest,
      ai.stigmer.agentic.workflowrun.v1.RunSummary> getGetRunSummaryMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getRunSummary",
      requestType = ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.RunSummary.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest,
      ai.stigmer.agentic.workflowrun.v1.RunSummary> getGetRunSummaryMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest, ai.stigmer.agentic.workflowrun.v1.RunSummary> getGetRunSummaryMethod;
    if ((getGetRunSummaryMethod = WorkflowRunQueryControllerGrpc.getGetRunSummaryMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getGetRunSummaryMethod = WorkflowRunQueryControllerGrpc.getGetRunSummaryMethod) == null) {
          WorkflowRunQueryControllerGrpc.getGetRunSummaryMethod = getGetRunSummaryMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest, ai.stigmer.agentic.workflowrun.v1.RunSummary>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getRunSummary"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.RunSummary.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("getRunSummary"))
              .build();
        }
      }
    }
    return getGetRunSummaryMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest,
      ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList> getListPendingApprovalsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listPendingApprovals",
      requestType = ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest,
      ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList> getListPendingApprovalsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest, ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList> getListPendingApprovalsMethod;
    if ((getListPendingApprovalsMethod = WorkflowRunQueryControllerGrpc.getListPendingApprovalsMethod) == null) {
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        if ((getListPendingApprovalsMethod = WorkflowRunQueryControllerGrpc.getListPendingApprovalsMethod) == null) {
          WorkflowRunQueryControllerGrpc.getListPendingApprovalsMethod = getListPendingApprovalsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest, ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listPendingApprovals"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunQueryControllerMethodDescriptorSupplier("listPendingApprovals"))
              .build();
        }
      }
    }
    return getListPendingApprovalsMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowRunQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerStub>() {
        @java.lang.Override
        public WorkflowRunQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunQueryControllerStub(channel, callOptions);
        }
      };
    return WorkflowRunQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowRunQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowRunQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowRunQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowRunQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowRunQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowRunQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowRunQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunQueryControllerFutureStub>() {
        @java.lang.Override
        public WorkflowRunQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunQueryControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowRunQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowRunQueryController handles read operations (Get, List, Subscribe) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowRun
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single workflow run by ID.
     * Retrieves the complete WorkflowRun resource including:
     * - spec: User inputs (workflow_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    default void get(ai.stigmer.agentic.workflowrun.v1.WorkflowRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List workflow runs with pagination and optional filtering.
     * Returns a paginated list of WorkflowRun resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    default void list(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    default void listByWorkflow(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByWorkflowMethod(), responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow run (server streaming).
     * Opens a bidirectional stream that pushes WorkflowRun updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    default void subscribe(ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubscribeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow run.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    default void getEventLog(ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetEventLogMethod(), responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowRunEvent messages as they occur during run.
     * Unlike subscribe() which streams full WorkflowRun snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    default void subscribeEvents(ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent> responseObserver) {
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
    default void getRunSummary(ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.RunSummary> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetRunSummaryMethod(), responseObserver);
    }

    /**
     * <pre>
     * List workflow runs with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    default void listPendingApprovals(ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListPendingApprovalsMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowRunQueryController.
   * <pre>
   * WorkflowRunQueryController handles read operations (Get, List, Subscribe) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowRun
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static abstract class WorkflowRunQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowRunQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowRunQueryController.
   * <pre>
   * WorkflowRunQueryController handles read operations (Get, List, Subscribe) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowRun
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowRunQueryControllerStub> {
    private WorkflowRunQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow run by ID.
     * Retrieves the complete WorkflowRun resource including:
     * - spec: User inputs (workflow_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public void get(ai.stigmer.agentic.workflowrun.v1.WorkflowRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List workflow runs with pagination and optional filtering.
     * Returns a paginated list of WorkflowRun resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public void list(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public void listByWorkflow(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByWorkflowMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow run (server streaming).
     * Opens a bidirectional stream that pushes WorkflowRun updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    public void subscribe(ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncServerStreamingCall(
          getChannel().newCall(getSubscribeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow run.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public void getEventLog(ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetEventLogMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowRunEvent messages as they occur during run.
     * Unlike subscribe() which streams full WorkflowRun snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    public void subscribeEvents(ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent> responseObserver) {
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
    public void getRunSummary(ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.RunSummary> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetRunSummaryMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List workflow runs with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public void listPendingApprovals(ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListPendingApprovalsMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowRunQueryController.
   * <pre>
   * WorkflowRunQueryController handles read operations (Get, List, Subscribe) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowRun
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowRunQueryControllerBlockingV2Stub> {
    private WorkflowRunQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow run by ID.
     * Retrieves the complete WorkflowRun resource including:
     * - spec: User inputs (workflow_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun get(ai.stigmer.agentic.workflowrun.v1.WorkflowRunId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow runs with pagination and optional filtering.
     * Returns a paginated list of WorkflowRun resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRunList list(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRunList listByWorkflow(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByWorkflowMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow run (server streaming).
     * Opens a bidirectional stream that pushes WorkflowRun updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<?, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>
        subscribe(ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest request) {
      return io.grpc.stub.ClientCalls.blockingV2ServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow run.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse getEventLog(ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetEventLogMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowRunEvent messages as they occur during run.
     * Unlike subscribe() which streams full WorkflowRun snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<?, ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent>
        subscribeEvents(ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest request) {
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
    public ai.stigmer.agentic.workflowrun.v1.RunSummary getRunSummary(ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetRunSummaryMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow runs with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList listPendingApprovals(ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListPendingApprovalsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowRunQueryController.
   * <pre>
   * WorkflowRunQueryController handles read operations (Get, List, Subscribe) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowRun
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowRunQueryControllerBlockingStub> {
    private WorkflowRunQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow run by ID.
     * Retrieves the complete WorkflowRun resource including:
     * - spec: User inputs (workflow_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun get(ai.stigmer.agentic.workflowrun.v1.WorkflowRunId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow runs with pagination and optional filtering.
     * Returns a paginated list of WorkflowRun resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRunList list(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRunList listByWorkflow(ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByWorkflowMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time updates for a specific workflow run (server streaming).
     * Opens a bidirectional stream that pushes WorkflowRun updates as they occur.
     * Client receives updates when:
     * - Execution phase changes (PENDING → IN_PROGRESS → COMPLETED)
     * - Tasks start or complete
     * - Progress events are appended
     * - Output or error fields are set
     * </pre>
     */
    public java.util.Iterator<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> subscribe(
        ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest request) {
      return io.grpc.stub.ClientCalls.blockingServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow run.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse getEventLog(ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetEventLogMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution events (incremental event stream).
     * Opens a server-side streaming RPC that pushes individual
     * WorkflowRunEvent messages as they occur during run.
     * Unlike subscribe() which streams full WorkflowRun snapshots,
     * this streams lightweight incremental events for the timeline view.
     * </pre>
     */
    public java.util.Iterator<ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent> subscribeEvents(
        ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest request) {
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
    public ai.stigmer.agentic.workflowrun.v1.RunSummary getRunSummary(ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetRunSummaryMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List workflow runs with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList listPendingApprovals(ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListPendingApprovalsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowRunQueryController.
   * <pre>
   * WorkflowRunQueryController handles read operations (Get, List, Subscribe) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search, subscribe)
   * Authorization:
   * - get: Standard authorization - user must have "get" permission on the specific WorkflowRun
   * - list: Custom authorization - filters results based on user's owner scope and permissions
   * - list_by_workflow: Custom authorization - verifies user has access to the Workflow
   * - subscribe: Standard authorization - user must have "get" permission to subscribe to updates
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowRunQueryControllerFutureStub> {
    private WorkflowRunQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow run by ID.
     * Retrieves the complete WorkflowRun resource including:
     * - spec: User inputs (workflow_id, trigger_message, etc.)
     * - status: Current execution state (phase, tasks, progress_events, output/error)
     * - metadata: Resource identification (id, name, labels, tags)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> get(
        ai.stigmer.agentic.workflowrun.v1.WorkflowRunId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List workflow runs with pagination and optional filtering.
     * Returns a paginated list of WorkflowRun resources that the user has access to.
     * Results are automatically filtered based on user's permissions and owner scope.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> list(
        ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all executions for a specific Workflow.
     * Returns executions filtered by a specific Workflow ID.
     * This is useful for viewing execution history of a particular workflow.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList> listByWorkflow(
        ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByWorkflowMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Fetch the paginated event log for a workflow run.
     * Returns execution events ordered by sequence_number ascending, with
     * cursor-based pagination and optional filtering by event type or task name.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse> getEventLog(
        ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest request) {
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
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.RunSummary> getRunSummary(
        ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetRunSummaryMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List workflow runs with pending human_input tasks awaiting reviewer decisions.
     * Returns a paginated list of executions where at least one human_input
     * task is actively waiting for a response. Each entry includes the
     * execution context, task details, requester, and timeout information.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList> listPendingApprovals(
        ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest request) {
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
  private static final int METHODID_GET_RUN_SUMMARY = 6;
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
          serviceImpl.get((ai.stigmer.agentic.workflowrun.v1.WorkflowRunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList>) responseObserver);
          break;
        case METHODID_LIST_BY_WORKFLOW:
          serviceImpl.listByWorkflow((ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunList>) responseObserver);
          break;
        case METHODID_SUBSCRIBE:
          serviceImpl.subscribe((ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_GET_EVENT_LOG:
          serviceImpl.getEventLog((ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse>) responseObserver);
          break;
        case METHODID_SUBSCRIBE_EVENTS:
          serviceImpl.subscribeEvents((ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent>) responseObserver);
          break;
        case METHODID_GET_RUN_SUMMARY:
          serviceImpl.getRunSummary((ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.RunSummary>) responseObserver);
          break;
        case METHODID_LIST_PENDING_APPROVALS:
          serviceImpl.listPendingApprovals((ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList>) responseObserver);
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
              ai.stigmer.agentic.workflowrun.v1.WorkflowRunId,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsRequest,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRunList>(
                service, METHODID_LIST)))
        .addMethod(
          getListByWorkflowMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.ListWorkflowRunsByWorkflowRequest,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRunList>(
                service, METHODID_LIST_BY_WORKFLOW)))
        .addMethod(
          getSubscribeMethod(),
          io.grpc.stub.ServerCalls.asyncServerStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.SubscribeWorkflowRunRequest,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_SUBSCRIBE)))
        .addMethod(
          getGetEventLogMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.GetEventLogRequest,
              ai.stigmer.agentic.workflowrun.v1.GetEventLogResponse>(
                service, METHODID_GET_EVENT_LOG)))
        .addMethod(
          getSubscribeEventsMethod(),
          io.grpc.stub.ServerCalls.asyncServerStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.SubscribeEventsRequest,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRunEvent>(
                service, METHODID_SUBSCRIBE_EVENTS)))
        .addMethod(
          getGetRunSummaryMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.GetRunSummaryRequest,
              ai.stigmer.agentic.workflowrun.v1.RunSummary>(
                service, METHODID_GET_RUN_SUMMARY)))
        .addMethod(
          getListPendingApprovalsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.ListPendingApprovalsRequest,
              ai.stigmer.agentic.workflowrun.v1.PendingApprovalsList>(
                service, METHODID_LIST_PENDING_APPROVALS)))
        .build();
  }

  private static abstract class WorkflowRunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowRunQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflowrun.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowRunQueryController");
    }
  }

  private static final class WorkflowRunQueryControllerFileDescriptorSupplier
      extends WorkflowRunQueryControllerBaseDescriptorSupplier {
    WorkflowRunQueryControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowRunQueryControllerMethodDescriptorSupplier
      extends WorkflowRunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowRunQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowRunQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowRunQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .addMethod(getListByWorkflowMethod())
              .addMethod(getSubscribeMethod())
              .addMethod(getGetEventLogMethod())
              .addMethod(getSubscribeEventsMethod())
              .addMethod(getGetRunSummaryMethod())
              .addMethod(getListPendingApprovalsMethod())
              .build();
        }
      }
    }
    return result;
  }
}
