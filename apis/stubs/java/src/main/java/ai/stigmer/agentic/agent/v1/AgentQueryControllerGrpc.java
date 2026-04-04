package ai.stigmer.agentic.agent.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentQueryController handles read operations for AI agents.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentQueryControllerGrpc {

  private AgentQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agent.v1.AgentQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId,
      ai.stigmer.agentic.agent.v1.Agent> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agent.v1.AgentId.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId,
      ai.stigmer.agentic.agent.v1.Agent> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId, ai.stigmer.agentic.agent.v1.Agent> getGetMethod;
    if ((getGetMethod = AgentQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentQueryControllerGrpc.class) {
        if ((getGetMethod = AgentQueryControllerGrpc.getGetMethod) == null) {
          AgentQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.AgentId, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.AgentId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agent.v1.Agent> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agent.v1.Agent> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agent.v1.Agent> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = AgentQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (AgentQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = AgentQueryControllerGrpc.getGetByReferenceMethod) == null) {
          AgentQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest,
      ai.stigmer.agentic.agent.v1.Agent> getGetDefaultMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getDefault",
      requestType = ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest,
      ai.stigmer.agentic.agent.v1.Agent> getGetDefaultMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest, ai.stigmer.agentic.agent.v1.Agent> getGetDefaultMethod;
    if ((getGetDefaultMethod = AgentQueryControllerGrpc.getGetDefaultMethod) == null) {
      synchronized (AgentQueryControllerGrpc.class) {
        if ((getGetDefaultMethod = AgentQueryControllerGrpc.getGetDefaultMethod) == null) {
          AgentQueryControllerGrpc.getGetDefaultMethod = getGetDefaultMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getDefault"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentQueryControllerMethodDescriptorSupplier("getDefault"))
              .build();
        }
      }
    }
    return getGetDefaultMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerStub>() {
        @java.lang.Override
        public AgentQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerStub(channel, callOptions);
        }
      };
    return AgentQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the platform default agent.
     * Returns the default agent for the platform, including
     * status.default_instance_id for creating a session. Use this
     * to start a conversation without selecting an agent first.
     * Returns NOT_FOUND if no default agent is configured.
     * &#64;internal
     * Resolves the agent labeled stigmer.ai/default-agent: "true" with
     * visibility_public. Custom authorization in handler.
     * </pre>
     */
    default void getDefault(ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetDefaultMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static abstract class AgentQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentQueryControllerStub> {
    private AgentQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the platform default agent.
     * Returns the default agent for the platform, including
     * status.default_instance_id for creating a session. Use this
     * to start a conversation without selecting an agent first.
     * Returns NOT_FOUND if no default agent is configured.
     * &#64;internal
     * Resolves the agent labeled stigmer.ai/default-agent: "true" with
     * visibility_public. Custom authorization in handler.
     * </pre>
     */
    public void getDefault(ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetDefaultMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentQueryControllerBlockingV2Stub> {
    private AgentQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent get(ai.stigmer.agentic.agent.v1.AgentId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the platform default agent.
     * Returns the default agent for the platform, including
     * status.default_instance_id for creating a session. Use this
     * to start a conversation without selecting an agent first.
     * Returns NOT_FOUND if no default agent is configured.
     * &#64;internal
     * Resolves the agent labeled stigmer.ai/default-agent: "true" with
     * visibility_public. Custom authorization in handler.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent getDefault(ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetDefaultMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentQueryControllerBlockingStub> {
    private AgentQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent get(ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the platform default agent.
     * Returns the default agent for the platform, including
     * status.default_instance_id for creating a session. Use this
     * to start a conversation without selecting an agent first.
     * Returns NOT_FOUND if no default agent is configured.
     * &#64;internal
     * Resolves the agent labeled stigmer.ai/default-agent: "true" with
     * visibility_public. Custom authorization in handler.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent getDefault(ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetDefaultMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentQueryControllerFutureStub> {
    private AgentQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> get(
        ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the platform default agent.
     * Returns the default agent for the platform, including
     * status.default_instance_id for creating a session. Use this
     * to start a conversation without selecting an agent first.
     * Returns NOT_FOUND if no default agent is configured.
     * &#64;internal
     * Resolves the agent labeled stigmer.ai/default-agent: "true" with
     * visibility_public. Custom authorization in handler.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> getDefault(
        ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetDefaultMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_DEFAULT = 2;

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
          serviceImpl.get((ai.stigmer.agentic.agent.v1.AgentId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_GET_DEFAULT:
          serviceImpl.getDefault((ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
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
              ai.stigmer.agentic.agent.v1.AgentId,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetDefaultMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.GetDefaultAgentRequest,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_GET_DEFAULT)))
        .build();
  }

  private static abstract class AgentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agent.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentQueryController");
    }
  }

  private static final class AgentQueryControllerFileDescriptorSupplier
      extends AgentQueryControllerBaseDescriptorSupplier {
    AgentQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentQueryControllerMethodDescriptorSupplier
      extends AgentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetDefaultMethod())
              .build();
        }
      }
    }
    return result;
  }
}
