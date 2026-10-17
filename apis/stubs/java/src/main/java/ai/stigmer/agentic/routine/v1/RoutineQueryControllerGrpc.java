package ai.stigmer.agentic.routine.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RoutineQueryController handles read operations for routines.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RoutineQueryControllerGrpc {

  private RoutineQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.routine.v1.RoutineQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId,
      ai.stigmer.agentic.routine.v1.Routine> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.routine.v1.RoutineId.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId,
      ai.stigmer.agentic.routine.v1.Routine> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId, ai.stigmer.agentic.routine.v1.Routine> getGetMethod;
    if ((getGetMethod = RoutineQueryControllerGrpc.getGetMethod) == null) {
      synchronized (RoutineQueryControllerGrpc.class) {
        if ((getGetMethod = RoutineQueryControllerGrpc.getGetMethod) == null) {
          RoutineQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.RoutineId, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.RoutineId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.routine.v1.Routine> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.routine.v1.Routine> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.routine.v1.Routine> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = RoutineQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (RoutineQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = RoutineQueryControllerGrpc.getGetByReferenceMethod) == null) {
          RoutineQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest,
      ai.stigmer.agentic.routine.v1.RoutineList> getListByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByAgent",
      requestType = ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest.class,
      responseType = ai.stigmer.agentic.routine.v1.RoutineList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest,
      ai.stigmer.agentic.routine.v1.RoutineList> getListByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest, ai.stigmer.agentic.routine.v1.RoutineList> getListByAgentMethod;
    if ((getListByAgentMethod = RoutineQueryControllerGrpc.getListByAgentMethod) == null) {
      synchronized (RoutineQueryControllerGrpc.class) {
        if ((getListByAgentMethod = RoutineQueryControllerGrpc.getListByAgentMethod) == null) {
          RoutineQueryControllerGrpc.getListByAgentMethod = getListByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest, ai.stigmer.agentic.routine.v1.RoutineList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.RoutineList.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineQueryControllerMethodDescriptorSupplier("listByAgent"))
              .build();
        }
      }
    }
    return getListByAgentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutinesRequest,
      ai.stigmer.agentic.routine.v1.RoutineList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.routine.v1.ListRoutinesRequest.class,
      responseType = ai.stigmer.agentic.routine.v1.RoutineList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutinesRequest,
      ai.stigmer.agentic.routine.v1.RoutineList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutinesRequest, ai.stigmer.agentic.routine.v1.RoutineList> getListMethod;
    if ((getListMethod = RoutineQueryControllerGrpc.getListMethod) == null) {
      synchronized (RoutineQueryControllerGrpc.class) {
        if ((getListMethod = RoutineQueryControllerGrpc.getListMethod) == null) {
          RoutineQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.ListRoutinesRequest, ai.stigmer.agentic.routine.v1.RoutineList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.ListRoutinesRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.RoutineList.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest,
      ai.stigmer.agentic.routine.v1.RoutineFireList> getListFiresMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listFires",
      requestType = ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest.class,
      responseType = ai.stigmer.agentic.routine.v1.RoutineFireList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest,
      ai.stigmer.agentic.routine.v1.RoutineFireList> getListFiresMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest, ai.stigmer.agentic.routine.v1.RoutineFireList> getListFiresMethod;
    if ((getListFiresMethod = RoutineQueryControllerGrpc.getListFiresMethod) == null) {
      synchronized (RoutineQueryControllerGrpc.class) {
        if ((getListFiresMethod = RoutineQueryControllerGrpc.getListFiresMethod) == null) {
          RoutineQueryControllerGrpc.getListFiresMethod = getListFiresMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest, ai.stigmer.agentic.routine.v1.RoutineFireList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listFires"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.RoutineFireList.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineQueryControllerMethodDescriptorSupplier("listFires"))
              .build();
        }
      }
    }
    return getListFiresMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RoutineQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerStub>() {
        @java.lang.Override
        public RoutineQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineQueryControllerStub(channel, callOptions);
        }
      };
    return RoutineQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RoutineQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public RoutineQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RoutineQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RoutineQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerBlockingStub>() {
        @java.lang.Override
        public RoutineQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return RoutineQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RoutineQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineQueryControllerFutureStub>() {
        @java.lang.Override
        public RoutineQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineQueryControllerFutureStub(channel, callOptions);
        }
      };
    return RoutineQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RoutineQueryController handles read operations for routines.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single routine by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.routine.v1.RoutineId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a routine by its organization-scoped reference (org/slug).
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the routines of a specific agent, newest first.
     * Returns only routines the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing routines regardless of slug.
     * </pre>
     */
    default void listByAgent(ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByAgentMethod(), responseObserver);
    }

    /**
     * <pre>
     * List routines with optional label filtering.
     * </pre>
     */
    default void list(ai.stigmer.agentic.routine.v1.ListRoutinesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List a routine's fire history, newest first.
     * Every fire leaves a row — including fires that created no run
     * (a refused launch gate, a missing target agent) — with the refusing
     * gate's copy verbatim. This is the surface that explains
     * status.consecutive_failures.
     * </pre>
     */
    default void listFires(ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineFireList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListFiresMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RoutineQueryController.
   * <pre>
   * RoutineQueryController handles read operations for routines.
   * </pre>
   */
  public static abstract class RoutineQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RoutineQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RoutineQueryController.
   * <pre>
   * RoutineQueryController handles read operations for routines.
   * </pre>
   */
  public static final class RoutineQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RoutineQueryControllerStub> {
    private RoutineQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single routine by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.routine.v1.RoutineId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a routine by its organization-scoped reference (org/slug).
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the routines of a specific agent, newest first.
     * Returns only routines the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing routines regardless of slug.
     * </pre>
     */
    public void listByAgent(ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List routines with optional label filtering.
     * </pre>
     */
    public void list(ai.stigmer.agentic.routine.v1.ListRoutinesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List a routine's fire history, newest first.
     * Every fire leaves a row — including fires that created no run
     * (a refused launch gate, a missing target agent) — with the refusing
     * gate's copy verbatim. This is the surface that explains
     * status.consecutive_failures.
     * </pre>
     */
    public void listFires(ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineFireList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListFiresMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RoutineQueryController.
   * <pre>
   * RoutineQueryController handles read operations for routines.
   * </pre>
   */
  public static final class RoutineQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RoutineQueryControllerBlockingV2Stub> {
    private RoutineQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single routine by ID.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine get(ai.stigmer.agentic.routine.v1.RoutineId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a routine by its organization-scoped reference (org/slug).
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the routines of a specific agent, newest first.
     * Returns only routines the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing routines regardless of slug.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineList listByAgent(ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List routines with optional label filtering.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineList list(ai.stigmer.agentic.routine.v1.ListRoutinesRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a routine's fire history, newest first.
     * Every fire leaves a row — including fires that created no run
     * (a refused launch gate, a missing target agent) — with the refusing
     * gate's copy verbatim. This is the surface that explains
     * status.consecutive_failures.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineFireList listFires(ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListFiresMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RoutineQueryController.
   * <pre>
   * RoutineQueryController handles read operations for routines.
   * </pre>
   */
  public static final class RoutineQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RoutineQueryControllerBlockingStub> {
    private RoutineQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single routine by ID.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine get(ai.stigmer.agentic.routine.v1.RoutineId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a routine by its organization-scoped reference (org/slug).
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the routines of a specific agent, newest first.
     * Returns only routines the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing routines regardless of slug.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineList listByAgent(ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List routines with optional label filtering.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineList list(ai.stigmer.agentic.routine.v1.ListRoutinesRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a routine's fire history, newest first.
     * Every fire leaves a row — including fires that created no run
     * (a refused launch gate, a missing target agent) — with the refusing
     * gate's copy verbatim. This is the surface that explains
     * status.consecutive_failures.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineFireList listFires(ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListFiresMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RoutineQueryController.
   * <pre>
   * RoutineQueryController handles read operations for routines.
   * </pre>
   */
  public static final class RoutineQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RoutineQueryControllerFutureStub> {
    private RoutineQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single routine by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> get(
        ai.stigmer.agentic.routine.v1.RoutineId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a routine by its organization-scoped reference (org/slug).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the routines of a specific agent, newest first.
     * Returns only routines the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing routines regardless of slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.RoutineList> listByAgent(
        ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByAgentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List routines with optional label filtering.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.RoutineList> list(
        ai.stigmer.agentic.routine.v1.ListRoutinesRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List a routine's fire history, newest first.
     * Every fire leaves a row — including fires that created no run
     * (a refused launch gate, a missing target agent) — with the refusing
     * gate's copy verbatim. This is the surface that explains
     * status.consecutive_failures.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.RoutineFireList> listFires(
        ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListFiresMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_BY_AGENT = 2;
  private static final int METHODID_LIST = 3;
  private static final int METHODID_LIST_FIRES = 4;

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
          serviceImpl.get((ai.stigmer.agentic.routine.v1.RoutineId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_LIST_BY_AGENT:
          serviceImpl.listByAgent((ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineList>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.routine.v1.ListRoutinesRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineList>) responseObserver);
          break;
        case METHODID_LIST_FIRES:
          serviceImpl.listFires((ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineFireList>) responseObserver);
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
              ai.stigmer.agentic.routine.v1.RoutineId,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.ListRoutinesByAgentRequest,
              ai.stigmer.agentic.routine.v1.RoutineList>(
                service, METHODID_LIST_BY_AGENT)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.ListRoutinesRequest,
              ai.stigmer.agentic.routine.v1.RoutineList>(
                service, METHODID_LIST)))
        .addMethod(
          getListFiresMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.ListRoutineFiresRequest,
              ai.stigmer.agentic.routine.v1.RoutineFireList>(
                service, METHODID_LIST_FIRES)))
        .build();
  }

  private static abstract class RoutineQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RoutineQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.routine.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RoutineQueryController");
    }
  }

  private static final class RoutineQueryControllerFileDescriptorSupplier
      extends RoutineQueryControllerBaseDescriptorSupplier {
    RoutineQueryControllerFileDescriptorSupplier() {}
  }

  private static final class RoutineQueryControllerMethodDescriptorSupplier
      extends RoutineQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RoutineQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RoutineQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RoutineQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListByAgentMethod())
              .addMethod(getListMethod())
              .addMethod(getListFiresMethod())
              .build();
        }
      }
    }
    return result;
  }
}
