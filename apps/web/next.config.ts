import type { NextConfig } from "next";

const apiRewriteBaseUrl = (
  process.env.API_REWRITE_BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://api:4000"
    : "http://127.0.0.1:4000")
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@ai-bcc/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiRewriteBaseUrl}/api/:path*`,
      },
    ];
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });
    return config;
  },
    
    turbopack: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
  
};

export default nextConfig;
