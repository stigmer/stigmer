package ai.stigmer.iam.team.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * TeamQueryController provides read operations for teams.
 * Every member of an organization can see its teams, so anyone who can share
 * a resource can pick a team to share it with. Who is in a team is read
 * through the IAM policy service's access list on the team.
 * &#64;internal
 * Served by the Enterprise and Cloud editions; the open-source server
 * registers no Team service.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class TeamQueryControllerGrpc {

  private TeamQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.team.v1.TeamQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.team.v1.Team> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.iam.team.v1.Team.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.team.v1.Team> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.team.v1.Team> getGetMethod;
    if ((getGetMethod = TeamQueryControllerGrpc.getGetMethod) == null) {
      synchronized (TeamQueryControllerGrpc.class) {
        if ((getGetMethod = TeamQueryControllerGrpc.getGetMethod) == null) {
          TeamQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.team.v1.Team>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setSchemaDescriptor(new TeamQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.team.v1.Team> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.iam.team.v1.Team.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.team.v1.Team> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.team.v1.Team> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = TeamQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (TeamQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = TeamQueryControllerGrpc.getGetByReferenceMethod) == null) {
          TeamQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.team.v1.Team>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Team.getDefaultInstance()))
              .setSchemaDescriptor(new TeamQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.ListTeamsByOrgInput,
      ai.stigmer.iam.team.v1.Teams> getListByOrgMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByOrg",
      requestType = ai.stigmer.iam.team.v1.ListTeamsByOrgInput.class,
      responseType = ai.stigmer.iam.team.v1.Teams.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.ListTeamsByOrgInput,
      ai.stigmer.iam.team.v1.Teams> getListByOrgMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.team.v1.ListTeamsByOrgInput, ai.stigmer.iam.team.v1.Teams> getListByOrgMethod;
    if ((getListByOrgMethod = TeamQueryControllerGrpc.getListByOrgMethod) == null) {
      synchronized (TeamQueryControllerGrpc.class) {
        if ((getListByOrgMethod = TeamQueryControllerGrpc.getListByOrgMethod) == null) {
          TeamQueryControllerGrpc.getListByOrgMethod = getListByOrgMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.team.v1.ListTeamsByOrgInput, ai.stigmer.iam.team.v1.Teams>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByOrg"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.ListTeamsByOrgInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.team.v1.Teams.getDefaultInstance()))
              .setSchemaDescriptor(new TeamQueryControllerMethodDescriptorSupplier("listByOrg"))
              .build();
        }
      }
    }
    return getListByOrgMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static TeamQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerStub>() {
        @java.lang.Override
        public TeamQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamQueryControllerStub(channel, callOptions);
        }
      };
    return TeamQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static TeamQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public TeamQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return TeamQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static TeamQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerBlockingStub>() {
        @java.lang.Override
        public TeamQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return TeamQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static TeamQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TeamQueryControllerFutureStub>() {
        @java.lang.Override
        public TeamQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TeamQueryControllerFutureStub(channel, callOptions);
        }
      };
    return TeamQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * TeamQueryController provides read operations for teams.
   * Every member of an organization can see its teams, so anyone who can share
   * a resource can pick a team to share it with. Who is in a team is read
   * through the IAM policy service's access list on the team.
   * &#64;internal
   * Served by the Enterprise and Cloud editions; the open-source server
   * registers no Team service.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a team by its unique identifier.
     * &#64;internal
     * Authorization: can_view on the team (every organization viewer).
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a team by its organization-scoped reference (org/slug).
     * &#64;internal
     * The request carries a slug, not an id, so the handler resolves the
     * reference first and then authorizes can_view on the resolved team, the
     * check get makes.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the teams of an organization.
     * &#64;internal
     * Authorization: can_view on the organization. Every organization viewer
     * sees every team, so the list needs no per-row scope.
     * </pre>
     */
    default void listByOrg(ai.stigmer.iam.team.v1.ListTeamsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Teams> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByOrgMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service TeamQueryController.
   * <pre>
   * TeamQueryController provides read operations for teams.
   * Every member of an organization can see its teams, so anyone who can share
   * a resource can pick a team to share it with. Who is in a team is read
   * through the IAM policy service's access list on the team.
   * &#64;internal
   * Served by the Enterprise and Cloud editions; the open-source server
   * registers no Team service.
   * </pre>
   */
  public static abstract class TeamQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return TeamQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service TeamQueryController.
   * <pre>
   * TeamQueryController provides read operations for teams.
   * Every member of an organization can see its teams, so anyone who can share
   * a resource can pick a team to share it with. Who is in a team is read
   * through the IAM policy service's access list on the team.
   * &#64;internal
   * Served by the Enterprise and Cloud editions; the open-source server
   * registers no Team service.
   * </pre>
   */
  public static final class TeamQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<TeamQueryControllerStub> {
    private TeamQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a team by its unique identifier.
     * &#64;internal
     * Authorization: can_view on the team (every organization viewer).
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a team by its organization-scoped reference (org/slug).
     * &#64;internal
     * The request carries a slug, not an id, so the handler resolves the
     * reference first and then authorizes can_view on the resolved team, the
     * check get makes.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the teams of an organization.
     * &#64;internal
     * Authorization: can_view on the organization. Every organization viewer
     * sees every team, so the list needs no per-row scope.
     * </pre>
     */
    public void listByOrg(ai.stigmer.iam.team.v1.ListTeamsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Teams> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service TeamQueryController.
   * <pre>
   * TeamQueryController provides read operations for teams.
   * Every member of an organization can see its teams, so anyone who can share
   * a resource can pick a team to share it with. Who is in a team is read
   * through the IAM policy service's access list on the team.
   * &#64;internal
   * Served by the Enterprise and Cloud editions; the open-source server
   * registers no Team service.
   * </pre>
   */
  public static final class TeamQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<TeamQueryControllerBlockingV2Stub> {
    private TeamQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a team by its unique identifier.
     * &#64;internal
     * Authorization: can_view on the team (every organization viewer).
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a team by its organization-scoped reference (org/slug).
     * &#64;internal
     * The request carries a slug, not an id, so the handler resolves the
     * reference first and then authorizes can_view on the resolved team, the
     * check get makes.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the teams of an organization.
     * &#64;internal
     * Authorization: can_view on the organization. Every organization viewer
     * sees every team, so the list needs no per-row scope.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Teams listByOrg(ai.stigmer.iam.team.v1.ListTeamsByOrgInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service TeamQueryController.
   * <pre>
   * TeamQueryController provides read operations for teams.
   * Every member of an organization can see its teams, so anyone who can share
   * a resource can pick a team to share it with. Who is in a team is read
   * through the IAM policy service's access list on the team.
   * &#64;internal
   * Served by the Enterprise and Cloud editions; the open-source server
   * registers no Team service.
   * </pre>
   */
  public static final class TeamQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<TeamQueryControllerBlockingStub> {
    private TeamQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a team by its unique identifier.
     * &#64;internal
     * Authorization: can_view on the team (every organization viewer).
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a team by its organization-scoped reference (org/slug).
     * &#64;internal
     * The request carries a slug, not an id, so the handler resolves the
     * reference first and then authorizes can_view on the resolved team, the
     * check get makes.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Team getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the teams of an organization.
     * &#64;internal
     * Authorization: can_view on the organization. Every organization viewer
     * sees every team, so the list needs no per-row scope.
     * </pre>
     */
    public ai.stigmer.iam.team.v1.Teams listByOrg(ai.stigmer.iam.team.v1.ListTeamsByOrgInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service TeamQueryController.
   * <pre>
   * TeamQueryController provides read operations for teams.
   * Every member of an organization can see its teams, so anyone who can share
   * a resource can pick a team to share it with. Who is in a team is read
   * through the IAM policy service's access list on the team.
   * &#64;internal
   * Served by the Enterprise and Cloud editions; the open-source server
   * registers no Team service.
   * </pre>
   */
  public static final class TeamQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<TeamQueryControllerFutureStub> {
    private TeamQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TeamQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TeamQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a team by its unique identifier.
     * &#64;internal
     * Authorization: can_view on the team (every organization viewer).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.team.v1.Team> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a team by its organization-scoped reference (org/slug).
     * &#64;internal
     * The request carries a slug, not an id, so the handler resolves the
     * reference first and then authorizes can_view on the resolved team, the
     * check get makes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.team.v1.Team> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the teams of an organization.
     * &#64;internal
     * Authorization: can_view on the organization. Every organization viewer
     * sees every team, so the list needs no per-row scope.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.team.v1.Teams> listByOrg(
        ai.stigmer.iam.team.v1.ListTeamsByOrgInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_BY_ORG = 2;

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
          serviceImpl.get((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Team>) responseObserver);
          break;
        case METHODID_LIST_BY_ORG:
          serviceImpl.listByOrg((ai.stigmer.iam.team.v1.ListTeamsByOrgInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.team.v1.Teams>) responseObserver);
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
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.iam.team.v1.Team>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.iam.team.v1.Team>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListByOrgMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.team.v1.ListTeamsByOrgInput,
              ai.stigmer.iam.team.v1.Teams>(
                service, METHODID_LIST_BY_ORG)))
        .build();
  }

  private static abstract class TeamQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    TeamQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.team.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("TeamQueryController");
    }
  }

  private static final class TeamQueryControllerFileDescriptorSupplier
      extends TeamQueryControllerBaseDescriptorSupplier {
    TeamQueryControllerFileDescriptorSupplier() {}
  }

  private static final class TeamQueryControllerMethodDescriptorSupplier
      extends TeamQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    TeamQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (TeamQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new TeamQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListByOrgMethod())
              .build();
        }
      }
    }
    return result;
  }
}
