import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { BillingSection } from "@stigmer/react";

export default function BillingPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const checkoutSuccess = useMemo(
    () => searchParams.get("checkout") === "success",
    [searchParams],
  );

  const handleDismiss = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <BillingSection
      checkoutSuccess={checkoutSuccess}
      onDismissCheckoutSuccess={handleDismiss}
    />
  );
}
