import type { Buffer } from "node:buffer";
export type FileMetadata = {
  path: string;
  bytes: number;
  revision: string;
  oversized: boolean;
};
export function metadataSafe(root: string, name: string): Promise<FileMetadata>;
export function loadContent(
  root: string,
  name: string,
): Promise<Omit<FileMetadata, "bytes"> & { bytes: Buffer; sha256: string }>;
export const LOCAL_PAGE_SIZE: number;
export const CONTENT_LIMIT: number;
