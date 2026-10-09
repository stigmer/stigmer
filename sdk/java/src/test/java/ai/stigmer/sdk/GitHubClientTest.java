package ai.stigmer.sdk;

import ai.stigmer.platform.github.v1.GetGitHubFileContentInput;
import ai.stigmer.platform.github.v1.GetGitHubTreeInput;
import ai.stigmer.platform.github.v1.GitHubBranchList;
import ai.stigmer.platform.github.v1.GitHubFileContent;
import ai.stigmer.platform.github.v1.GitHubQueryControllerGrpc;
import ai.stigmer.platform.github.v1.GitHubRepository;
import ai.stigmer.platform.github.v1.GitHubRepositoryList;
import ai.stigmer.platform.github.v1.GitHubTree;
import ai.stigmer.platform.github.v1.GitHubTreeEntry;
import ai.stigmer.platform.github.v1.ListGitHubBranchesInput;
import ai.stigmer.platform.github.v1.ListGitHubRepositoriesInput;
import ai.stigmer.platform.github.v1.SearchGitHubRepositoriesInput;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.protobuf.ByteString;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins what GitHubClient sends and hands back. Each repository read carries its organization and arguments to
 * GitHubQueryController and returns the server's answer as it came, and a
 * refusal (the "connect GitHub first" precondition) reaches the caller as a
 * StigmerException carrying its code. A real gRPC server captures the
 * requests.
 */
@DisplayName("GitHubClient")
class GitHubClientTest {

    private static final String ORG = "acme";
    private static final String OWNER = "acme";
    private static final String REPO = "app";

    private final List<ListGitHubRepositoriesInput> listRequests = new ArrayList<>();
    private final List<SearchGitHubRepositoriesInput> searchRequests = new ArrayList<>();
    private final List<ListGitHubBranchesInput> branchRequests = new ArrayList<>();
    private final List<GetGitHubTreeInput> treeRequests = new ArrayList<>();
    private final List<GetGitHubFileContentInput> fileRequests = new ArrayList<>();
    private volatile boolean refuseReads;
    private Server grpcServer;
    private ManagedChannel channel;

    /** Answers each repository read with a fixed reply, or refuses it when {@code refuseReads} is set. */
    private final class FakeGitHubQuery extends GitHubQueryControllerGrpc.GitHubQueryControllerImplBase {
        private boolean refused(StreamObserver<?> responseObserver) {
            if (refuseReads) {
                responseObserver.onError(Status.FAILED_PRECONDITION
                        .withDescription("connect GitHub first")
                        .asRuntimeException());
            }
            return refuseReads;
        }

        @Override
        public void listRepositories(
                ListGitHubRepositoriesInput request,
                StreamObserver<GitHubRepositoryList> responseObserver) {
            if (refused(responseObserver)) {
                return;
            }
            listRequests.add(request);
            responseObserver.onNext(GitHubRepositoryList.newBuilder()
                    .addRepositories(GitHubRepository.newBuilder()
                            .setId(42)
                            .setFullName("acme/app")
                            .setName("app")
                            .setOwner("acme")
                            .setOwnerIsOrganization(true)
                            .setHtmlUrl("https://github.com/acme/app")
                            .setCloneUrl("https://github.com/acme/app.git")
                            .setDefaultBranch("main")
                            .setIsPrivate(true)
                            .setUpdatedAt("2026-10-01T12:00:00Z"))
                    .setHasMore(true)
                    .build());
            responseObserver.onCompleted();
        }

        @Override
        public void searchRepositories(
                SearchGitHubRepositoriesInput request,
                StreamObserver<GitHubRepositoryList> responseObserver) {
            if (refused(responseObserver)) {
                return;
            }
            searchRequests.add(request);
            responseObserver.onNext(GitHubRepositoryList.newBuilder()
                    .addRepositories(GitHubRepository.newBuilder()
                            .setFullName("acme/app-api").setName("app-api").setOwner("acme"))
                    .build());
            responseObserver.onCompleted();
        }

