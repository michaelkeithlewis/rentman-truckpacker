/**
 * When a rental project has no vehicle (or no usable dimensions), we still
 * need a plausible cargo box for smart-packing and a visible container in TP.
 *
 * Dims are **cm**, matching Rentman’s vehicle API (length → pack X depth,
 * width → floor width / smart-pack Z, height → interior height / smart-pack Y).
 *
 * ~20' interior length, ~96" x ~90" cross-section (typical box truck).
 */
export const DEFAULT_RENTMAN_VEHICLE_ID = 0;

export const DEFAULT_BOX_TRUCK_CM = {
  length: 610,
  width: 244,
  height: 229,
} as const;

export const DEFAULT_BOX_TRUCK_LABEL = "20' box truck (default)";

export interface BoxTruckLike {
  id: number;
  name: string;
  displayname: string;
  length: number;
  width: number;
  height: number;
  payload_capacity: number;
}

export function getDefaultBoxTruck(): BoxTruckLike {
  return {
    id: DEFAULT_RENTMAN_VEHICLE_ID,
    name: DEFAULT_BOX_TRUCK_LABEL,
    displayname: DEFAULT_BOX_TRUCK_LABEL,
    length: DEFAULT_BOX_TRUCK_CM.length,
    width: DEFAULT_BOX_TRUCK_CM.width,
    height: DEFAULT_BOX_TRUCK_CM.height,
    payload_capacity: 0,
  };
}

/** Interior floor width (Z) and stacking height (Y) for smart-pack, in metres. */
export function defaultSmartPackInteriorM(): { width: number; height: number } {
  return {
    width: DEFAULT_BOX_TRUCK_CM.width * 0.01,
    height: DEFAULT_BOX_TRUCK_CM.height * 0.01,
  };
}
