import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Chừa phần dư cho multipart; file thực tế được giới hạn 50 MB trong action.
    serverActions: { bodySizeLimit: "64mb" },
  },
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
