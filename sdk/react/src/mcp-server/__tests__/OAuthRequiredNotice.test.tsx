import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OAuthRequiredNotice } from "../OAuthRequiredNotice";

afterEach(cleanup);

describe("OAuthRequiredNotice", () => {
  it("renders the OAuth-required caveat when oauth_only is true", () => {
    render(<OAuthRequiredNotice oauthOnly={true} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/requires OAuth/i)).toBeTruthy();
    // It explains why manual entry is gone, not just that OAuth is used.
    expect(screen.getByText(/rejects manually-entered API tokens/i)).toBeTruthy();
  });

  it("renders nothing when oauth_only is false", () => {
    const { container } = render(<OAuthRequiredNotice oauthOnly={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when oauth_only is undefined", () => {
    const { container } = render(<OAuthRequiredNotice oauthOnly={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
