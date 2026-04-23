"use client";

import { Suspense } from "react";
import { LoginPageView, LoginSkeleton } from "@/auth/login/LoginPageView";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginPageView />
    </Suspense>
  );
}
