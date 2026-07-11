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
  async headers() {
    return [
      {
        source: "/command-center/:viewerPath(brief|group-report-mobile)",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
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
      // Keep the viewBox attribute so icons sized via CSS (h-5 w-5, etc.)
      // don't get clipped — SVGR's default SVGO removes viewBox when
      // width/height are present, which breaks responsive sizing.
      use: [
        {
          loader: "@svgr/webpack",
          options: {
            svgo: true,
            svgoConfig: {
              plugins: [
                {
                  name: "preset-default",
                  params: { overrides: { removeViewBox: false } },
                },
              ],
            },
          },
        },
      ],
    });
    return config;
  },

  turbopack: {
    rules: {
      "*.svg": {
        loaders: [
          {
            loader: "@svgr/webpack",
            options: {
              svgo: true,
              svgoConfig: {
                plugins: [
                  {
                    name: "preset-default",
                    params: { overrides: { removeViewBox: false } },
                  },
                ],
              },
            },
          },
        ],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
