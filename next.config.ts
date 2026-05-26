import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  turbopack: {
    root: process.cwd(),
  },
  reactStrictMode: true,
  devIndicators: false,
  compiler: {
    styledComponents: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        pathname: '/**',
      },
    ],
  },
  // Optimize production bundle
  productionBrowserSourceMaps: false,
  // React Compiler auto-memoises components, removing the need for most
  // manual useMemo / useCallback / React.memo wrappers.
  reactCompiler: true,
  // Enable experimental optimizations
  experimental: {
    // Optimize package imports - reduces bundle size by tree-shaking
    optimizePackageImports: ['@primer/react', '@primer/octicons-react', 'react-markdown', 'react-syntax-highlighter'],
  },
  // Next 16 dynamic-IO model (Partial Prerender). Temporarily disabled:
  // Next 16.2.6 has an unresolved InvariantError ("Expected
  // workUnitAsyncStorage to have a store") that fires during the static
  // prerender pass for client-component pages in this app (`/`, `/sign-in`).
  // The error is upstream — stack lands on Next's ignore-listed frames with
  // the literal "This is a bug in Next.js" message — and our ErrorBoundary
  // catches it as a real render failure, blocking the UX. Re-enable when we
  // upgrade to a Next release that ships a fix.
  // The `scripts/check-server-fetch-tenancy.mjs` CI guard continues to
  // enforce the no-untagged-fetch rule independently of this flag.
  // cacheComponents: true,
  // Keep `@github/copilot-sdk` as a server-only external. The package uses
  // `import.meta.resolve` internally which Turbopack cannot handle, and we
  // never want it bundled into the web image — runtime fail-loud net: if
  // a future code path slips a `require('@github/copilot-sdk')` through
  // every static gate (`scripts/check-copilot-sdk-boundary.mjs`,
  // `scripts/check-web-image-copilot-free.mjs`), startup will crash with
  // "Cannot find module" instead of silently double-executing SDK logic
  // in the web container.
  serverExternalPackages: ['@github/copilot-sdk'],
};

export default nextConfig;
