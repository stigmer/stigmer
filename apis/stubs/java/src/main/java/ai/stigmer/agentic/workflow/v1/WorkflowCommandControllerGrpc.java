package ai.stigmer.agentic.workflow.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowCommandController handles write operations for workflows.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowCommandControllerGrpc {

  private WorkflowCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflow.v1.WorkflowCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow> getApplyMethod;
    if ((getApplyMethod = WorkflowCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getApplyMethod = WorkflowCommandControllerGrpc.getApplyMethod) == null) {
          WorkflowCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow> getCreateMethod;
    if ((getCreateMethod = WorkflowCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getCreateMethod = WorkflowCommandControllerGrpc.getCreateMethod) == null) {
          WorkflowCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow> getUpdateMethod;
    if ((getUpdateMethod = WorkflowCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getUpdateMethod = WorkflowCommandControllerGrpc.getUpdateMethod) == null) {
          WorkflowCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId,
      ai.stigmer.agentic.workflow.v1.Workflow> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.workflow.v1.WorkflowId.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId,
      ai.stigmer.agentic.workflow.v1.Workflow> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId, ai.stigmer.agentic.workflow.v1.Workflow> getDeleteMethod;
    if ((getDeleteMethod = WorkflowCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getDeleteMethod = WorkflowCommandControllerGrpc.getDeleteMethod) == null) {
          WorkflowCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.WorkflowId, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.WorkflowId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput,
      ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput> getGenerateWorkflowFromPromptMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "generateWorkflowFromPrompt",
      requestType = ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput.class,
      responseType = ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput,
      ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput> getGenerateWorkflowFromPromptMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput, ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput> getGenerateWorkflowFromPromptMethod;
    if ((getGenerateWorkflowFromPromptMethod = WorkflowCommandControllerGrpc.getGenerateWorkflowFromPromptMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getGenerateWorkflowFromPromptMethod = WorkflowCommandControllerGrpc.getGenerateWorkflowFromPromptMethod) == null) {
          WorkflowCommandControllerGrpc.getGenerateWorkflowFromPromptMethod = getGenerateWorkflowFromPromptMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput, ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "generateWorkflowFromPrompt"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("generateWorkflowFromPrompt"))
              .build();
        }
      }
    }
    return getGenerateWorkflowFromPromptMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.RefineWorkflowInput,
      ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput> getRefineWorkflowMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "refineWorkflow",
      requestType = ai.stigmer.agentic.workflow.v1.RefineWorkflowInput.class,
      responseType = ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.RefineWorkflowInput,
      ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput> getRefineWorkflowMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.RefineWorkflowInput, ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput> getRefineWorkflowMethod;
    if ((getRefineWorkflowMethod = WorkflowCommandControllerGrpc.getRefineWorkflowMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getRefineWorkflowMethod = WorkflowCommandControllerGrpc.getRefineWorkflowMethod) == null) {
          WorkflowCommandControllerGrpc.getRefineWorkflowMethod = getRefineWorkflowMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.RefineWorkflowInput, ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "refineWorkflow"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.RefineWorkflowInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("refineWorkflow"))
              .build();
        }
      }
    }
    return getRefineWorkflowMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerStub>() {
        @java.lang.Override
        public WorkflowCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerStub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerFutureStub>() {
        @java.lang.Override
        public WorkflowCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    default void create(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    default void update(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.workflow.v1.WorkflowId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Generate a workflow from a natural language description.
     * Constructs a prompt with task kind metadata, example workflows, and the
     * organization's available resources, then calls an LLM to produce valid
     * workflow YAML. The output is validated server-side with up to 2 retries
     * on validation failure before being returned to the caller.
     * </pre>
     */
    default void generateWorkflowFromPrompt(ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGenerateWorkflowFromPromptMethod(), responseObserver);
    }

    /**
     * <pre>
     * Refine an existing workflow with a natural language instruction.
     * Receives the current workflow YAML and a change instruction, constructs
     * a prompt emphasizing minimal targeted changes, calls an LLM to produce
     * updated YAML, and validates the output with up to 2 retries on failure.
     * </pre>
     */
    default void refineWorkflow(ai.stigmer.agentic.workflow.v1.RefineWorkflowInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRefineWorkflowMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static abstract class WorkflowCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowCommandControllerStub> {
    private WorkflowCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public void create(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public void update(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.workflow.v1.WorkflowId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Generate a workflow from a natural language description.
     * Constructs a prompt with task kind metadata, example workflows, and the
     * organization's available resources, then calls an LLM to produce valid
     * workflow YAML. The output is validated server-side with up to 2 retries
     * on validation failure before being returned to the caller.
     * </pre>
     */
    public void generateWorkflowFromPrompt(ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGenerateWorkflowFromPromptMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Refine an existing workflow with a natural language instruction.
     * Receives the current workflow YAML and a change instruction, constructs
     * a prompt emphasizing minimal targeted changes, calls an LLM to produce
     * updated YAML, and validates the output with up to 2 retries on failure.
     * </pre>
     */
    public void refineWorkflow(ai.stigmer.agentic.workflow.v1.RefineWorkflowInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRefineWorkflowMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowCommandControllerBlockingV2Stub> {
    private WorkflowCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow apply(ai.stigmer.agentic.workflow.v1.Workflow request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow create(ai.stigmer.agentic.workflow.v1.Workflow request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow update(ai.stigmer.agentic.workflow.v1.Workflow request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow delete(ai.stigmer.agentic.workflow.v1.WorkflowId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Generate a workflow from a natural language description.
     * Constructs a prompt with task kind metadata, example workflows, and the
     * organization's available resources, then calls an LLM to produce valid
     * workflow YAML. The output is validated server-side with up to 2 retries
     * on validation failure before being returned to the caller.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput generateWorkflowFromPrompt(ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGenerateWorkflowFromPromptMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Refine an existing workflow with a natural language instruction.
     * Receives the current workflow YAML and a change instruction, constructs
     * a prompt emphasizing minimal targeted changes, calls an LLM to produce
     * updated YAML, and validates the output with up to 2 retries on failure.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput refineWorkflow(ai.stigmer.agentic.workflow.v1.RefineWorkflowInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRefineWorkflowMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowCommandControllerBlockingStub> {
    private WorkflowCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow apply(ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow create(ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow update(ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow delete(ai.stigmer.agentic.workflow.v1.WorkflowId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Generate a workflow from a natural language description.
     * Constructs a prompt with task kind metadata, example workflows, and the
     * organization's available resources, then calls an LLM to produce valid
     * workflow YAML. The output is validated server-side with up to 2 retries
     * on validation failure before being returned to the caller.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput generateWorkflowFromPrompt(ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGenerateWorkflowFromPromptMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Refine an existing workflow with a natural language instruction.
     * Receives the current workflow YAML and a change instruction, constructs
     * a prompt emphasizing minimal targeted changes, calls an LLM to produce
     * updated YAML, and validates the output with up to 2 retries on failure.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput refineWorkflow(ai.stigmer.agentic.workflow.v1.RefineWorkflowInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRefineWorkflowMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowCommandControllerFutureStub> {
    private WorkflowCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> apply(
        ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> create(
        ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> update(
        ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> delete(
        ai.stigmer.agentic.workflow.v1.WorkflowId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Generate a workflow from a natural language description.
     * Constructs a prompt with task kind metadata, example workflows, and the
     * organization's available resources, then calls an LLM to produce valid
     * workflow YAML. The output is validated server-side with up to 2 retries
     * on validation failure before being returned to the caller.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput> generateWorkflowFromPrompt(
        ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGenerateWorkflowFromPromptMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Refine an existing workflow with a natural language instruction.
     * Receives the current workflow YAML and a change instruction, constructs
     * a prompt emphasizing minimal targeted changes, calls an LLM to produce
     * updated YAML, and validates the output with up to 2 retries on failure.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput> refineWorkflow(
        ai.stigmer.agentic.workflow.v1.RefineWorkflowInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRefineWorkflowMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_GENERATE_WORKFLOW_FROM_PROMPT = 4;
  private static final int METHODID_REFINE_WORKFLOW = 5;

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
        case METHODID_APPLY:
          serviceImpl.apply((ai.stigmer.agentic.workflow.v1.Workflow) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.workflow.v1.Workflow) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.workflow.v1.Workflow) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.workflow.v1.WorkflowId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_GENERATE_WORKFLOW_FROM_PROMPT:
          serviceImpl.generateWorkflowFromPrompt((ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput>) responseObserver);
          break;
        case METHODID_REFINE_WORKFLOW:
          serviceImpl.refineWorkflow((ai.stigmer.agentic.workflow.v1.RefineWorkflowInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput>) responseObserver);
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
          getApplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.Workflow,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.Workflow,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.Workflow,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.WorkflowId,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_DELETE)))
        .addMethod(
          getGenerateWorkflowFromPromptMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptInput,
              ai.stigmer.agentic.workflow.v1.GenerateWorkflowFromPromptOutput>(
                service, METHODID_GENERATE_WORKFLOW_FROM_PROMPT)))
        .addMethod(
          getRefineWorkflowMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.RefineWorkflowInput,
              ai.stigmer.agentic.workflow.v1.RefineWorkflowOutput>(
                service, METHODID_REFINE_WORKFLOW)))
        .build();
  }

  private static abstract class WorkflowCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflow.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowCommandController");
    }
  }

  private static final class WorkflowCommandControllerFileDescriptorSupplier
      extends WorkflowCommandControllerBaseDescriptorSupplier {
    WorkflowCommandControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowCommandControllerMethodDescriptorSupplier
      extends WorkflowCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getGenerateWorkflowFromPromptMethod())
              .addMethod(getRefineWorkflowMethod())
              .build();
        }
      }
    }
    return result;
  }
}
