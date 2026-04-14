/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 's-maxage=1800, stale-while-revalidate=3600' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
