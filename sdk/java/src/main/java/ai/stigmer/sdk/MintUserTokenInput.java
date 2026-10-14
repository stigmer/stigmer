package ai.stigmer.sdk;

/**
 * Input for {@link TokenClient#mintUserToken}: the organization a user token
 * is for and the person it is minted for.
 *
 * <p>The product's backend builds it from the person it has signed in.
 * Stigmer resolves (or, on first sign-in, creates) that person's identity
 * account in the organization and returns a token that works there only.
 * The organization and the user id are required; the email and name are
 * used only when the account is created.
 *
 * <pre>{@code
 * MintUserTokenInput input = MintUserTokenInput.builder()
 *     .org("acme")
 *     .userId("user-123")
 *     .userEmail("jane@acme.com")
 *     .userName("Jane Doe")
 *     .build();
 * }</pre>
 */
public final class MintUserTokenInput {

    private final String org;
    private final String userId;
    private final String userEmail;
    private final String userName;

    private MintUserTokenInput(Builder builder) {
        this.org = builder.org;
        this.userId = builder.userId;
        this.userEmail = builder.userEmail;
        this.userName = builder.userName;
    }

    /**
     * The organization the token is for, by id or slug: the minting service
     * account's organization or one of its child organizations (required).
     */
    public String org() { return org; }

    /**
     * The product's stable identifier for the person (required). With the
     * organization it names one identity account; it must not contain '|'.
     */
    public String userId() { return userId; }

    /** The person's email address, used when the account is created; empty when not set. */
    public String userEmail() { return userEmail; }

    /** The person's display name, used when the account is created; empty when not set. */
    public String userName() { return userName; }

    /** Creates a new builder. */
    public static Builder builder() { return new Builder(); }

    /** Builder for {@link MintUserTokenInput}. */
    public static final class Builder {
        private String org = "";
        private String userId = "";
        private String userEmail = "";
        private String userName = "";

        private Builder() {}

        /** Sets the organization the token is for, by id or slug (required). */
        public Builder org(String org) { this.org = org; return this; }

        /** Sets the product's stable identifier for the person (required). */
        public Builder userId(String userId) { this.userId = userId; return this; }

        /** Sets the person's email address; a null leaves it empty. */
        public Builder userEmail(String userEmail) { this.userEmail = userEmail == null ? "" : userEmail; return this; }

        /** Sets the person's display name; a null leaves it empty. */
        public Builder userName(String userName) { this.userName = userName == null ? "" : userName; return this; }

        /**
         * Builds the input. A missing organization or user id is refused by
         * {@link TokenClient#mintUserToken}, before any request is sent.
         */
        public MintUserTokenInput build() { return new MintUserTokenInput(this); }
    }
}
