/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // The in-app Knowledge base: markdown article files import as raw strings
    // (src/content/docs/**/*.md), rendered by the docs renderer.
    config.module.rules.push({ test: /\.md$/, type: "asset/source" });
    return config;
  },
  async rewrites() {
    // Proxy /api/* to the NestJS core in dev so the portal and API share an origin.
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api";
    const base = api.replace(/\/api$/, "");
    return [{ source: "/api/:path*", destination: `${base}/api/:path*` }];
  },
};

export default nextConfig;
