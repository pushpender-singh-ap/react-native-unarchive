import Unarchive from './NativeUnarchive';
import type { UnarchiveResult, FileInfo } from './NativeUnarchive';

export function multiply(a: number, b: number): number {
  return Unarchive.multiply(a, b);
}

export function unarchive(
  archivePath: string,
  outputPath: string
): Promise<UnarchiveResult> {
  return Unarchive.unarchive(archivePath, outputPath);
}

// Export types for consumers
export type { UnarchiveResult, FileInfo };
