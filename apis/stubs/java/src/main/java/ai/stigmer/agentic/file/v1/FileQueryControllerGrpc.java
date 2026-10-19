package ai.stigmer.agentic.file.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * FileQueryController handles read operations for Files.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class FileQueryControllerGrpc {

  private FileQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.file.v1.FileQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId,
      ai.stigmer.agentic.file.v1.File> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.file.v1.FileId.class,
      responseType = ai.stigmer.agentic.file.v1.File.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId,
      ai.stigmer.agentic.file.v1.File> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId, ai.stigmer.agentic.file.v1.File> getGetMethod;
    if ((getGetMethod = FileQueryControllerGrpc.getGetMethod) == null) {
      synchronized (FileQueryControllerGrpc.class) {
        if ((getGetMethod = FileQueryControllerGrpc.getGetMethod) == null) {
          FileQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.FileId, ai.stigmer.agentic.file.v1.File>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.FileId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.File.getDefaultInstance()))
              .setSchemaDescriptor(new FileQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.ListFilesRequest,
      ai.stigmer.agentic.file.v1.FileList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.file.v1.ListFilesRequest.class,
      responseType = ai.stigmer.agentic.file.v1.FileList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.ListFilesRequest,
      ai.stigmer.agentic.file.v1.FileList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.ListFilesRequest, ai.stigmer.agentic.file.v1.FileList> getListMethod;
    if ((getListMethod = FileQueryControllerGrpc.getListMethod) == null) {
      synchronized (FileQueryControllerGrpc.class) {
        if ((getListMethod = FileQueryControllerGrpc.getListMethod) == null) {
          FileQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.ListFilesRequest, ai.stigmer.agentic.file.v1.FileList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.ListFilesRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.FileList.getDefaultInstance()))
              .setSchemaDescriptor(new FileQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId,
      ai.stigmer.agentic.file.v1.FileDownloadUrl> getGetDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getDownloadUrl",
      requestType = ai.stigmer.agentic.file.v1.FileId.class,
      responseType = ai.stigmer.agentic.file.v1.FileDownloadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId,
      ai.stigmer.agentic.file.v1.FileDownloadUrl> getGetDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.FileId, ai.stigmer.agentic.file.v1.FileDownloadUrl> getGetDownloadUrlMethod;
    if ((getGetDownloadUrlMethod = FileQueryControllerGrpc.getGetDownloadUrlMethod) == null) {
      synchronized (FileQueryControllerGrpc.class) {
        if ((getGetDownloadUrlMethod = FileQueryControllerGrpc.getGetDownloadUrlMethod) == null) {
          FileQueryControllerGrpc.getGetDownloadUrlMethod = getGetDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.FileId, ai.stigmer.agentic.file.v1.FileDownloadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.FileId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.FileDownloadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new FileQueryControllerMethodDescriptorSupplier("getDownloadUrl"))
              .build();
        }
      }
    }
    return getGetDownloadUrlMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static FileQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerStub>() {
        @java.lang.Override
        public FileQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileQueryControllerStub(channel, callOptions);
        }
      };
    return FileQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static FileQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public FileQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return FileQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static FileQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerBlockingStub>() {
        @java.lang.Override
        public FileQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return FileQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static FileQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FileQueryControllerFutureStub>() {
        @java.lang.Override
        public FileQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FileQueryControllerFutureStub(channel, callOptions);
        }
      };
    return FileQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * FileQueryController handles read operations for Files.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a File by its id.
     * </pre>
     */
    default void get(ai.stigmer.agentic.file.v1.FileId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List an organization's Files, newest first: every File of the org the
     * caller may see, or with session_id only that conversation's.
     * </pre>
     */
    default void list(ai.stigmer.agentic.file.v1.ListFilesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * A link to download a File's bytes, valid for an hour. A browser
     * opening it saves the file under its filename.
     * </pre>
     */
    default void getDownloadUrl(ai.stigmer.agentic.file.v1.FileId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileDownloadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetDownloadUrlMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service FileQueryController.
   * <pre>
   * FileQueryController handles read operations for Files.
   * </pre>
   */
  public static abstract class FileQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return FileQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service FileQueryController.
   * <pre>
   * FileQueryController handles read operations for Files.
   * </pre>
   */
  public static final class FileQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<FileQueryControllerStub> {
    private FileQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a File by its id.
     * </pre>
     */
    public void get(ai.stigmer.agentic.file.v1.FileId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List an organization's Files, newest first: every File of the org the
     * caller may see, or with session_id only that conversation's.
     * </pre>
     */
    public void list(ai.stigmer.agentic.file.v1.ListFilesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * A link to download a File's bytes, valid for an hour. A browser
     * opening it saves the file under its filename.
     * </pre>
     */
    public void getDownloadUrl(ai.stigmer.agentic.file.v1.FileId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileDownloadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service FileQueryController.
   * <pre>
   * FileQueryController handles read operations for Files.
   * </pre>
   */
  public static final class FileQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<FileQueryControllerBlockingV2Stub> {
    private FileQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a File by its id.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File get(ai.stigmer.agentic.file.v1.FileId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's Files, newest first: every File of the org the
     * caller may see, or with session_id only that conversation's.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.FileList list(ai.stigmer.agentic.file.v1.ListFilesRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * A link to download a File's bytes, valid for an hour. A browser
     * opening it saves the file under its filename.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.FileDownloadUrl getDownloadUrl(ai.stigmer.agentic.file.v1.FileId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service FileQueryController.
   * <pre>
   * FileQueryController handles read operations for Files.
   * </pre>
   */
  public static final class FileQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<FileQueryControllerBlockingStub> {
    private FileQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a File by its id.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.File get(ai.stigmer.agentic.file.v1.FileId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's Files, newest first: every File of the org the
     * caller may see, or with session_id only that conversation's.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.FileList list(ai.stigmer.agentic.file.v1.ListFilesRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * A link to download a File's bytes, valid for an hour. A browser
     * opening it saves the file under its filename.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.FileDownloadUrl getDownloadUrl(ai.stigmer.agentic.file.v1.FileId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service FileQueryController.
   * <pre>
   * FileQueryController handles read operations for Files.
   * </pre>
   */
  public static final class FileQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<FileQueryControllerFutureStub> {
    private FileQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FileQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FileQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a File by its id.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.File> get(
        ai.stigmer.agentic.file.v1.FileId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List an organization's Files, newest first: every File of the org the
     * caller may see, or with session_id only that conversation's.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.FileList> list(
        ai.stigmer.agentic.file.v1.ListFilesRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * A link to download a File's bytes, valid for an hour. A browser
     * opening it saves the file under its filename.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.FileDownloadUrl> getDownloadUrl(
        ai.stigmer.agentic.file.v1.FileId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetDownloadUrlMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;
  private static final int METHODID_GET_DOWNLOAD_URL = 2;

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
          serviceImpl.get((ai.stigmer.agentic.file.v1.FileId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.File>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.file.v1.ListFilesRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileList>) responseObserver);
          break;
        case METHODID_GET_DOWNLOAD_URL:
          serviceImpl.getDownloadUrl((ai.stigmer.agentic.file.v1.FileId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.FileDownloadUrl>) responseObserver);
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
              ai.stigmer.agentic.file.v1.FileId,
              ai.stigmer.agentic.file.v1.File>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.ListFilesRequest,
              ai.stigmer.agentic.file.v1.FileList>(
                service, METHODID_LIST)))
        .addMethod(
          getGetDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.FileId,
              ai.stigmer.agentic.file.v1.FileDownloadUrl>(
                service, METHODID_GET_DOWNLOAD_URL)))
        .build();
  }

  private static abstract class FileQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    FileQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.file.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("FileQueryController");
    }
  }

  private static final class FileQueryControllerFileDescriptorSupplier
      extends FileQueryControllerBaseDescriptorSupplier {
    FileQueryControllerFileDescriptorSupplier() {}
  }

  private static final class FileQueryControllerMethodDescriptorSupplier
      extends FileQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    FileQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (FileQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new FileQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .addMethod(getGetDownloadUrlMethod())
              .build();
        }
      }
    }
    return result;
  }
}
