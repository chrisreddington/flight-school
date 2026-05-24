import type { NextConfig } from "next";

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
  // Next 16 dynamic-IO model: every server fetch must be either explicitly
  // uncached (no-store) or tagged for revalidation. Enforced by
  // scripts/check-server-fetch-tenancy.mjs at CI time.
  cacheComponents: true,
  // Keep copilot-sdk as a server-only external — it uses import.meta.resolve
  // internally which Turbopack cannot handle when bundling.
  serverExternalPackages: ['@github/copilot-sdk'],
};

export default nextConfig;
