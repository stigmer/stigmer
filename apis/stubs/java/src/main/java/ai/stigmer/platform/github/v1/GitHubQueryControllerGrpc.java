package ai.stigmer.platform.github.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * GitHubQueryController reads GitHub repositories with the caller's saved
 * github.com login, so no page holds the token.
 * Each RPC uses the github.com connection in the caller's My vault in the
 * named organization, and answers FAILED_PRECONDITION when there is none.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class GitHubQueryControllerGrpc {

  private GitHubQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.platform.github.v1.GitHubQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput,
      ai.stigmer.platform.github.v1.GitHubRepositoryList> getListRepositoriesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listRepositories",
      requestType = ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput.class,
      responseType = ai.stigmer.platform.github.v1.GitHubRepositoryList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput,
      ai.stigmer.platform.github.v1.GitHubRepositoryList> getListRepositoriesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput, ai.stigmer.platform.github.v1.GitHubRepositoryList> getListRepositoriesMethod;
    if ((getListRepositoriesMethod = GitHubQueryControllerGrpc.getListRepositoriesMethod) == null) {
      synchronized (GitHubQueryControllerGrpc.class) {
        if ((getListRepositoriesMethod = GitHubQueryControllerGrpc.getListRepositoriesMethod) == null) {
          GitHubQueryControllerGrpc.getListRepositoriesMethod = getListRepositoriesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput, ai.stigmer.platform.github.v1.GitHubRepositoryList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listRepositories"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GitHubRepositoryList.getDefaultInstance()))
              .setSchemaDescriptor(new GitHubQueryControllerMethodDescriptorSupplier("listRepositories"))
              .build();
        }
      }
    }
    return getListRepositoriesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput,
      ai.stigmer.platform.github.v1.GitHubRepositoryList> getSearchRepositoriesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "searchRepositories",
      requestType = ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput.class,
      responseType = ai.stigmer.platform.github.v1.GitHubRepositoryList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput,
      ai.stigmer.platform.github.v1.GitHubRepositoryList> getSearchRepositoriesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput, ai.stigmer.platform.github.v1.GitHubRepositoryList> getSearchRepositoriesMethod;
    if ((getSearchRepositoriesMethod = GitHubQueryControllerGrpc.getSearchRepositoriesMethod) == null) {
      synchronized (GitHubQueryControllerGrpc.class) {
        if ((getSearchRepositoriesMethod = GitHubQueryControllerGrpc.getSearchRepositoriesMethod) == null) {
          GitHubQueryControllerGrpc.getSearchRepositoriesMethod = getSearchRepositoriesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput, ai.stigmer.platform.github.v1.GitHubRepositoryList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "searchRepositories"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GitHubRepositoryList.getDefaultInstance()))
              .setSchemaDescriptor(new GitHubQueryControllerMethodDescriptorSupplier("searchRepositories"))
              .build();
        }
      }
    }
    return getSearchRepositoriesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ListGitHubBranchesInput,
      ai.stigmer.platform.github.v1.GitHubBranchList> getListBranchesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listBranches",
      requestType = ai.stigmer.platform.github.v1.ListGitHubBranchesInput.class,
      responseType = ai.stigmer.platform.github.v1.GitHubBranchList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ListGitHubBranchesInput,
      ai.stigmer.platform.github.v1.GitHubBranchList> getListBranchesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ListGitHubBranchesInput, ai.stigmer.platform.github.v1.GitHubBranchList> getListBranchesMethod;
    if ((getListBranchesMethod = GitHubQueryControllerGrpc.getListBranchesMethod) == null) {
      synchronized (GitHubQueryControllerGrpc.class) {
        if ((getListBranchesMethod = GitHubQueryControllerGrpc.getListBranchesMethod) == null) {
          GitHubQueryControllerGrpc.getListBranchesMethod = getListBranchesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.github.v1.ListGitHubBranchesInput, ai.stigmer.platform.github.v1.GitHubBranchList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listBranches"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.ListGitHubBranchesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GitHubBranchList.getDefaultInstance()))
              .setSchemaDescriptor(new GitHubQueryControllerMethodDescriptorSupplier("listBranches"))
              .build();
        }
      }
    }
    return getListBranchesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetGitHubTreeInput,
      ai.stigmer.platform.github.v1.GitHubTree> getGetTreeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getTree",
      requestType = ai.stigmer.platform.github.v1.GetGitHubTreeInput.class,
      responseType = ai.stigmer.platform.github.v1.GitHubTree.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetGitHubTreeInput,
      ai.stigmer.platform.github.v1.GitHubTree> getGetTreeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetGitHubTreeInput, ai.stigmer.platform.github.v1.GitHubTree> getGetTreeMethod;
    if ((getGetTreeMethod = GitHubQueryControllerGrpc.getGetTreeMethod) == null) {
      synchronized (GitHubQueryControllerGrpc.class) {
        if ((getGetTreeMethod = GitHubQueryControllerGrpc.getGetTreeMethod) == null) {
          GitHubQueryControllerGrpc.getGetTreeMethod = getGetTreeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.github.v1.GetGitHubTreeInput, ai.stigmer.platform.github.v1.GitHubTree>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getTree"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GetGitHubTreeInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GitHubTree.getDefaultInstance()))
              .setSchemaDescriptor(new GitHubQueryControllerMethodDescriptorSupplier("getTree"))
              .build();
        }
      }
    }
    return getGetTreeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetGitHubFileContentInput,
      ai.stigmer.platform.github.v1.GitHubFileContent> getGetFileContentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getFileContent",
      requestType = ai.stigmer.platform.github.v1.GetGitHubFileContentInput.class,
      responseType = ai.stigmer.platform.github.v1.GitHubFileContent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetGitHubFileContentInput,
      ai.stigmer.platform.github.v1.GitHubFileContent> getGetFileContentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetGitHubFileContentInput, ai.stigmer.platform.github.v1.GitHubFileContent> getGetFileContentMethod;
    if ((getGetFileContentMethod = GitHubQueryControllerGrpc.getGetFileContentMethod) == null) {
      synchronized (GitHubQueryControllerGrpc.class) {
        if ((getGetFileContentMethod = GitHubQueryControllerGrpc.getGetFileContentMethod) == null) {
          GitHubQueryControllerGrpc.getGetFileContentMethod = getGetFileContentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.github.v1.GetGitHubFileContentInput, ai.stigmer.platform.github.v1.GitHubFileContent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getFileContent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GetGitHubFileContentInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GitHubFileContent.getDefaultInstance()))
              .setSchemaDescriptor(new GitHubQueryControllerMethodDescriptorSupplier("getFileContent"))
              .build();
        }
      }
    }
    return getGetFileContentMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static GitHubQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerStub>() {
        @java.lang.Override
        public GitHubQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubQueryControllerStub(channel, callOptions);
        }
      };
    return GitHubQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static GitHubQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public GitHubQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return GitHubQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static GitHubQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerBlockingStub>() {
        @java.lang.Override
        public GitHubQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return GitHubQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static GitHubQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubQueryControllerFutureStub>() {
        @java.lang.Override
        public GitHubQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubQueryControllerFutureStub(channel, callOptions);
        }
      };
    return GitHubQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * GitHubQueryController reads GitHub repositories with the caller's saved
   * github.com login, so no page holds the token.
   * Each RPC uses the github.com connection in the caller's My vault in the
   * named organization, and answers FAILED_PRECONDITION when there is none.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * List the repositories the connected account can reach, one page at a
     * time, most recently updated first.
     * </pre>
     */
    default void listRepositories(ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubRepositoryList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListRepositoriesMethod(), responseObserver);
    }

    /**
     * <pre>
     * Search the repositories the connected account can reach.
     * </pre>
     */
    default void searchRepositories(ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubRepositoryList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSearchRepositoriesMethod(), responseObserver);
    }

    /**
     * <pre>
     * List a repository's branches.
     * </pre>
     */
    default void listBranches(ai.stigmer.platform.github.v1.ListGitHubBranchesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubBranchList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListBranchesMethod(), responseObserver);
    }

    /**
     * <pre>
     * List every file and directory of a repository at a branch or commit.
     * </pre>
     */
    default void getTree(ai.stigmer.platform.github.v1.GetGitHubTreeInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubTree> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetTreeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Read one file of a repository at a branch or commit.
     * Files above 10 MiB are reported by size without their content.
     * </pre>
     */
    default void getFileContent(ai.stigmer.platform.github.v1.GetGitHubFileContentInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubFileContent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetFileContentMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service GitHubQueryController.
   * <pre>
   * GitHubQueryController reads GitHub repositories with the caller's saved
   * github.com login, so no page holds the token.
   * Each RPC uses the github.com connection in the caller's My vault in the
   * named organization, and answers FAILED_PRECONDITION when there is none.
   * </pre>
   */
  public static abstract class GitHubQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return GitHubQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service GitHubQueryController.
   * <pre>
   * GitHubQueryController reads GitHub repositories with the caller's saved
   * github.com login, so no page holds the token.
   * Each RPC uses the github.com connection in the caller's My vault in the
   * named organization, and answers FAILED_PRECONDITION when there is none.
   * </pre>
   */
  public static final class GitHubQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<GitHubQueryControllerStub> {
    private GitHubQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the repositories the connected account can reach, one page at a
     * time, most recently updated first.
     * </pre>
     */
    public void listRepositories(ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubRepositoryList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListRepositoriesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Search the repositories the connected account can reach.
     * </pre>
     */
    public void searchRepositories(ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubRepositoryList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSearchRepositoriesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List a repository's branches.
     * </pre>
     */
    public void listBranches(ai.stigmer.platform.github.v1.ListGitHubBranchesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubBranchList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListBranchesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List every file and directory of a repository at a branch or commit.
     * </pre>
     */
    public void getTree(ai.stigmer.platform.github.v1.GetGitHubTreeInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubTree> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetTreeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Read one file of a repository at a branch or commit.
     * Files above 10 MiB are reported by size without their content.
     * </pre>
     */
    public void getFileContent(ai.stigmer.platform.github.v1.GetGitHubFileContentInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubFileContent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetFileContentMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service GitHubQueryController.
   * <pre>
   * GitHubQueryController reads GitHub repositories with the caller's saved
   * github.com login, so no page holds the token.
   * Each RPC uses the github.com connection in the caller's My vault in the
   * named organization, and answers FAILED_PRECONDITION when there is none.
   * </pre>
   */
  public static final class GitHubQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<GitHubQueryControllerBlockingV2Stub> {
    private GitHubQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * List the repositories the connected account can reach, one page at a
     * time, most recently updated first.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubRepositoryList listRepositories(ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListRepositoriesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Search the repositories the connected account can reach.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubRepositoryList searchRepositories(ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSearchRepositoriesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a repository's branches.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubBranchList listBranches(ai.stigmer.platform.github.v1.ListGitHubBranchesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListBranchesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List every file and directory of a repository at a branch or commit.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubTree getTree(ai.stigmer.platform.github.v1.GetGitHubTreeInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetTreeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read one file of a repository at a branch or commit.
     * Files above 10 MiB are reported by size without their content.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubFileContent getFileContent(ai.stigmer.platform.github.v1.GetGitHubFileContentInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetFileContentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service GitHubQueryController.
   * <pre>
   * GitHubQueryController reads GitHub repositories with the caller's saved
   * github.com login, so no page holds the token.
   * Each RPC uses the github.com connection in the caller's My vault in the
   * named organization, and answers FAILED_PRECONDITION when there is none.
   * </pre>
   */
  public static final class GitHubQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<GitHubQueryControllerBlockingStub> {
    private GitHubQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the repositories the connected account can reach, one page at a
     * time, most recently updated first.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubRepositoryList listRepositories(ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListRepositoriesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Search the repositories the connected account can reach.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubRepositoryList searchRepositories(ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSearchRepositoriesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List a repository's branches.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubBranchList listBranches(ai.stigmer.platform.github.v1.ListGitHubBranchesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListBranchesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List every file and directory of a repository at a branch or commit.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubTree getTree(ai.stigmer.platform.github.v1.GetGitHubTreeInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetTreeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read one file of a repository at a branch or commit.
     * Files above 10 MiB are reported by size without their content.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GitHubFileContent getFileContent(ai.stigmer.platform.github.v1.GetGitHubFileContentInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetFileContentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service GitHubQueryController.
   * <pre>
   * GitHubQueryController reads GitHub repositories with the caller's saved
   * github.com login, so no page holds the token.
   * Each RPC uses the github.com connection in the caller's My vault in the
   * named organization, and answers FAILED_PRECONDITION when there is none.
   * </pre>
   */
  public static final class GitHubQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<GitHubQueryControllerFutureStub> {
    private GitHubQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the repositories the connected account can reach, one page at a
     * time, most recently updated first.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.github.v1.GitHubRepositoryList> listRepositories(
        ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListRepositoriesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Search the repositories the connected account can reach.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.github.v1.GitHubRepositoryList> searchRepositories(
        ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSearchRepositoriesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List a repository's branches.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.github.v1.GitHubBranchList> listBranches(
        ai.stigmer.platform.github.v1.ListGitHubBranchesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListBranchesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List every file and directory of a repository at a branch or commit.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.github.v1.GitHubTree> getTree(
        ai.stigmer.platform.github.v1.GetGitHubTreeInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetTreeMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Read one file of a repository at a branch or commit.
     * Files above 10 MiB are reported by size without their content.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.github.v1.GitHubFileContent> getFileContent(
        ai.stigmer.platform.github.v1.GetGitHubFileContentInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetFileContentMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_LIST_REPOSITORIES = 0;
  private static final int METHODID_SEARCH_REPOSITORIES = 1;
  private static final int METHODID_LIST_BRANCHES = 2;
  private static final int METHODID_GET_TREE = 3;
  private static final int METHODID_GET_FILE_CONTENT = 4;

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
        case METHODID_LIST_REPOSITORIES:
          serviceImpl.listRepositories((ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubRepositoryList>) responseObserver);
          break;
        case METHODID_SEARCH_REPOSITORIES:
          serviceImpl.searchRepositories((ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubRepositoryList>) responseObserver);
          break;
        case METHODID_LIST_BRANCHES:
          serviceImpl.listBranches((ai.stigmer.platform.github.v1.ListGitHubBranchesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubBranchList>) responseObserver);
          break;
        case METHODID_GET_TREE:
          serviceImpl.getTree((ai.stigmer.platform.github.v1.GetGitHubTreeInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubTree>) responseObserver);
          break;
        case METHODID_GET_FILE_CONTENT:
          serviceImpl.getFileContent((ai.stigmer.platform.github.v1.GetGitHubFileContentInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GitHubFileContent>) responseObserver);
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
          getListRepositoriesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput,
              ai.stigmer.platform.github.v1.GitHubRepositoryList>(
                service, METHODID_LIST_REPOSITORIES)))
        .addMethod(
          getSearchRepositoriesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput,
              ai.stigmer.platform.github.v1.GitHubRepositoryList>(
                service, METHODID_SEARCH_REPOSITORIES)))
        .addMethod(
          getListBranchesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.github.v1.ListGitHubBranchesInput,
              ai.stigmer.platform.github.v1.GitHubBranchList>(
                service, METHODID_LIST_BRANCHES)))
        .addMethod(
          getGetTreeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.github.v1.GetGitHubTreeInput,
              ai.stigmer.platform.github.v1.GitHubTree>(
                service, METHODID_GET_TREE)))
        .addMethod(
          getGetFileContentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.github.v1.GetGitHubFileContentInput,
              ai.stigmer.platform.github.v1.GitHubFileContent>(
                service, METHODID_GET_FILE_CONTENT)))
        .build();
  }

  private static abstract class GitHubQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    GitHubQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.platform.github.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("GitHubQueryController");
    }
  }

  private static final class GitHubQueryControllerFileDescriptorSupplier
      extends GitHubQueryControllerBaseDescriptorSupplier {
    GitHubQueryControllerFileDescriptorSupplier() {}
  }

  private static final class GitHubQueryControllerMethodDescriptorSupplier
      extends GitHubQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    GitHubQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (GitHubQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new GitHubQueryControllerFileDescriptorSupplier())
              .addMethod(getListRepositoriesMethod())
              .addMethod(getSearchRepositoriesMethod())
              .addMethod(getListBranchesMethod())
              .addMethod(getGetTreeMethod())
              .addMethod(getGetFileContentMethod())
              .build();
        }
      }
    }
    return result;
  }
}
