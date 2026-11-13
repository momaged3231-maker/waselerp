/** @type {import('next').NextConfig} */
const nextConfig = {
  // SPA mode: fully client-rendered, exported as static files.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000/api',
  },
};

export default nextConfig;