        @Override
        public void listBranches(
                ListGitHubBranchesInput request,
                StreamObserver<GitHubBranchList> responseObserver) {
            if (refused(responseObserver)) {
                return;
            }
            branchRequests.add(request);
            responseObserver.onNext(GitHubBranchList.newBuilder()
                    .addNames("main").addNames("dev").build());
            responseObserver.onCompleted();
        }

        @Override
        public void getTree(GetGitHubTreeInput request, StreamObserver<GitHubTree> responseObserver) {
            if (refused(responseObserver)) {
                return;
            }
            treeRequests.add(request);
            responseObserver.onNext(GitHubTree.newBuilder()
                    .addEntries(GitHubTreeEntry.newBuilder().setPath("src").setIsDirectory(true))
                    .addEntries(GitHubTreeEntry.newBuilder().setPath("src/Main.java").setSize(120))
                    .setTruncated(true)
                    .build());
            responseObserver.onCompleted();
        }

        @Override
        public void getFileContent(
                GetGitHubFileContentInput request,
                StreamObserver<GitHubFileContent> responseObserver) {
            if (refused(responseObserver)) {
                return;
            }
            fileRequests.add(request);
            GitHubFileContent reply = "big.bin".equals(request.getPath())
                    ? GitHubFileContent.newBuilder().setSize(11L << 20).setTooLarge(true).build()
                    : GitHubFileContent.newBuilder()
                            .setContent(ByteString.copyFromUtf8("hello")).setSize(5).build();
            responseObserver.onNext(reply);
            responseObserver.onCompleted();
        }
    }

    @BeforeEach
    void start() throws Exception {
        grpcServer = NettyServerBuilder.forPort(0)
                .addService(new FakeGitHubQuery())
                .build()
                .start();
        channel = ManagedChannelBuilder.forTarget("localhost:" + grpcServer.getPort())
                .usePlaintext()
                .build();
    }

    @AfterEach
    void stop() throws Exception {
        channel.shutdownNow();
        channel.awaitTermination(5, TimeUnit.SECONDS);
        grpcServer.shutdownNow();
        grpcServer.awaitTermination(5, TimeUnit.SECONDS);
    }

    @Test
    @DisplayName("listing repositories carries the organization and page and returns the page as served")
    void listRepositoriesSendsOrgAndPage() {
        GitHubRepositoryList list = new GitHubClient(channel).listRepositories(ORG, 2);

        assertEquals(1, listRequests.size());
        assertEquals(ORG, listRequests.get(0).getOrg());
        assertEquals(2, listRequests.get(0).getPage());
        assertTrue(list.getHasMore());
        assertEquals(1, list.getRepositoriesCount());
        GitHubRepository repo = list.getRepositories(0);
        assertEquals(42, repo.getId());
        assertEquals("acme/app", repo.getFullName());
        assertEquals("app", repo.getName());
        assertEquals("acme", repo.getOwner());
        assertTrue(repo.getOwnerIsOrganization());
        assertEquals("https://github.com/acme/app", repo.getHtmlUrl());
        assertEquals("https://github.com/acme/app.git", repo.getCloneUrl());
        assertEquals("main", repo.getDefaultBranch());
        assertTrue(repo.getIsPrivate());
        assertEquals("2026-10-01T12:00:00Z", repo.getUpdatedAt());
    }

    @Test
    @DisplayName("searching repositories carries the organization, query and page")
    void searchRepositoriesSendsOrgQueryAndPage() {
        GitHubRepositoryList list = new GitHubClient(channel).searchRepositories(ORG, "app", 3);

        assertEquals(1, searchRequests.size());
        SearchGitHubRepositoriesInput req = searchRequests.get(0);
        assertEquals(ORG, req.getOrg());
        assertEquals("app", req.getQuery());
        assertEquals(3, req.getPage());
        assertFalse(list.getHasMore());
        assertEquals("acme/app-api", list.getRepositories(0).getFullName());
    }

