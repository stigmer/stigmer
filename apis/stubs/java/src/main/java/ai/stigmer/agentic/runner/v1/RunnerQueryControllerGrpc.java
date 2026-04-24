package ai.stigmer.agentic.runner.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RunnerQueryController handles read operations for runners.
 * The primary consumer is the session composer dropdown, which calls list
 * to show available runners the user can select. System-managed (ephemeral)
 * runners are excluded from the dropdown by filtering on labels.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RunnerQueryControllerGrpc {

  private RunnerQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.runner.v1.RunnerQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId,
      ai.stigmer.agentic.runner.v1.Runner> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.runner.v1.RunnerId.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId,
      ai.stigmer.agentic.runner.v1.Runner> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId, ai.stigmer.agentic.runner.v1.Runner> getGetMethod;
    if ((getGetMethod = RunnerQueryControllerGrpc.getGetMethod) == null) {
      synchronized (RunnerQueryControllerGrpc.class) {
        if ((getGetMethod = RunnerQueryControllerGrpc.getGetMethod) == null) {
          RunnerQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.RunnerId, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.runner.v1.Runner> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.runner.v1.Runner> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.runner.v1.Runner> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = RunnerQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (RunnerQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = RunnerQueryControllerGrpc.getGetByReferenceMethod) == null) {
          RunnerQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.ListRunnersRequest,
      ai.stigmer.agentic.runner.v1.RunnerList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.runner.v1.ListRunnersRequest.class,
      responseType = ai.stigmer.agentic.runner.v1.RunnerList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.ListRunnersRequest,
      ai.stigmer.agentic.runner.v1.RunnerList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.ListRunnersRequest, ai.stigmer.agentic.runner.v1.RunnerList> getListMethod;
    if ((getListMethod = RunnerQueryControllerGrpc.getListMethod) == null) {
      synchronized (RunnerQueryControllerGrpc.class) {
        if ((getListMethod = RunnerQueryControllerGrpc.getListMethod) == null) {
          RunnerQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.ListRunnersRequest, ai.stigmer.agentic.runner.v1.RunnerList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.ListRunnersRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerList.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RunnerQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerStub>() {
        @java.lang.Override
        public RunnerQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerQueryControllerStub(channel, callOptions);
        }
      };
    return RunnerQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RunnerQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public RunnerQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RunnerQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RunnerQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerBlockingStub>() {
        @java.lang.Override
        public RunnerQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return RunnerQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RunnerQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerQueryControllerFutureStub>() {
        @java.lang.Override
        public RunnerQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerQueryControllerFutureStub(channel, callOptions);
        }
      };
    return RunnerQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RunnerQueryController handles read operations for runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single runner by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.runner.v1.RunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full Runner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.runner.v1.ListRunnersRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RunnerQueryController.
   * <pre>
   * RunnerQueryController handles read operations for runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static abstract class RunnerQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RunnerQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RunnerQueryController.
   * <pre>
   * RunnerQueryController handles read operations for runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class RunnerQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RunnerQueryControllerStub> {
    private RunnerQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single runner by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.runner.v1.RunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full Runner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.runner.v1.ListRunnersRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RunnerQueryController.
   * <pre>
   * RunnerQueryController handles read operations for runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class RunnerQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RunnerQueryControllerBlockingV2Stub> {
    private RunnerQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single runner by ID.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner get(ai.stigmer.agentic.runner.v1.RunnerId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full Runner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.RunnerList list(ai.stigmer.agentic.runner.v1.ListRunnersRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RunnerQueryController.
   * <pre>
   * RunnerQueryController handles read operations for runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class RunnerQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RunnerQueryControllerBlockingStub> {
    private RunnerQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single runner by ID.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner get(ai.stigmer.agentic.runner.v1.RunnerId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full Runner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.RunnerList list(ai.stigmer.agentic.runner.v1.ListRunnersRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RunnerQueryController.
   * <pre>
   * RunnerQueryController handles read operations for runners.
   * The primary consumer is the session composer dropdown, which calls list
   * to show available runners the user can select. System-managed (ephemeral)
   * runners are excluded from the dropdown by filtering on labels.
   * </pre>
   */
  public static final class RunnerQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RunnerQueryControllerFutureStub> {
    private RunnerQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single runner by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> get(
        ai.stigmer.agentic.runner.v1.RunnerId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a runner by its organization-scoped reference (org/slug).
     * Used by the CLI to resolve a runner by name:
     *   stigmer run agent my-agent --runner my-macbook
     * resolves "my-macbook" to the full Runner resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List runners within an organization.
     * Supports label-based filtering for common use cases:
     * - Session composer: exclude system-managed runners, show only READY
     * - Admin view: show all runners including system-managed
     * - Debugging: filter by specific labels
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.RunnerList> list(
        ai.stigmer.agentic.runner.v1.ListRunnersRequest request) {
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
          serviceImpl.get((ai.stigmer.agentic.runner.v1.RunnerId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.runner.v1.ListRunnersRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerList>) responseObserver);
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
              ai.stigmer.agentic.runner.v1.RunnerId,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.ListRunnersRequest,
              ai.stigmer.agentic.runner.v1.RunnerList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class RunnerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RunnerQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.runner.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RunnerQueryController");
    }
  }

  private static final class RunnerQueryControllerFileDescriptorSupplier
      extends RunnerQueryControllerBaseDescriptorSupplier {
    RunnerQueryControllerFileDescriptorSupplier() {}
  }

  private static final class RunnerQueryControllerMethodDescriptorSupplier
      extends RunnerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RunnerQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RunnerQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RunnerQueryControllerFileDescriptorSupplier())
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
