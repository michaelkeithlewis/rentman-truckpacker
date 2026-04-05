import "dotenv/config";

export const config = {
  rentman: {
    baseUrl: "https://api.rentman.net",
    token: process.env.RENTMAN_API_TOKEN ?? "",
  },
  truckpacker: {
    baseUrl: "https://steady-beagle-345.convex.site/api/v1",
    apiKey: process.env.TRUCKPACKER_API_KEY ?? "",
  },
  defaultContainerId: process.env.TRUCKPACKER_DEFAULT_CONTAINER_ID,
} as const;

export function validateConfig() {
  const missing: string[] = [];
  if (!config.rentman.token) missing.push("RENTMAN_API_TOKEN");
  if (!config.truckpacker.apiKey) missing.push("TRUCKPACKER_API_KEY");
  if (missing.length > 0) {
    console.error(
      `\nMissing required environment variables: ${missing.join(", ")}\n` +
        `Copy .env.example to .env and fill in your API keys.\n`
    );
    process.exit(1);
  }
}