    @Test
    @DisplayName("listing branches carries the organization, owner and repository and returns the names")
    void listBranchesSendsRepo() {
        List<String> names = new GitHubClient(channel).listBranches(ORG, OWNER, REPO);

        assertEquals(1, branchRequests.size());
        ListGitHubBranchesInput req = branchRequests.get(0);
        assertEquals(ORG, req.getOrg());
        assertEquals(OWNER, req.getOwner());
        assertEquals(REPO, req.getRepo());
        assertEquals(List.of("main", "dev"), names);
    }

    @Test
    @DisplayName("reading a tree carries the repository and ref and returns every entry")
    void getTreeSendsRepoAndRef() {
        GitHubTree tree = new GitHubClient(channel).getTree(ORG, OWNER, REPO, "dev");

        assertEquals(1, treeRequests.size());
        GetGitHubTreeInput req = treeRequests.get(0);
        assertEquals(ORG, req.getOrg());
        assertEquals(OWNER, req.getOwner());
        assertEquals(REPO, req.getRepo());
        assertEquals("dev", req.getRef());
        assertTrue(tree.getTruncated());
        assertEquals(2, tree.getEntriesCount());
        assertEquals("src", tree.getEntries(0).getPath());
        assertTrue(tree.getEntries(0).getIsDirectory());
        assertEquals("src/Main.java", tree.getEntries(1).getPath());
        assertFalse(tree.getEntries(1).getIsDirectory());
        assertEquals(120, tree.getEntries(1).getSize());
    }

    @Test
    @DisplayName("reading a file carries the repository, ref and path and returns its bytes")
    void getFileContentSendsRepoRefAndPath() {
        GitHubFileContent file = new GitHubClient(channel).getFileContent(ORG, OWNER, REPO, "main", "README.md");

        assertEquals(1, fileRequests.size());
        GetGitHubFileContentInput req = fileRequests.get(0);
        assertEquals(ORG, req.getOrg());
        assertEquals(OWNER, req.getOwner());
        assertEquals(REPO, req.getRepo());
        assertEquals("main", req.getRef());
        assertEquals("README.md", req.getPath());
        assertEquals("hello", file.getContent().toStringUtf8());
        assertEquals(5, file.getSize());
        assertFalse(file.getTooLarge());
    }

    @Test
    @DisplayName("a file above the ceiling comes back too large, sized, with no content")
    void getFileContentTooLarge() {
        GitHubFileContent file = new GitHubClient(channel).getFileContent(ORG, OWNER, REPO, "main", "big.bin");

        assertTrue(file.getTooLarge());
        assertTrue(file.getContent().isEmpty());
        assertEquals(11L << 20, file.getSize());
    }

    @Test
    @DisplayName("a refused repository read surfaces as a StigmerException with its code")
    void readRefusalSurfacesAsStigmerException() {
        refuseReads = true;
        GitHubClient client = new GitHubClient(channel);
        Map<String, Executable> reads = new LinkedHashMap<>();
        reads.put("listRepositories", () -> client.listRepositories(ORG, 1));
        reads.put("searchRepositories", () -> client.searchRepositories(ORG, "q", 1));
        reads.put("listBranches", () -> client.listBranches(ORG, OWNER, REPO));
        reads.put("getTree", () -> client.getTree(ORG, OWNER, REPO, "main"));
        reads.put("getFileContent", () -> client.getFileContent(ORG, OWNER, REPO, "main", "a"));

        reads.forEach((name, read) -> {
            StigmerException e = assertThrows(StigmerException.class, read, name);
            assertEquals(ErrorCode.FAILED_PRECONDITION, e.getCode(), name);
            assertEquals(Status.Code.FAILED_PRECONDITION, e.getGrpcCode(), name);
        });
    }
}
