package ai.stigmer.agentic.file.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * FileMountController hands a runner the Files one turn's conversation
 * holds, each with a short-lived link to its bytes. Nothing else answers a
 * File's bytes to a runner.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class FileMountControllerGrpc {

  private FileMountControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.file.v1.FileMountController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.MountRunFilesInput,
      ai.stigmer.agentic.file.v1.RunFileMounts> getMountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "mount",
      requestType = ai.stigmer.agentic.file.v1.MountRunFilesInput.class,
      responseType = ai.stigmer.agentic.file.v1.RunFileMounts.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.MountRunFilesInput,
      ai.stigmer.agentic.file.v1.RunFileMounts> getMountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.MountRunFilesInput, ai.stigmer.agentic.file.v1.RunFileMounts> getMountMethod;
    if ((getMountMethod = FileMountControllerGrpc.getMountMethod) == null) {
      synchronized (FileMountControllerGrpc.class) {
        if ((getMountMethod = FileMountControllerGrpc.getMountMethod) == null) {
          FileMountControllerGrpc.getMountMethod = getMountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.MountRunFilesInput, ai.stigmer.agentic.file.v1.RunFileMounts>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "mount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.MountRunFilesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.RunFileMounts.getDefaultInstance()))
              .setSchemaDescriptor(new FileMountControllerMethodDescriptorSupplier("mount"))
              .build();
        }
      }
    }
    return getMountMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static FileMountControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileMountControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileMountControllerStub>() {
        @java.lang.Override
        public FileMountControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileMountControllerStub(channel, callOptions);
        }
      };
    return FileMountControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static FileMountControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileMountControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileMountControllerBlockingV2Stub>() {
        @java.lang.Override
        public FileMountControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileMountControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return FileMountControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static FileMountControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileMountControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileMountControllerBlockingStub>() {
        @java.lang.Override
        public FileMountControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileMountControllerBlockingStub(channel, callOptions);
        }
      };
    return FileMountControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static FileMountControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileMountControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileMountControllerFutureStub>() {
        @java.lang.Override
        public FileMountControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileMountControllerFutureStub(channel, callOptions);
        }
      };
    return FileMountControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * FileMountController hands a runner the Files one turn's conversation
   * holds, each with a short-lived link to its bytes. Nothing else answers a
   * File's bytes to a runner.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * The Files a run's conversation holds (SessionSpec.resources), each with
     * where the agent finds it under .stigmer/uploads/ and a link to its
     * bytes, valid for an hour.
     * </pre>
     */
    default void mount(ai.stigmer.agentic.file.v1.MountRunFilesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.RunFileMounts> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getMountMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service FileMountController.
   * <pre>
   * FileMountController hands a runner the Files one turn's conversation
   * holds, each with a short-lived link to its bytes. Nothing else answers a
   * File's bytes to a runner.
   * </pre>
   */
  public static abstract class FileMountControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return FileMountControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service FileMountController.
   * <pre>
   * FileMountController hands a runner the Files one turn's conversation
   * holds, each with a short-lived link to its bytes. Nothing else answers a
   * File's bytes to a runner.
   * </pre>
   */
  public static final class FileMountControllerStub
      extends io.grpc.stub.AbstractAsyncStub<FileMountControllerStub> {
    private FileMountControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileMountControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileMountControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * The Files a run's conversation holds (SessionSpec.resources), each with
     * where the agent finds it under .stigmer/uploads/ and a link to its
     * bytes, valid for an hour.
     * </pre>
     */
    public void mount(ai.stigmer.agentic.file.v1.MountRunFilesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.RunFileMounts> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getMountMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service FileMountController.
   * <pre>
   * FileMountController hands a runner the Files one turn's conversation
   * holds, each with a short-lived link to its bytes. Nothing else answers a
   * File's bytes to a runner.
   * </pre>
   */
  public static final class FileMountControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<FileMountControllerBlockingV2Stub> {
    private FileMountControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileMountControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileMountControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * The Files a run's conversation holds (SessionSpec.resources), each with
     * where the agent finds it under .stigmer/uploads/ and a link to its
     * bytes, valid for an hour.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.RunFileMounts mount(ai.stigmer.agentic.file.v1.MountRunFilesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getMountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service FileMountController.
   * <pre>
   * FileMountController hands a runner the Files one turn's conversation
   * holds, each with a short-lived link to its bytes. Nothing else answers a
   * File's bytes to a runner.
   * </pre>
   */
  public static final class FileMountControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<FileMountControllerBlockingStub> {
    private FileMountControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileMountControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileMountControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * The Files a run's conversation holds (SessionSpec.resources), each with
     * where the agent finds it under .stigmer/uploads/ and a link to its
     * bytes, valid for an hour.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.RunFileMounts mount(ai.stigmer.agentic.file.v1.MountRunFilesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getMountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service FileMountController.
   * <pre>
   * FileMountController hands a runner the Files one turn's conversation
   * holds, each with a short-lived link to its bytes. Nothing else answers a
   * File's bytes to a runner.
   * </pre>
   */
  public static final class FileMountControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<FileMountControllerFutureStub> {
    private FileMountControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileMountControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileMountControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * The Files a run's conversation holds (SessionSpec.resources), each with
     * where the agent finds it under .stigmer/uploads/ and a link to its
     * bytes, valid for an hour.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.RunFileMounts> mount(
        ai.stigmer.agentic.file.v1.MountRunFilesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getMountMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_MOUNT = 0;

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
        case METHODID_MOUNT:
          serviceImpl.mount((ai.stigmer.agentic.file.v1.MountRunFilesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.RunFileMounts>) responseObserver);
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
          getMountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.MountRunFilesInput,
              ai.stigmer.agentic.file.v1.RunFileMounts>(
                service, METHODID_MOUNT)))
        .build();
  }

  private static abstract class FileMountControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    FileMountControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.file.v1.MountProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("FileMountController");
    }
  }

  private static final class FileMountControllerFileDescriptorSupplier
      extends FileMountControllerBaseDescriptorSupplier {
    FileMountControllerFileDescriptorSupplier() {}
  }

  private static final class FileMountControllerMethodDescriptorSupplier
      extends FileMountControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    FileMountControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (FileMountControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new FileMountControllerFileDescriptorSupplier())
              .addMethod(getMountMethod())
              .build();
        }
      }
    }
    return result;
  }
}
