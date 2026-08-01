import { Suspense } from "react";
import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  // SignInForm reads `?next=` to resume a gated action — useSearchParams needs
  // a Suspense boundary or the page can't be statically prerendered.
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
