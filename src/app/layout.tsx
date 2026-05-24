import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Flight School",
  description: "AI-powered developer learning platform - master coding with your AI copilot through personalized challenges and guided practice",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ErrorBoundary>
          {/* Suspense boundary required by Next 16 cacheComponents: providers
              use usePathname() (dynamic IO), so the whole interactive shell
              must render below a boundary. */}
          <Suspense fallback={null}>
            <Providers>{children}</Providers>
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  );
}
