import type { NextConfig } from "next";

const nextConfig: NextConfig = {
   cacheHandlers: {
      default: require.resolve("./src/lib/cache/cache-handler.cjs"),
      remote: require.resolve("./src/lib/cache/cache-handler.cjs"),
    },
};

export default nextConfig;
