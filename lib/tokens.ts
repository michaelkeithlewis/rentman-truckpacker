import type { ProviderId } from "./providers/types";

export function activeProvider(req: Request): ProviderId {
  const header = req.headers.get("x-active-provider");
  if (header === "currentrms") return "currentrms";
  return "rentman";
}

export function sourceToken(req: Request): string {
  const provider = activeProvider(req);
  if (provider === "currentrms") {
    return (
      req.headers.get("x-currentrms-token") ||
      process.env.CURRENTRMS_API_TOKEN ||
      ""
    );
  }
  return (
    req.headers.get("x-rentman-token") ||
    process.env.RENTMAN_API_TOKEN ||
    ""
  );
}

export function rentmanToken(req: Request): string {
  return (
    req.headers.get("x-rentman-token") ||
    process.env.RENTMAN_API_TOKEN ||
    ""
  );
}

export function truckpackerKey(req: Request): string {
  return (
    req.headers.get("x-truckpacker-key") ||
    process.env.TRUCKPACKER_API_KEY ||
    ""
  );
}
