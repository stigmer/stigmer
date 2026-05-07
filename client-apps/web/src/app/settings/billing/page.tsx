"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { BillingSection } from "@stigmer/react";

export default function BillingPage() {
  const searchParams = useSearchParams();

  const checkoutSuccess = useMemo(
    () => searchParams.get("checkout") === "success",
    [searchParams],
  );

  const handleDismiss = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", url.pathname);
  }, []);

  return (
    <BillingSection
      checkoutSuccess={checkoutSuccess}
      onDismissCheckoutSuccess={handleDismiss}
    />
  );
}
