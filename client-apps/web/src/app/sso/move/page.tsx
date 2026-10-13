import { Suspense } from "react";
import { AccessMovePage } from "@/domain/access-move/AccessMovePage";

export default function AccessMoveRoute() {
  return (
    <Suspense>
      <AccessMovePage />
    </Suspense>
  );
}
