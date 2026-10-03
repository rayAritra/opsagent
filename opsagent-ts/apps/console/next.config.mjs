export default {
  devIndicators: false,
  transpilePackages: ["@opsagent/db", "@opsagent/core"],
  serverExternalPackages: ["pg", "pg-boss", "playwright", "unpdf"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};
