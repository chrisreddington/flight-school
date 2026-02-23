import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  // Enable experimental optimizations
  experimental: {
    // Optimize package imports - reduces bundle size by tree-shaking
    optimizePackageImports: ['@primer/react', '@primer/octicons-react', 'react-markdown', 'react-syntax-highlighter'],
  },
  // Keep copilot-sdk as a server-only external — it uses import.meta.resolve
  // internally which Turbopack cannot handle when bundling.
  serverExternalPackages: ['@github/copilot-sdk'],
};

export default nextConfig;
