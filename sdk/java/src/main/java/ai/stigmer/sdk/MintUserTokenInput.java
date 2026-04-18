package ai.stigmer.sdk;

/**
 * Input for minting a user-scoped Stigmer JWT.
 *
 * <p>The platform builder's backend calls this with the authenticated
 * user's identity. Stigmer validates the PlatformClient credentials,
 * optionally JIT-provisions the user's identity account, and returns
 * a signed JWT.
 *
 * <pre>{@code
 * MintUserTokenInput input = MintUserTokenInput.builder()
 *     .userId("user-123")
 *     .userEmail("jane@acme.com")
 *     .userName("Jane Doe")
 *     .build();
 * }</pre>
 */
public final class MintUserTokenInput {

    private final String userId;
    private final String userEmail;
    private final String userName;
    private final String orgId;

    private MintUserTokenInput(Builder builder) {
        this.userId = builder.userId;
        this.userEmail = builder.userEmail;
        this.userName = builder.userName;
        this.orgId = builder.orgId;
    }

    /** Platform's stable user identifier. Becomes the JWT sub claim. */
    public String userId() { return userId; }

    /** User's email address. Used for profile enrichment during JIT provisioning. */
    public String userEmail() { return userEmail; }

    /** User's display name. Used for profile enrichment during JIT provisioning. */
    public String userName() { return userName; }

    /** Organization to scope the token to. Defaults to the PlatformClient's owning org. */
    public String orgId() { return orgId; }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String userId;
        private String userEmail = "";
        private String userName = "";
        private String orgId = "";

        private Builder() {}

        public Builder userId(String userId) { this.userId = userId; return this; }
        public Builder userEmail(String userEmail) { this.userEmail = userEmail; return this; }
        public Builder userName(String userName) { this.userName = userName; return this; }
        public Builder orgId(String orgId) { this.orgId = orgId; return this; }

        public MintUserTokenInput build() { return new MintUserTokenInput(this); }
    }
}
