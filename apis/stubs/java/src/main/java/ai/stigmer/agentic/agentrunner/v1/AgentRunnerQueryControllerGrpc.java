package ai.stigmer.agentic.agentrunner.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentRunnerQueryController handles read operations for agent runners.
 * The primary consumer is the session composer dropdown, which calls list
 * to show available runners the user can select. System-managed (ephemeral)
 * runners are excluded from the dropdown by filtering on labels.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentRunnerQueryControllerGrpc {

  private AgentRunnerQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentrunner.v1.AgentRunnerQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agentrunner.v1.AgentRunnerId.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId, ai.stigmer.agentic.agentrunner.v1.AgentRunner> getGetMethod;
    if ((getGetMethod = AgentRunnerQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentRunnerQueryControllerGrpc.class) {
        if ((getGetMethod = AgentRunnerQueryControllerGrpc.getGetMethod) == null) {
          AgentRunnerQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId, ai.stigmer.agentic.agentrunner.v1.AgentRunner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunnerId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentrunner.v1.AgentRunner> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = AgentRunnerQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (AgentRunnerQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = AgentRunnerQueryControllerGrpc.getGetByReferenceMethod) == null) {
          AgentRunnerQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentrunner.v1.AgentRunner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest,
      ai.stigmer.agentic.agentrunner.v1.AgentRunnerList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunnerList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest,
      ai.stigmer.agentic.agentrunner.v1.AgentRunnerList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest, ai.stigmer.agentic.agentrunner.v1.AgentRunnerList> getListMethod;
    if ((getListMethod = AgentRunnerQueryControllerGrpc.getListMethod) == null) {
      synchronized (AgentRunnerQueryControllerGrpc.class) {
        if ((getListMethod = AgentRunnerQueryControllerGrpc.getListMethod) == null) {
          AgentRunnerQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest, ai.stigmer.agentic.agentrunner.v1.AgentRunnerList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunnerList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentRunnerQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerStub>() {
        @java.lang.Override
        public AgentRunnerQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerQueryControllerStub(channel, callOptions);
        }
      };
    return AgentRunnerQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentRunnerQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentRunnerQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentRunnerQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentRunnerQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentRunnerQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentRunnerQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentRunnerQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentRunnerQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentRunnerQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentRunnerQueryController handles read operations for agent runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent runner by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an agent runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full AgentRunner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List agent runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY/IDLE
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunnerList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentRunnerQueryController.
   * <pre>
   * AgentRunnerQueryController handles read operations for agent runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static abstract class AgentRunnerQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentRunnerQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentRunnerQueryController.
   * <pre>
   * AgentRunnerQueryController handles read operations for agent runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class AgentRunnerQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentRunnerQueryControllerStub> {
    private AgentRunnerQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent runner by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an agent runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full AgentRunner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List agent runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY/IDLE
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunnerList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentRunnerQueryController.
   * <pre>
   * AgentRunnerQueryController handles read operations for agent runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class AgentRunnerQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunnerQueryControllerBlockingV2Stub> {
    private AgentRunnerQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent runner by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner get(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full AgentRunner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY/IDLE
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunnerList list(ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentRunnerQueryController.
   * <pre>
   * AgentRunnerQueryController handles read operations for agent runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class AgentRunnerQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunnerQueryControllerBlockingStub> {
    private AgentRunnerQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent runner by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner get(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full AgentRunner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY/IDLE
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunnerList list(ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentRunnerQueryController.
   * <pre>
   * AgentRunnerQueryController handles read operations for agent runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class AgentRunnerQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentRunnerQueryControllerFutureStub> {
    private AgentRunnerQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent runner by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunner> get(
        ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an agent runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full AgentRunner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunner> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List agent runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY/IDLE
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunnerList> list(
        ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST = 2;

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
          serviceImpl.get((ai.stigmer.agentic.agentrunner.v1.AgentRunnerId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunnerList>) responseObserver);
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
              ai.stigmer.agentic.agentrunner.v1.AgentRunnerId,
              ai.stigmer.agentic.agentrunner.v1.AgentRunner>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.agentrunner.v1.AgentRunner>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrunner.v1.ListAgentRunnersRequest,
              ai.stigmer.agentic.agentrunner.v1.AgentRunnerList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class AgentRunnerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentRunnerQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentrunner.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentRunnerQueryController");
    }
  }

  private static final class AgentRunnerQueryControllerFileDescriptorSupplier
      extends AgentRunnerQueryControllerBaseDescriptorSupplier {
    AgentRunnerQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentRunnerQueryControllerMethodDescriptorSupplier
      extends AgentRunnerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentRunnerQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentRunnerQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentRunnerQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
