import type { OfflineStorageUsage } from "../domain/offline";
import { OFFLINE_LIMITS } from "./contracts";

const mebibyte = 1024 * 1024;
export function storageCapacity(usedBytes: number, availableDiskBytes?: number, totalDiskBytes?: number): OfflineStorageUsage {
  const used = Number.isSafeInteger(usedBytes) && usedBytes >= 0 ? usedBytes : 0;
  if (availableDiskBytes === undefined || !Number.isFinite(availableDiskBytes) || availableDiskBytes < 0) {
    return { usedBytes: used, availableBytes: Math.max(0, OFFLINE_LIMITS.totalFileBytes - used), capacityBytes: Math.max(used, OFFLINE_LIMITS.totalFileBytes),
      reserveBytes: 0, deviceAvailableBytes: null, capacitySource: "application" };
  }
  const free = Math.floor(availableDiskBytes);
  const proportionalReserve = totalDiskBytes !== undefined && Number.isFinite(totalDiskBytes) && totalDiskBytes > 0 ? Math.ceil(totalDiskBytes * 0.05) : 0;
  const reserveBytes = Math.max(512 * mebibyte, proportionalReserve);
  const availableBytes = Math.max(0, free - reserveBytes);
  return { usedBytes: used, availableBytes, capacityBytes: used + availableBytes, reserveBytes, deviceAvailableBytes: free, capacitySource: "device" };
}

export function storageBytesLabel(bytes: number): string {
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (size >= 1024 * mebibyte) return `${(size / (1024 * mebibyte)).toFixed(1)} GiB`;
  if (size >= mebibyte) return `${(size / mebibyte).toFixed(1)} MiB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KiB`;
  return `${Math.ceil(size)} B`;
}