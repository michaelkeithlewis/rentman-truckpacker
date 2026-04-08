import type { Provider, ProviderId } from "./types";
import { rentmanProvider } from "./rentman";
import { currentrmsProvider } from "./currentrms";
import { flexProvider } from "./flex";

const providers: Record<ProviderId, Provider> = {
  rentman: rentmanProvider,
  currentrms: currentrmsProvider,
  flex: flexProvider,
};

export function getProvider(id: ProviderId): Provider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export function allProviders(): Provider[] {
  return Object.values(providers);
}

export { rentmanProvider, currentrmsProvider };
export type { Provider, ProviderId, ProviderEquipment } from "./types";
export { makeStamp, parseStamp } from "./types";
export type { SyncStatus, SyncedItem } from "./types";
