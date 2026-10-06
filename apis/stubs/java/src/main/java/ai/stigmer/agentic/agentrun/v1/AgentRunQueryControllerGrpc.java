package ai.stigmer.agentic.agentrun.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentRunQueryController handles read operations for agent runs.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentRunQueryControllerGrpc {

  private AgentRunQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentrun.v1.AgentRunQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunId,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agentrun.v1.AgentRunId.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunId,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunId, ai.stigmer.agentic.agentrun.v1.AgentRun> getGetMethod;
    if ((getGetMethod = AgentRunQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetMethod = AgentRunQueryControllerGrpc.getGetMethod) == null) {
          AgentRunQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.AgentRunId, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest,
      ai.stigmer.agentic.agentrun.v1.AgentRunList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest,
      ai.stigmer.agentic.agentrun.v1.AgentRunList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest, ai.stigmer.agentic.agentrun.v1.AgentRunList> getListMethod;
    if ((getListMethod = AgentRunQueryControllerGrpc.getListMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getListMethod = AgentRunQueryControllerGrpc.getListMethod) == null) {
          AgentRunQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest, ai.stigmer.agentic.agentrun.v1.AgentRunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRunList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest,
      ai.stigmer.agentic.agentrun.v1.AgentRunList> getListBySessionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listBySession",
      requestType = ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRunList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest,
      ai.stigmer.agentic.agentrun.v1.AgentRunList> getListBySessionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest, ai.stigmer.agentic.agentrun.v1.AgentRunList> getListBySessionMethod;
    if ((getListBySessionMethod = AgentRunQueryControllerGrpc.getListBySessionMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getListBySessionMethod = AgentRunQueryControllerGrpc.getListBySessionMethod) == null) {
          AgentRunQueryControllerGrpc.getListBySessionMethod = getListBySessionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest, ai.stigmer.agentic.agentrun.v1.AgentRunList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listBySession"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRunList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("listBySession"))
              .build();
        }
      }
    }
    return getListBySessionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunId,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getSubscribeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "subscribe",
      requestType = ai.stigmer.agentic.agentrun.v1.AgentRunId.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunId,
      ai.stigmer.agentic.agentrun.v1.AgentRun> getSubscribeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.AgentRunId, ai.stigmer.agentic.agentrun.v1.AgentRun> getSubscribeMethod;
    if ((getSubscribeMethod = AgentRunQueryControllerGrpc.getSubscribeMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getSubscribeMethod = AgentRunQueryControllerGrpc.getSubscribeMethod) == null) {
          AgentRunQueryControllerGrpc.getSubscribeMethod = getSubscribeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.AgentRunId, ai.stigmer.agentic.agentrun.v1.AgentRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "subscribe"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRunId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRun.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("subscribe"))
              .build();
        }
      }
    }
    return getSubscribeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest,
      ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArtifactDownloadUrl",
      requestType = ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest.class,
      responseType = ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest,
      ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest, ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod;
    if ((getGetArtifactDownloadUrlMethod = AgentRunQueryControllerGrpc.getGetArtifactDownloadUrlMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetArtifactDownloadUrlMethod = AgentRunQueryControllerGrpc.getGetArtifactDownloadUrlMethod) == null) {
          AgentRunQueryControllerGrpc.getGetArtifactDownloadUrlMethod = getGetArtifactDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest, ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArtifactDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("getArtifactDownloadUrl"))
              .build();
        }
      }
    }
    return getGetArtifactDownloadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest,
      ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse> getGetArtifactContentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArtifactContent",
      requestType = ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest.class,
      responseType = ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest,
      ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse> getGetArtifactContentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest, ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse> getGetArtifactContentMethod;
    if ((getGetArtifactContentMethod = AgentRunQueryControllerGrpc.getGetArtifactContentMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetArtifactContentMethod = AgentRunQueryControllerGrpc.getGetArtifactContentMethod) == null) {
          AgentRunQueryControllerGrpc.getGetArtifactContentMethod = getGetArtifactContentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest, ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArtifactContent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("getArtifactContent"))
              .build();
        }
      }
    }
    return getGetArtifactContentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput> getGetRunUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getRunUsageReport",
      requestType = ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput> getGetRunUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput> getGetRunUsageReportMethod;
    if ((getGetRunUsageReportMethod = AgentRunQueryControllerGrpc.getGetRunUsageReportMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetRunUsageReportMethod = AgentRunQueryControllerGrpc.getGetRunUsageReportMethod) == null) {
          AgentRunQueryControllerGrpc.getGetRunUsageReportMethod = getGetRunUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getRunUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("getRunUsageReport"))
              .build();
        }
      }
    }
    return getGetRunUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getSessionUsageReport",
      requestType = ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod;
    if ((getGetSessionUsageReportMethod = AgentRunQueryControllerGrpc.getGetSessionUsageReportMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetSessionUsageReportMethod = AgentRunQueryControllerGrpc.getGetSessionUsageReportMethod) == null) {
          AgentRunQueryControllerGrpc.getGetSessionUsageReportMethod = getGetSessionUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getSessionUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("getSessionUsageReport"))
              .build();
        }
      }
    }
    return getGetSessionUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getAgentUsageReport",
      requestType = ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod;
    if ((getGetAgentUsageReportMethod = AgentRunQueryControllerGrpc.getGetAgentUsageReportMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetAgentUsageReportMethod = AgentRunQueryControllerGrpc.getGetAgentUsageReportMethod) == null) {
          AgentRunQueryControllerGrpc.getGetAgentUsageReportMethod = getGetAgentUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getAgentUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("getAgentUsageReport"))
              .build();
        }
      }
    }
    return getGetAgentUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getOrgUsageReport",
      requestType = ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput,
      ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod;
    if ((getGetOrgUsageReportMethod = AgentRunQueryControllerGrpc.getGetOrgUsageReportMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetOrgUsageReportMethod = AgentRunQueryControllerGrpc.getGetOrgUsageReportMethod) == null) {
          AgentRunQueryControllerGrpc.getGetOrgUsageReportMethod = getGetOrgUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput, ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getOrgUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("getOrgUsageReport"))
              .build();
        }
      }
    }
    return getGetOrgUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest,
      ai.stigmer.agentic.agentrun.v1.AgentRunSummary> getGetRunSummaryMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getRunSummary",
      requestType = ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest.class,
      responseType = ai.stigmer.agentic.agentrun.v1.AgentRunSummary.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest,
      ai.stigmer.agentic.agentrun.v1.AgentRunSummary> getGetRunSummaryMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest, ai.stigmer.agentic.agentrun.v1.AgentRunSummary> getGetRunSummaryMethod;
    if ((getGetRunSummaryMethod = AgentRunQueryControllerGrpc.getGetRunSummaryMethod) == null) {
      synchronized (AgentRunQueryControllerGrpc.class) {
        if ((getGetRunSummaryMethod = AgentRunQueryControllerGrpc.getGetRunSummaryMethod) == null) {
          AgentRunQueryControllerGrpc.getGetRunSummaryMethod = getGetRunSummaryMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest, ai.stigmer.agentic.agentrun.v1.AgentRunSummary>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getRunSummary"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrun.v1.AgentRunSummary.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunQueryControllerMethodDescriptorSupplier("getRunSummary"))
              .build();
        }
      }
    }
    return getGetRunSummaryMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentRunQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerStub>() {
        @java.lang.Override
        public AgentRunQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunQueryControllerStub(channel, callOptions);
        }
      };
    return AgentRunQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentRunQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentRunQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentRunQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentRunQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentRunQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentRunQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentRunQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentRunQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentRunQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentRunQueryController handles read operations for agent runs.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent run by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agentrun.v1.AgentRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all agent runs with pagination and optional filtering.
     * </pre>
     */
    default void list(ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * </pre>
     */
    default void listBySession(ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListBySessionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * </pre>
     */
    default void subscribe(ai.stigmer.agentic.agentrun.v1.AgentRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubscribeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    default void getArtifactDownloadUrl(ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArtifactDownloadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    default void getArtifactContent(ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArtifactContentMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    default void getRunUsageReport(ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetRunUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    default void getSessionUsageReport(ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetSessionUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    default void getAgentUsageReport(ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetAgentUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    default void getOrgUsageReport(ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOrgUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    default void getRunSummary(ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunSummary> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetRunSummaryMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentRunQueryController.
   * <pre>
   * AgentRunQueryController handles read operations for agent runs.
   * </pre>
   */
  public static abstract class AgentRunQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentRunQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentRunQueryController.
   * <pre>
   * AgentRunQueryController handles read operations for agent runs.
   * </pre>
   */
  public static final class AgentRunQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentRunQueryControllerStub> {
    private AgentRunQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent run by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agentrun.v1.AgentRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all agent runs with pagination and optional filtering.
     * </pre>
     */
    public void list(ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * </pre>
     */
    public void listBySession(ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * </pre>
     */
    public void subscribe(ai.stigmer.agentic.agentrun.v1.AgentRunId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncServerStreamingCall(
          getChannel().newCall(getSubscribeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public void getArtifactDownloadUrl(ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArtifactDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public void getArtifactContent(ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArtifactContentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public void getRunUsageReport(ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetRunUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public void getSessionUsageReport(ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetSessionUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public void getAgentUsageReport(ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetAgentUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public void getOrgUsageReport(ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOrgUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public void getRunSummary(ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunSummary> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetRunSummaryMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentRunQueryController.
   * <pre>
   * AgentRunQueryController handles read operations for agent runs.
   * </pre>
   */
  public static final class AgentRunQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunQueryControllerBlockingV2Stub> {
    private AgentRunQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun get(ai.stigmer.agentic.agentrun.v1.AgentRunId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all agent runs with pagination and optional filtering.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRunList list(ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRunList listBySession(ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<?, ai.stigmer.agentic.agentrun.v1.AgentRun>
        subscribe(ai.stigmer.agentic.agentrun.v1.AgentRunId request) {
      return io.grpc.stub.ClientCalls.blockingV2ServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse getArtifactDownloadUrl(ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArtifactDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse getArtifactContent(ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArtifactContentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput getRunUsageReport(ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetRunUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput getSessionUsageReport(ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetSessionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput getAgentUsageReport(ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetAgentUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput getOrgUsageReport(ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOrgUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRunSummary getRunSummary(ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetRunSummaryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentRunQueryController.
   * <pre>
   * AgentRunQueryController handles read operations for agent runs.
   * </pre>
   */
  public static final class AgentRunQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunQueryControllerBlockingStub> {
    private AgentRunQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent run by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRun get(ai.stigmer.agentic.agentrun.v1.AgentRunId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all agent runs with pagination and optional filtering.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRunList list(ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRunList listBySession(ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * </pre>
     */
    public java.util.Iterator<ai.stigmer.agentic.agentrun.v1.AgentRun> subscribe(
        ai.stigmer.agentic.agentrun.v1.AgentRunId request) {
      return io.grpc.stub.ClientCalls.blockingServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse getArtifactDownloadUrl(ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArtifactDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse getArtifactContent(ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArtifactContentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput getRunUsageReport(ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetRunUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput getSessionUsageReport(ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetSessionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput getAgentUsageReport(ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetAgentUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput getOrgUsageReport(ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOrgUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public ai.stigmer.agentic.agentrun.v1.AgentRunSummary getRunSummary(ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetRunSummaryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentRunQueryController.
   * <pre>
   * AgentRunQueryController handles read operations for agent runs.
   * </pre>
   */
  public static final class AgentRunQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentRunQueryControllerFutureStub> {
    private AgentRunQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent run by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRun> get(
        ai.stigmer.agentic.agentrun.v1.AgentRunId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all agent runs with pagination and optional filtering.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRunList> list(
        ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRunList> listBySession(
        ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * run. The URL can be used with a simple HTTP GET request without
     * authentication.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse> getArtifactDownloadUrl(
        ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArtifactDownloadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse> getArtifactContent(
        ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArtifactContentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for a single run.
     * Returns aggregated tokens, cost, and per-model breakdown for one run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput> getRunUsageReport(
        ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetRunUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput> getSessionUsageReport(
        ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetSessionUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput> getAgentUsageReport(
        ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetAgentUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput> getOrgUsageReport(
        ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOrgUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent runs.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrun.v1.AgentRunSummary> getRunSummary(
        ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetRunSummaryMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;
  private static final int METHODID_LIST_BY_SESSION = 2;
  private static final int METHODID_SUBSCRIBE = 3;
  private static final int METHODID_GET_ARTIFACT_DOWNLOAD_URL = 4;
  private static final int METHODID_GET_ARTIFACT_CONTENT = 5;
  private static final int METHODID_GET_RUN_USAGE_REPORT = 6;
  private static final int METHODID_GET_SESSION_USAGE_REPORT = 7;
  private static final int METHODID_GET_AGENT_USAGE_REPORT = 8;
  private static final int METHODID_GET_ORG_USAGE_REPORT = 9;
  private static final int METHODID_GET_RUN_SUMMARY = 10;

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
          serviceImpl.get((ai.stigmer.agentic.agentrun.v1.AgentRunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunList>) responseObserver);
          break;
        case METHODID_LIST_BY_SESSION:
          serviceImpl.listBySession((ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunList>) responseObserver);
          break;
        case METHODID_SUBSCRIBE:
          serviceImpl.subscribe((ai.stigmer.agentic.agentrun.v1.AgentRunId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRun>) responseObserver);
          break;
        case METHODID_GET_ARTIFACT_DOWNLOAD_URL:
          serviceImpl.getArtifactDownloadUrl((ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse>) responseObserver);
          break;
        case METHODID_GET_ARTIFACT_CONTENT:
          serviceImpl.getArtifactContent((ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse>) responseObserver);
          break;
        case METHODID_GET_RUN_USAGE_REPORT:
          serviceImpl.getRunUsageReport((ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_SESSION_USAGE_REPORT:
          serviceImpl.getSessionUsageReport((ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_AGENT_USAGE_REPORT:
          serviceImpl.getAgentUsageReport((ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_ORG_USAGE_REPORT:
          serviceImpl.getOrgUsageReport((ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_RUN_SUMMARY:
          serviceImpl.getRunSummary((ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrun.v1.AgentRunSummary>) responseObserver);
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
              ai.stigmer.agentic.agentrun.v1.AgentRunId,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.ListAgentRunsRequest,
              ai.stigmer.agentic.agentrun.v1.AgentRunList>(
                service, METHODID_LIST)))
        .addMethod(
          getListBySessionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.ListAgentRunsBySessionRequest,
              ai.stigmer.agentic.agentrun.v1.AgentRunList>(
                service, METHODID_LIST_BY_SESSION)))
        .addMethod(
          getSubscribeMethod(),
          io.grpc.stub.ServerCalls.asyncServerStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.AgentRunId,
              ai.stigmer.agentic.agentrun.v1.AgentRun>(
                service, METHODID_SUBSCRIBE)))
        .addMethod(
          getGetArtifactDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlRequest,
              ai.stigmer.agentic.agentrun.v1.GetArtifactDownloadUrlResponse>(
                service, METHODID_GET_ARTIFACT_DOWNLOAD_URL)))
        .addMethod(
          getGetArtifactContentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.GetArtifactContentRequest,
              ai.stigmer.agentic.agentrun.v1.GetArtifactContentResponse>(
                service, METHODID_GET_ARTIFACT_CONTENT)))
        .addMethod(
          getGetRunUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.GetRunUsageReportInput,
              ai.stigmer.agentic.agentrun.v1.GetRunUsageReportOutput>(
                service, METHODID_GET_RUN_USAGE_REPORT)))
        .addMethod(
          getGetSessionUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportInput,
              ai.stigmer.agentic.agentrun.v1.GetSessionUsageReportOutput>(
                service, METHODID_GET_SESSION_USAGE_REPORT)))
        .addMethod(
          getGetAgentUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportInput,
              ai.stigmer.agentic.agentrun.v1.GetAgentUsageReportOutput>(
                service, METHODID_GET_AGENT_USAGE_REPORT)))
        .addMethod(
          getGetOrgUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportInput,
              ai.stigmer.agentic.agentrun.v1.GetOrgUsageReportOutput>(
                service, METHODID_GET_ORG_USAGE_REPORT)))
        .addMethod(
          getGetRunSummaryMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrun.v1.GetAgentRunSummaryRequest,
              ai.stigmer.agentic.agentrun.v1.AgentRunSummary>(
                service, METHODID_GET_RUN_SUMMARY)))
        .build();
  }

  private static abstract class AgentRunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentRunQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentrun.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentRunQueryController");
    }
  }

  private static final class AgentRunQueryControllerFileDescriptorSupplier
      extends AgentRunQueryControllerBaseDescriptorSupplier {
    AgentRunQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentRunQueryControllerMethodDescriptorSupplier
      extends AgentRunQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentRunQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentRunQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentRunQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .addMethod(getListBySessionMethod())
              .addMethod(getSubscribeMethod())
              .addMethod(getGetArtifactDownloadUrlMethod())
              .addMethod(getGetArtifactContentMethod())
              .addMethod(getGetRunUsageReportMethod())
              .addMethod(getGetSessionUsageReportMethod())
              .addMethod(getGetAgentUsageReportMethod())
              .addMethod(getGetOrgUsageReportMethod())
              .addMethod(getGetRunSummaryMethod())
              .build();
        }
      }
    }
    return result;
  }
}
