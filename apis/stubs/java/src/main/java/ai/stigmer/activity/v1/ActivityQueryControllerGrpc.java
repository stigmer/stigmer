package ai.stigmer.activity.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ActivityQueryController provides cross-resource read queries for the
 * activity feed — the unified "recents" sidebar that merges sessions and
 * workflow executions into a single time-ordered list.
 * This service exists because the recents list spans two bounded contexts
 * (session and workflow_execution). A cross-cutting query service avoids
 * forcing the client to make two parallel calls and merge client-side.
 * &#64;internal
 * Authorization is handled in-handler: the implementation queries FGA for
 * authorized session and workflow_execution IDs, then runs a single merged
 * MongoDB query.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ActivityQueryControllerGrpc {

  private ActivityQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.activity.v1.ActivityQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.activity.v1.ListRecentActivityRequest,
      ai.stigmer.activity.v1.ListRecentActivityResponse> getListRecentActivityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listRecentActivity",
      requestType = ai.stigmer.activity.v1.ListRecentActivityRequest.class,
      responseType = ai.stigmer.activity.v1.ListRecentActivityResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.activity.v1.ListRecentActivityRequest,
      ai.stigmer.activity.v1.ListRecentActivityResponse> getListRecentActivityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.activity.v1.ListRecentActivityRequest, ai.stigmer.activity.v1.ListRecentActivityResponse> getListRecentActivityMethod;
    if ((getListRecentActivityMethod = ActivityQueryControllerGrpc.getListRecentActivityMethod) == null) {
      synchronized (ActivityQueryControllerGrpc.class) {
        if ((getListRecentActivityMethod = ActivityQueryControllerGrpc.getListRecentActivityMethod) == null) {
          ActivityQueryControllerGrpc.getListRecentActivityMethod = getListRecentActivityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.activity.v1.ListRecentActivityRequest, ai.stigmer.activity.v1.ListRecentActivityResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listRecentActivity"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.activity.v1.ListRecentActivityRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.activity.v1.ListRecentActivityResponse.getDefaultInstance()))
              .setSchemaDescriptor(new ActivityQueryControllerMethodDescriptorSupplier("listRecentActivity"))
              .build();
        }
      }
    }
    return getListRecentActivityMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ActivityQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerStub>() {
        @java.lang.Override
        public ActivityQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ActivityQueryControllerStub(channel, callOptions);
        }
      };
    return ActivityQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ActivityQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ActivityQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ActivityQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ActivityQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ActivityQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerBlockingStub>() {
        @java.lang.Override
        public ActivityQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ActivityQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ActivityQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ActivityQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ActivityQueryControllerFutureStub>() {
        @java.lang.Override
        public ActivityQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ActivityQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ActivityQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ActivityQueryController provides cross-resource read queries for the
   * activity feed — the unified "recents" sidebar that merges sessions and
   * workflow executions into a single time-ordered list.
   * This service exists because the recents list spans two bounded contexts
   * (session and workflow_execution). A cross-cutting query service avoids
   * forcing the client to make two parallel calls and merge client-side.
   * &#64;internal
   * Authorization is handled in-handler: the implementation queries FGA for
   * authorized session and workflow_execution IDs, then runs a single merged
   * MongoDB query.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * List recent activity across sessions and workflow executions.
     * Returns a merged, time-sorted list of the caller's most recent
     * sessions and workflow executions. Authorization filtering is applied
     * server-side via FGA (cloud) or returned unfiltered (OSS).
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    default void listRecentActivity(ai.stigmer.activity.v1.ListRecentActivityRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.activity.v1.ListRecentActivityResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListRecentActivityMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ActivityQueryController.
   * <pre>
   * ActivityQueryController provides cross-resource read queries for the
   * activity feed — the unified "recents" sidebar that merges sessions and
   * workflow executions into a single time-ordered list.
   * This service exists because the recents list spans two bounded contexts
   * (session and workflow_execution). A cross-cutting query service avoids
   * forcing the client to make two parallel calls and merge client-side.
   * &#64;internal
   * Authorization is handled in-handler: the implementation queries FGA for
   * authorized session and workflow_execution IDs, then runs a single merged
   * MongoDB query.
   * </pre>
   */
  public static abstract class ActivityQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ActivityQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ActivityQueryController.
   * <pre>
   * ActivityQueryController provides cross-resource read queries for the
   * activity feed — the unified "recents" sidebar that merges sessions and
   * workflow executions into a single time-ordered list.
   * This service exists because the recents list spans two bounded contexts
   * (session and workflow_execution). A cross-cutting query service avoids
   * forcing the client to make two parallel calls and merge client-side.
   * &#64;internal
   * Authorization is handled in-handler: the implementation queries FGA for
   * authorized session and workflow_execution IDs, then runs a single merged
   * MongoDB query.
   * </pre>
   */
  public static final class ActivityQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ActivityQueryControllerStub> {
    private ActivityQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ActivityQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ActivityQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * List recent activity across sessions and workflow executions.
     * Returns a merged, time-sorted list of the caller's most recent
     * sessions and workflow executions. Authorization filtering is applied
     * server-side via FGA (cloud) or returned unfiltered (OSS).
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public void listRecentActivity(ai.stigmer.activity.v1.ListRecentActivityRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.activity.v1.ListRecentActivityResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListRecentActivityMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ActivityQueryController.
   * <pre>
   * ActivityQueryController provides cross-resource read queries for the
   * activity feed — the unified "recents" sidebar that merges sessions and
   * workflow executions into a single time-ordered list.
   * This service exists because the recents list spans two bounded contexts
   * (session and workflow_execution). A cross-cutting query service avoids
   * forcing the client to make two parallel calls and merge client-side.
   * &#64;internal
   * Authorization is handled in-handler: the implementation queries FGA for
   * authorized session and workflow_execution IDs, then runs a single merged
   * MongoDB query.
   * </pre>
   */
  public static final class ActivityQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ActivityQueryControllerBlockingV2Stub> {
    private ActivityQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ActivityQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ActivityQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * List recent activity across sessions and workflow executions.
     * Returns a merged, time-sorted list of the caller's most recent
     * sessions and workflow executions. Authorization filtering is applied
     * server-side via FGA (cloud) or returned unfiltered (OSS).
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public ai.stigmer.activity.v1.ListRecentActivityResponse listRecentActivity(ai.stigmer.activity.v1.ListRecentActivityRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListRecentActivityMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ActivityQueryController.
   * <pre>
   * ActivityQueryController provides cross-resource read queries for the
   * activity feed — the unified "recents" sidebar that merges sessions and
   * workflow executions into a single time-ordered list.
   * This service exists because the recents list spans two bounded contexts
   * (session and workflow_execution). A cross-cutting query service avoids
   * forcing the client to make two parallel calls and merge client-side.
   * &#64;internal
   * Authorization is handled in-handler: the implementation queries FGA for
   * authorized session and workflow_execution IDs, then runs a single merged
   * MongoDB query.
   * </pre>
   */
  public static final class ActivityQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ActivityQueryControllerBlockingStub> {
    private ActivityQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ActivityQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ActivityQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * List recent activity across sessions and workflow executions.
     * Returns a merged, time-sorted list of the caller's most recent
     * sessions and workflow executions. Authorization filtering is applied
     * server-side via FGA (cloud) or returned unfiltered (OSS).
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public ai.stigmer.activity.v1.ListRecentActivityResponse listRecentActivity(ai.stigmer.activity.v1.ListRecentActivityRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListRecentActivityMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ActivityQueryController.
   * <pre>
   * ActivityQueryController provides cross-resource read queries for the
   * activity feed — the unified "recents" sidebar that merges sessions and
   * workflow executions into a single time-ordered list.
   * This service exists because the recents list spans two bounded contexts
   * (session and workflow_execution). A cross-cutting query service avoids
   * forcing the client to make two parallel calls and merge client-side.
   * &#64;internal
   * Authorization is handled in-handler: the implementation queries FGA for
   * authorized session and workflow_execution IDs, then runs a single merged
   * MongoDB query.
   * </pre>
   */
  public static final class ActivityQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ActivityQueryControllerFutureStub> {
    private ActivityQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ActivityQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ActivityQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * List recent activity across sessions and workflow executions.
     * Returns a merged, time-sorted list of the caller's most recent
     * sessions and workflow executions. Authorization filtering is applied
     * server-side via FGA (cloud) or returned unfiltered (OSS).
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.activity.v1.ListRecentActivityResponse> listRecentActivity(
        ai.stigmer.activity.v1.ListRecentActivityRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListRecentActivityMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_LIST_RECENT_ACTIVITY = 0;

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
        case METHODID_LIST_RECENT_ACTIVITY:
          serviceImpl.listRecentActivity((ai.stigmer.activity.v1.ListRecentActivityRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.activity.v1.ListRecentActivityResponse>) responseObserver);
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
          getListRecentActivityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.activity.v1.ListRecentActivityRequest,
              ai.stigmer.activity.v1.ListRecentActivityResponse>(
                service, METHODID_LIST_RECENT_ACTIVITY)))
        .build();
  }

  private static abstract class ActivityQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ActivityQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.activity.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ActivityQueryController");
    }
  }

  private static final class ActivityQueryControllerFileDescriptorSupplier
      extends ActivityQueryControllerBaseDescriptorSupplier {
    ActivityQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ActivityQueryControllerMethodDescriptorSupplier
      extends ActivityQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ActivityQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ActivityQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ActivityQueryControllerFileDescriptorSupplier())
              .addMethod(getListRecentActivityMethod())
              .build();
        }
      }
    }
    return result;
  }
}
