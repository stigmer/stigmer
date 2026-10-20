package ai.stigmer.agentic.file.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RunFileController is a runner's one door to Files: it hands a turn the
 * Files its conversation holds, and takes back the files the agent saved in
 * its outputs folder as Files of that conversation. Every link it answers is
 * short-lived and minted by the server; nothing else answers a File's bytes
 * to a runner or takes a runner's file.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RunFileControllerGrpc {

  private RunFileControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.file.v1.RunFileController";

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
    if ((getMountMethod = RunFileControllerGrpc.getMountMethod) == null) {
      synchronized (RunFileControllerGrpc.class) {
        if ((getMountMethod = RunFileControllerGrpc.getMountMethod) == null) {
          RunFileControllerGrpc.getMountMethod = getMountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.MountRunFilesInput, ai.stigmer.agentic.file.v1.RunFileMounts>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "mount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.MountRunFilesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.RunFileMounts.getDefaultInstance()))
              .setSchemaDescriptor(new RunFileControllerMethodDescriptorSupplier("mount"))
              .build();
        }
      }
    }
    return getMountMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.CreateOutputUploadsInput,
      ai.stigmer.agentic.file.v1.OutputUploads> getCreateOutputUploadsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createOutputUploads",
      requestType = ai.stigmer.agentic.file.v1.CreateOutputUploadsInput.class,
      responseType = ai.stigmer.agentic.file.v1.OutputUploads.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.CreateOutputUploadsInput,
      ai.stigmer.agentic.file.v1.OutputUploads> getCreateOutputUploadsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.CreateOutputUploadsInput, ai.stigmer.agentic.file.v1.OutputUploads> getCreateOutputUploadsMethod;
    if ((getCreateOutputUploadsMethod = RunFileControllerGrpc.getCreateOutputUploadsMethod) == null) {
      synchronized (RunFileControllerGrpc.class) {
        if ((getCreateOutputUploadsMethod = RunFileControllerGrpc.getCreateOutputUploadsMethod) == null) {
          RunFileControllerGrpc.getCreateOutputUploadsMethod = getCreateOutputUploadsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.CreateOutputUploadsInput, ai.stigmer.agentic.file.v1.OutputUploads>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createOutputUploads"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.CreateOutputUploadsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.OutputUploads.getDefaultInstance()))
              .setSchemaDescriptor(new RunFileControllerMethodDescriptorSupplier("createOutputUploads"))
              .build();
        }
      }
    }
    return getCreateOutputUploadsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.RegisterOutputsInput,
      ai.stigmer.agentic.file.v1.RegisteredOutputs> getRegisterOutputsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "registerOutputs",
      requestType = ai.stigmer.agentic.file.v1.RegisterOutputsInput.class,
      responseType = ai.stigmer.agentic.file.v1.RegisteredOutputs.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.RegisterOutputsInput,
      ai.stigmer.agentic.file.v1.RegisteredOutputs> getRegisterOutputsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.file.v1.RegisterOutputsInput, ai.stigmer.agentic.file.v1.RegisteredOutputs> getRegisterOutputsMethod;
    if ((getRegisterOutputsMethod = RunFileControllerGrpc.getRegisterOutputsMethod) == null) {
      synchronized (RunFileControllerGrpc.class) {
        if ((getRegisterOutputsMethod = RunFileControllerGrpc.getRegisterOutputsMethod) == null) {
          RunFileControllerGrpc.getRegisterOutputsMethod = getRegisterOutputsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.file.v1.RegisterOutputsInput, ai.stigmer.agentic.file.v1.RegisteredOutputs>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "registerOutputs"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.RegisterOutputsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.file.v1.RegisteredOutputs.getDefaultInstance()))
              .setSchemaDescriptor(new RunFileControllerMethodDescriptorSupplier("registerOutputs"))
              .build();
        }
      }
    }
    return getRegisterOutputsMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RunFileControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunFileControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunFileControllerStub>() {
        @java.lang.Override
        public RunFileControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunFileControllerStub(channel, callOptions);
        }
      };
    return RunFileControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RunFileControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunFileControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunFileControllerBlockingV2Stub>() {
        @java.lang.Override
        public RunFileControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunFileControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RunFileControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RunFileControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunFileControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunFileControllerBlockingStub>() {
        @java.lang.Override
        public RunFileControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunFileControllerBlockingStub(channel, callOptions);
        }
      };
    return RunFileControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RunFileControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunFileControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunFileControllerFutureStub>() {
        @java.lang.Override
        public RunFileControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunFileControllerFutureStub(channel, callOptions);
        }
      };
    return RunFileControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RunFileController is a runner's one door to Files: it hands a turn the
   * Files its conversation holds, and takes back the files the agent saved in
   * its outputs folder as Files of that conversation. Every link it answers is
   * short-lived and minted by the server; nothing else answers a File's bytes
   * to a runner or takes a runner's file.
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

    /**
     * <pre>
     * One upload link per file the turn saved in .stigmer/outputs/ and
     * changed since it was last returned, each valid for an hour. The runner
     * puts each file's bytes to its link, then registers them.
     * </pre>
     */
    default void createOutputUploads(ai.stigmer.agentic.file.v1.CreateOutputUploadsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.OutputUploads> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateOutputUploadsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Makes each uploaded output a File of the run's conversation: written by
     * the run, owned by the person who started it, named by its filename,
     * with where it was saved in output_path.
     * </pre>
     */
    default void registerOutputs(ai.stigmer.agentic.file.v1.RegisterOutputsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.RegisteredOutputs> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRegisterOutputsMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RunFileController.
   * <pre>
   * RunFileController is a runner's one door to Files: it hands a turn the
   * Files its conversation holds, and takes back the files the agent saved in
   * its outputs folder as Files of that conversation. Every link it answers is
   * short-lived and minted by the server; nothing else answers a File's bytes
   * to a runner or takes a runner's file.
   * </pre>
   */
  public static abstract class RunFileControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RunFileControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RunFileController.
   * <pre>
   * RunFileController is a runner's one door to Files: it hands a turn the
   * Files its conversation holds, and takes back the files the agent saved in
   * its outputs folder as Files of that conversation. Every link it answers is
   * short-lived and minted by the server; nothing else answers a File's bytes
   * to a runner or takes a runner's file.
   * </pre>
   */
  public static final class RunFileControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RunFileControllerStub> {
    private RunFileControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunFileControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunFileControllerStub(channel, callOptions);
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

    /**
     * <pre>
     * One upload link per file the turn saved in .stigmer/outputs/ and
     * changed since it was last returned, each valid for an hour. The runner
     * puts each file's bytes to its link, then registers them.
     * </pre>
     */
    public void createOutputUploads(ai.stigmer.agentic.file.v1.CreateOutputUploadsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.OutputUploads> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateOutputUploadsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Makes each uploaded output a File of the run's conversation: written by
     * the run, owned by the person who started it, named by its filename,
     * with where it was saved in output_path.
     * </pre>
     */
    public void registerOutputs(ai.stigmer.agentic.file.v1.RegisterOutputsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.RegisteredOutputs> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRegisterOutputsMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RunFileController.
   * <pre>
   * RunFileController is a runner's one door to Files: it hands a turn the
   * Files its conversation holds, and takes back the files the agent saved in
   * its outputs folder as Files of that conversation. Every link it answers is
   * short-lived and minted by the server; nothing else answers a File's bytes
   * to a runner or takes a runner's file.
   * </pre>
   */
  public static final class RunFileControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RunFileControllerBlockingV2Stub> {
    private RunFileControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunFileControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunFileControllerBlockingV2Stub(channel, callOptions);
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

    /**
     * <pre>
     * One upload link per file the turn saved in .stigmer/outputs/ and
     * changed since it was last returned, each valid for an hour. The runner
     * puts each file's bytes to its link, then registers them.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.OutputUploads createOutputUploads(ai.stigmer.agentic.file.v1.CreateOutputUploadsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateOutputUploadsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Makes each uploaded output a File of the run's conversation: written by
     * the run, owned by the person who started it, named by its filename,
     * with where it was saved in output_path.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.RegisteredOutputs registerOutputs(ai.stigmer.agentic.file.v1.RegisterOutputsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRegisterOutputsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RunFileController.
   * <pre>
   * RunFileController is a runner's one door to Files: it hands a turn the
   * Files its conversation holds, and takes back the files the agent saved in
   * its outputs folder as Files of that conversation. Every link it answers is
   * short-lived and minted by the server; nothing else answers a File's bytes
   * to a runner or takes a runner's file.
   * </pre>
   */
  public static final class RunFileControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RunFileControllerBlockingStub> {
    private RunFileControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunFileControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunFileControllerBlockingStub(channel, callOptions);
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

    /**
     * <pre>
     * One upload link per file the turn saved in .stigmer/outputs/ and
     * changed since it was last returned, each valid for an hour. The runner
     * puts each file's bytes to its link, then registers them.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.OutputUploads createOutputUploads(ai.stigmer.agentic.file.v1.CreateOutputUploadsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateOutputUploadsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Makes each uploaded output a File of the run's conversation: written by
     * the run, owned by the person who started it, named by its filename,
     * with where it was saved in output_path.
     * </pre>
     */
    public ai.stigmer.agentic.file.v1.RegisteredOutputs registerOutputs(ai.stigmer.agentic.file.v1.RegisterOutputsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRegisterOutputsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RunFileController.
   * <pre>
   * RunFileController is a runner's one door to Files: it hands a turn the
   * Files its conversation holds, and takes back the files the agent saved in
   * its outputs folder as Files of that conversation. Every link it answers is
   * short-lived and minted by the server; nothing else answers a File's bytes
   * to a runner or takes a runner's file.
   * </pre>
   */
  public static final class RunFileControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RunFileControllerFutureStub> {
    private RunFileControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunFileControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunFileControllerFutureStub(channel, callOptions);
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

    /**
     * <pre>
     * One upload link per file the turn saved in .stigmer/outputs/ and
     * changed since it was last returned, each valid for an hour. The runner
     * puts each file's bytes to its link, then registers them.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.OutputUploads> createOutputUploads(
        ai.stigmer.agentic.file.v1.CreateOutputUploadsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateOutputUploadsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Makes each uploaded output a File of the run's conversation: written by
     * the run, owned by the person who started it, named by its filename,
     * with where it was saved in output_path.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.file.v1.RegisteredOutputs> registerOutputs(
        ai.stigmer.agentic.file.v1.RegisterOutputsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRegisterOutputsMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_MOUNT = 0;
  private static final int METHODID_CREATE_OUTPUT_UPLOADS = 1;
  private static final int METHODID_REGISTER_OUTPUTS = 2;

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
        case METHODID_CREATE_OUTPUT_UPLOADS:
          serviceImpl.createOutputUploads((ai.stigmer.agentic.file.v1.CreateOutputUploadsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.OutputUploads>) responseObserver);
          break;
        case METHODID_REGISTER_OUTPUTS:
          serviceImpl.registerOutputs((ai.stigmer.agentic.file.v1.RegisterOutputsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.file.v1.RegisteredOutputs>) responseObserver);
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
        .addMethod(
          getCreateOutputUploadsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.CreateOutputUploadsInput,
              ai.stigmer.agentic.file.v1.OutputUploads>(
                service, METHODID_CREATE_OUTPUT_UPLOADS)))
        .addMethod(
          getRegisterOutputsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.file.v1.RegisterOutputsInput,
              ai.stigmer.agentic.file.v1.RegisteredOutputs>(
                service, METHODID_REGISTER_OUTPUTS)))
        .build();
  }

  private static abstract class RunFileControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RunFileControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.file.v1.RunFilesProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RunFileController");
    }
  }

  private static final class RunFileControllerFileDescriptorSupplier
      extends RunFileControllerBaseDescriptorSupplier {
    RunFileControllerFileDescriptorSupplier() {}
  }

  private static final class RunFileControllerMethodDescriptorSupplier
      extends RunFileControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RunFileControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RunFileControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RunFileControllerFileDescriptorSupplier())
              .addMethod(getMountMethod())
              .addMethod(getCreateOutputUploadsMethod())
              .addMethod(getRegisterOutputsMethod())
              .build();
        }
      }
    }
    return result;
  }
}
