/**
 * PaymentMethodCard: the card a plan's invoices are charged to. With none on
 * file it says a saved card is needed to subscribe and offers to add one,
 * refused while the account is suspended; with one on file it names the
 * card and opens the portal to manage it.
 */
import { create } from "@bufbuild/protobuf";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentMethodSummarySchema } from "@stigmer/apis/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/apis/ai/stigmer/billing/v1/enum_pb";

import { PaymentMethodCard } from "../PaymentMethodCard";

afterEach(cleanup);

describe("PaymentMethodCard", () => {
  it("with no card, says one is needed to subscribe and adds one", () => {
    const onAdd = vi.fn();
    render(
      <PaymentMethodCard
        accountStatus={BillingAccountStatus.billing_account_active}
        onManage={() => {}}
        onAdd={onAdd}
      />,
    );
    expect(
      screen.getByText(
        /No payment method on file\. A saved card is needed to subscribe to a plan/,
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add payment method" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("refuses to add a card while the account is suspended", () => {
    render(
      <PaymentMethodCard
        accountStatus={BillingAccountStatus.billing_account_suspended}
        onManage={() => {}}
        onAdd={() => {}}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Add payment method",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("names the card on file and opens the portal to manage it", () => {
    const onManage = vi.fn();
    const { container } = render(
      <PaymentMethodCard
        paymentMethod={create(PaymentMethodSummarySchema, {
          paymentMethodId: "pm_1",
          brand: "visa",
          last4: "4242",
          expMonth: 3,
          expYear: 2031,
        })}
        accountStatus={BillingAccountStatus.billing_account_active}
        onManage={onManage}
      />,
    );
    expect(container.textContent).toMatch(/Visa.*4242.*Expires 03\/31/);
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    expect(onManage).toHaveBeenCalledOnce();
  });
});
