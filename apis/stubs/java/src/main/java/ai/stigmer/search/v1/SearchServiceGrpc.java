package ai.stigmer.search.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * SearchService provides unified search and discovery across API resources.
 * A single RPC handles listing, searching, and discovering resources.
 * The behavior depends on the combination of request parameters:
 * specify kinds to filter by resource type, provide a query for full-text
 * search, or leave both empty to list all accessible resources.
 * Results only include resources the caller has permission to view.
 * &#64;internal
 * This is a CQRS Query Service on the read-side. It queries multiple domain
 * aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized
 * projections. It does not modify state.
 * Search is cross-aggregate query infrastructure, not a domain bounded context.
 * It lives in the query layer (CQRS read-side), not the domain layer.
 * Therefore, it does not have an api_resource_kind option like domain services.
 * Authorization is handled programmatically in the handler (not via
 * declarative authorization options like domain services):
 * 1. Call FGA to get authorized resource IDs per requested kind
 * 2. Apply filters (org, query, exclude_public) against authorized set
 * 3. Return only resources the caller has can_view permission on
 * Usage Patterns (all via single RPC):
 * - List agents in org:    {kinds: [agent], org: "acme", query: ""}
 * - Search agents:         {kinds: [agent], query: "security"}
 * - Search in org:         {kinds: [agent], org: "acme", query: "security"}
 * - Discover all kinds:    {kinds: [], query: "kubernetes"}
 * - Discover specific:     {kinds: [agent, skill], query: "kubernetes"}
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class SearchServiceGrpc {

  private SearchServiceGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.search.v1.SearchService";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.search.v1.SearchRequest,
      ai.stigmer.search.v1.SearchResponse> getSearchMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "search",
      requestType = ai.stigmer.search.v1.SearchRequest.class,
      responseType = ai.stigmer.search.v1.SearchResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.search.v1.SearchRequest,
      ai.stigmer.search.v1.SearchResponse> getSearchMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.search.v1.SearchRequest, ai.stigmer.search.v1.SearchResponse> getSearchMethod;
    if ((getSearchMethod = SearchServiceGrpc.getSearchMethod) == null) {
      synchronized (SearchServiceGrpc.class) {
        if ((getSearchMethod = SearchServiceGrpc.getSearchMethod) == null) {
          SearchServiceGrpc.getSearchMethod = getSearchMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.search.v1.SearchRequest, ai.stigmer.search.v1.SearchResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "search"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.search.v1.SearchRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.search.v1.SearchResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SearchServiceMethodDescriptorSupplier("search"))
              .build();
        }
      }
    }
    return getSearchMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static SearchServiceStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SearchServiceStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SearchServiceStub>() {
        @java.lang.Override
        public SearchServiceStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SearchServiceStub(channel, callOptions);
        }
      };
    return SearchServiceStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static SearchServiceBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SearchServiceBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SearchServiceBlockingV2Stub>() {
        @java.lang.Override
        public SearchServiceBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SearchServiceBlockingV2Stub(channel, callOptions);
        }
      };
    return SearchServiceBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static SearchServiceBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SearchServiceBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SearchServiceBlockingStub>() {
        @java.lang.Override
        public SearchServiceBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SearchServiceBlockingStub(channel, callOptions);
        }
      };
    return SearchServiceBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static SearchServiceFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SearchServiceFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SearchServiceFutureStub>() {
        @java.lang.Override
        public SearchServiceFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SearchServiceFutureStub(channel, callOptions);
        }
      };
    return SearchServiceFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * SearchService provides unified search and discovery across API resources.
   * A single RPC handles listing, searching, and discovering resources.
   * The behavior depends on the combination of request parameters:
   * specify kinds to filter by resource type, provide a query for full-text
   * search, or leave both empty to list all accessible resources.
   * Results only include resources the caller has permission to view.
   * &#64;internal
   * This is a CQRS Query Service on the read-side. It queries multiple domain
   * aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized
   * projections. It does not modify state.
   * Search is cross-aggregate query infrastructure, not a domain bounded context.
   * It lives in the query layer (CQRS read-side), not the domain layer.
   * Therefore, it does not have an api_resource_kind option like domain services.
   * Authorization is handled programmatically in the handler (not via
   * declarative authorization options like domain services):
   * 1. Call FGA to get authorized resource IDs per requested kind
   * 2. Apply filters (org, query, exclude_public) against authorized set
   * 3. Return only resources the caller has can_view permission on
   * Usage Patterns (all via single RPC):
   * - List agents in org:    {kinds: [agent], org: "acme", query: ""}
   * - Search agents:         {kinds: [agent], query: "security"}
   * - Search in org:         {kinds: [agent], org: "acme", query: "security"}
   * - Discover all kinds:    {kinds: [], query: "kubernetes"}
   * - Discover specific:     {kinds: [agent, skill], query: "kubernetes"}
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Search resources across one or more kinds.
     * This is the unified entry point for list, search, and discover operations.
     * The behavior is determined by the combination of request parameters:
     * | Operation  | kinds   | query | org    | Behavior                               |
     * |------------|---------|-------|--------|----------------------------------------|
     * | List       | [X]     | ""    | "acme" | All X in org, sorted by created_at     |
     * | List All   | [X]     | ""    | ""     | All accessible X, sorted by created_at |
     * | Search     | [X]     | "..." | ""     | Search X by query, sorted by relevance |
     * | Search Org | [X]     | "..." | "acme" | Search X in org, sorted by relevance   |
     * | Discover   | []      | "..." | ""     | Search all kinds, sorted by relevance  |
     * Sort Order:
     * - With query: Results sorted by relevance score (descending)
     * - Without query: Results sorted by created_at (descending, newer first)
     * Pagination:
     * Use page.num (1-indexed) and page.size to paginate results.
     * Response includes total_count and total_pages for pagination controls.
     * &#64;internal
     * Authorization: Returns only resources the caller has can_view permission on.
     * The handler queries FGA per kind to get authorized IDs, then applies filters.
     * </pre>
     */
    default void search(ai.stigmer.search.v1.SearchRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.search.v1.SearchResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSearchMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service SearchService.
   * <pre>
   * SearchService provides unified search and discovery across API resources.
   * A single RPC handles listing, searching, and discovering resources.
   * The behavior depends on the combination of request parameters:
   * specify kinds to filter by resource type, provide a query for full-text
   * search, or leave both empty to list all accessible resources.
   * Results only include resources the caller has permission to view.
   * &#64;internal
   * This is a CQRS Query Service on the read-side. It queries multiple domain
   * aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized
   * projections. It does not modify state.
   * Search is cross-aggregate query infrastructure, not a domain bounded context.
   * It lives in the query layer (CQRS read-side), not the domain layer.
   * Therefore, it does not have an api_resource_kind option like domain services.
   * Authorization is handled programmatically in the handler (not via
   * declarative authorization options like domain services):
   * 1. Call FGA to get authorized resource IDs per requested kind
   * 2. Apply filters (org, query, exclude_public) against authorized set
   * 3. Return only resources the caller has can_view permission on
   * Usage Patterns (all via single RPC):
   * - List agents in org:    {kinds: [agent], org: "acme", query: ""}
   * - Search agents:         {kinds: [agent], query: "security"}
   * - Search in org:         {kinds: [agent], org: "acme", query: "security"}
   * - Discover all kinds:    {kinds: [], query: "kubernetes"}
   * - Discover specific:     {kinds: [agent, skill], query: "kubernetes"}
   * </pre>
   */
  public static abstract class SearchServiceImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return SearchServiceGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service SearchService.
   * <pre>
   * SearchService provides unified search and discovery across API resources.
   * A single RPC handles listing, searching, and discovering resources.
   * The behavior depends on the combination of request parameters:
   * specify kinds to filter by resource type, provide a query for full-text
   * search, or leave both empty to list all accessible resources.
   * Results only include resources the caller has permission to view.
   * &#64;internal
   * This is a CQRS Query Service on the read-side. It queries multiple domain
   * aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized
   * projections. It does not modify state.
   * Search is cross-aggregate query infrastructure, not a domain bounded context.
   * It lives in the query layer (CQRS read-side), not the domain layer.
   * Therefore, it does not have an api_resource_kind option like domain services.
   * Authorization is handled programmatically in the handler (not via
   * declarative authorization options like domain services):
   * 1. Call FGA to get authorized resource IDs per requested kind
   * 2. Apply filters (org, query, exclude_public) against authorized set
   * 3. Return only resources the caller has can_view permission on
   * Usage Patterns (all via single RPC):
   * - List agents in org:    {kinds: [agent], org: "acme", query: ""}
   * - Search agents:         {kinds: [agent], query: "security"}
   * - Search in org:         {kinds: [agent], org: "acme", query: "security"}
   * - Discover all kinds:    {kinds: [], query: "kubernetes"}
   * - Discover specific:     {kinds: [agent, skill], query: "kubernetes"}
   * </pre>
   */
  public static final class SearchServiceStub
      extends io.grpc.stub.AbstractAsyncStub<SearchServiceStub> {
    private SearchServiceStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SearchServiceStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SearchServiceStub(channel, callOptions);
    }

    /**
     * <pre>
     * Search resources across one or more kinds.
     * This is the unified entry point for list, search, and discover operations.
     * The behavior is determined by the combination of request parameters:
     * | Operation  | kinds   | query | org    | Behavior                               |
     * |------------|---------|-------|--------|----------------------------------------|
     * | List       | [X]     | ""    | "acme" | All X in org, sorted by created_at     |
     * | List All   | [X]     | ""    | ""     | All accessible X, sorted by created_at |
     * | Search     | [X]     | "..." | ""     | Search X by query, sorted by relevance |
     * | Search Org | [X]     | "..." | "acme" | Search X in org, sorted by relevance   |
     * | Discover   | []      | "..." | ""     | Search all kinds, sorted by relevance  |
     * Sort Order:
     * - With query: Results sorted by relevance score (descending)
     * - Without query: Results sorted by created_at (descending, newer first)
     * Pagination:
     * Use page.num (1-indexed) and page.size to paginate results.
     * Response includes total_count and total_pages for pagination controls.
     * &#64;internal
     * Authorization: Returns only resources the caller has can_view permission on.
     * The handler queries FGA per kind to get authorized IDs, then applies filters.
     * </pre>
     */
    public void search(ai.stigmer.search.v1.SearchRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.search.v1.SearchResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSearchMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service SearchService.
   * <pre>
   * SearchService provides unified search and discovery across API resources.
   * A single RPC handles listing, searching, and discovering resources.
   * The behavior depends on the combination of request parameters:
   * specify kinds to filter by resource type, provide a query for full-text
   * search, or leave both empty to list all accessible resources.
   * Results only include resources the caller has permission to view.
   * &#64;internal
   * This is a CQRS Query Service on the read-side. It queries multiple domain
   * aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized
   * projections. It does not modify state.
   * Search is cross-aggregate query infrastructure, not a domain bounded context.
   * It lives in the query layer (CQRS read-side), not the domain layer.
   * Therefore, it does not have an api_resource_kind option like domain services.
   * Authorization is handled programmatically in the handler (not via
   * declarative authorization options like domain services):
   * 1. Call FGA to get authorized resource IDs per requested kind
   * 2. Apply filters (org, query, exclude_public) against authorized set
   * 3. Return only resources the caller has can_view permission on
   * Usage Patterns (all via single RPC):
   * - List agents in org:    {kinds: [agent], org: "acme", query: ""}
   * - Search agents:         {kinds: [agent], query: "security"}
   * - Search in org:         {kinds: [agent], org: "acme", query: "security"}
   * - Discover all kinds:    {kinds: [], query: "kubernetes"}
   * - Discover specific:     {kinds: [agent, skill], query: "kubernetes"}
   * </pre>
   */
  public static final class SearchServiceBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<SearchServiceBlockingV2Stub> {
    private SearchServiceBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SearchServiceBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SearchServiceBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Search resources across one or more kinds.
     * This is the unified entry point for list, search, and discover operations.
     * The behavior is determined by the combination of request parameters:
     * | Operation  | kinds   | query | org    | Behavior                               |
     * |------------|---------|-------|--------|----------------------------------------|
     * | List       | [X]     | ""    | "acme" | All X in org, sorted by created_at     |
     * | List All   | [X]     | ""    | ""     | All accessible X, sorted by created_at |
     * | Search     | [X]     | "..." | ""     | Search X by query, sorted by relevance |
     * | Search Org | [X]     | "..." | "acme" | Search X in org, sorted by relevance   |
     * | Discover   | []      | "..." | ""     | Search all kinds, sorted by relevance  |
     * Sort Order:
     * - With query: Results sorted by relevance score (descending)
     * - Without query: Results sorted by created_at (descending, newer first)
     * Pagination:
     * Use page.num (1-indexed) and page.size to paginate results.
     * Response includes total_count and total_pages for pagination controls.
     * &#64;internal
     * Authorization: Returns only resources the caller has can_view permission on.
     * The handler queries FGA per kind to get authorized IDs, then applies filters.
     * </pre>
     */
    public ai.stigmer.search.v1.SearchResponse search(ai.stigmer.search.v1.SearchRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSearchMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service SearchService.
   * <pre>
   * SearchService provides unified search and discovery across API resources.
   * A single RPC handles listing, searching, and discovering resources.
   * The behavior depends on the combination of request parameters:
   * specify kinds to filter by resource type, provide a query for full-text
   * search, or leave both empty to list all accessible resources.
   * Results only include resources the caller has permission to view.
   * &#64;internal
   * This is a CQRS Query Service on the read-side. It queries multiple domain
   * aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized
   * projections. It does not modify state.
   * Search is cross-aggregate query infrastructure, not a domain bounded context.
   * It lives in the query layer (CQRS read-side), not the domain layer.
   * Therefore, it does not have an api_resource_kind option like domain services.
   * Authorization is handled programmatically in the handler (not via
   * declarative authorization options like domain services):
   * 1. Call FGA to get authorized resource IDs per requested kind
   * 2. Apply filters (org, query, exclude_public) against authorized set
   * 3. Return only resources the caller has can_view permission on
   * Usage Patterns (all via single RPC):
   * - List agents in org:    {kinds: [agent], org: "acme", query: ""}
   * - Search agents:         {kinds: [agent], query: "security"}
   * - Search in org:         {kinds: [agent], org: "acme", query: "security"}
   * - Discover all kinds:    {kinds: [], query: "kubernetes"}
   * - Discover specific:     {kinds: [agent, skill], query: "kubernetes"}
   * </pre>
   */
  public static final class SearchServiceBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<SearchServiceBlockingStub> {
    private SearchServiceBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SearchServiceBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SearchServiceBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Search resources across one or more kinds.
     * This is the unified entry point for list, search, and discover operations.
     * The behavior is determined by the combination of request parameters:
     * | Operation  | kinds   | query | org    | Behavior                               |
     * |------------|---------|-------|--------|----------------------------------------|
     * | List       | [X]     | ""    | "acme" | All X in org, sorted by created_at     |
     * | List All   | [X]     | ""    | ""     | All accessible X, sorted by created_at |
     * | Search     | [X]     | "..." | ""     | Search X by query, sorted by relevance |
     * | Search Org | [X]     | "..." | "acme" | Search X in org, sorted by relevance   |
     * | Discover   | []      | "..." | ""     | Search all kinds, sorted by relevance  |
     * Sort Order:
     * - With query: Results sorted by relevance score (descending)
     * - Without query: Results sorted by created_at (descending, newer first)
     * Pagination:
     * Use page.num (1-indexed) and page.size to paginate results.
     * Response includes total_count and total_pages for pagination controls.
     * &#64;internal
     * Authorization: Returns only resources the caller has can_view permission on.
     * The handler queries FGA per kind to get authorized IDs, then applies filters.
     * </pre>
     */
    public ai.stigmer.search.v1.SearchResponse search(ai.stigmer.search.v1.SearchRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSearchMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service SearchService.
   * <pre>
   * SearchService provides unified search and discovery across API resources.
   * A single RPC handles listing, searching, and discovering resources.
   * The behavior depends on the combination of request parameters:
   * specify kinds to filter by resource type, provide a query for full-text
   * search, or leave both empty to list all accessible resources.
   * Results only include resources the caller has permission to view.
   * &#64;internal
   * This is a CQRS Query Service on the read-side. It queries multiple domain
   * aggregates (Agent, Skill, McpServer, Workflow) and returns display-optimized
   * projections. It does not modify state.
   * Search is cross-aggregate query infrastructure, not a domain bounded context.
   * It lives in the query layer (CQRS read-side), not the domain layer.
   * Therefore, it does not have an api_resource_kind option like domain services.
   * Authorization is handled programmatically in the handler (not via
   * declarative authorization options like domain services):
   * 1. Call FGA to get authorized resource IDs per requested kind
   * 2. Apply filters (org, query, exclude_public) against authorized set
   * 3. Return only resources the caller has can_view permission on
   * Usage Patterns (all via single RPC):
   * - List agents in org:    {kinds: [agent], org: "acme", query: ""}
   * - Search agents:         {kinds: [agent], query: "security"}
   * - Search in org:         {kinds: [agent], org: "acme", query: "security"}
   * - Discover all kinds:    {kinds: [], query: "kubernetes"}
   * - Discover specific:     {kinds: [agent, skill], query: "kubernetes"}
   * </pre>
   */
  public static final class SearchServiceFutureStub
      extends io.grpc.stub.AbstractFutureStub<SearchServiceFutureStub> {
    private SearchServiceFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SearchServiceFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SearchServiceFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Search resources across one or more kinds.
     * This is the unified entry point for list, search, and discover operations.
     * The behavior is determined by the combination of request parameters:
     * | Operation  | kinds   | query | org    | Behavior                               |
     * |------------|---------|-------|--------|----------------------------------------|
     * | List       | [X]     | ""    | "acme" | All X in org, sorted by created_at     |
     * | List All   | [X]     | ""    | ""     | All accessible X, sorted by created_at |
     * | Search     | [X]     | "..." | ""     | Search X by query, sorted by relevance |
     * | Search Org | [X]     | "..." | "acme" | Search X in org, sorted by relevance   |
     * | Discover   | []      | "..." | ""     | Search all kinds, sorted by relevance  |
     * Sort Order:
     * - With query: Results sorted by relevance score (descending)
     * - Without query: Results sorted by created_at (descending, newer first)
     * Pagination:
     * Use page.num (1-indexed) and page.size to paginate results.
     * Response includes total_count and total_pages for pagination controls.
     * &#64;internal
     * Authorization: Returns only resources the caller has can_view permission on.
     * The handler queries FGA per kind to get authorized IDs, then applies filters.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.search.v1.SearchResponse> search(
        ai.stigmer.search.v1.SearchRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSearchMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_SEARCH = 0;

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
        case METHODID_SEARCH:
          serviceImpl.search((ai.stigmer.search.v1.SearchRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.search.v1.SearchResponse>) responseObserver);
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
          getSearchMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.search.v1.SearchRequest,
              ai.stigmer.search.v1.SearchResponse>(
                service, METHODID_SEARCH)))
        .build();
  }

  private static abstract class SearchServiceBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    SearchServiceBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.search.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("SearchService");
    }
  }

  private static final class SearchServiceFileDescriptorSupplier
      extends SearchServiceBaseDescriptorSupplier {
    SearchServiceFileDescriptorSupplier() {}
  }

  private static final class SearchServiceMethodDescriptorSupplier
      extends SearchServiceBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    SearchServiceMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (SearchServiceGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new SearchServiceFileDescriptorSupplier())
              .addMethod(getSearchMethod())
              .build();
        }
      }
    }
    return result;
  }
}
