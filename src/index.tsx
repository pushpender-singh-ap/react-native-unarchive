import Unarchive from './NativeUnarchive';
import type {
  UnarchiveResult,
  FileInfo,
  CancelResult,
} from './NativeUnarchive';

export function multiply(a: number, b: number): number {
  return Unarchive.multiply(a, b);
}

export function unarchive(
  archivePath: string,
  outputPath: string
): Promise<UnarchiveResult> {
  return Unarchive.unarchive(archivePath, outputPath);
}

/**
 * Cancel an ongoing extraction operation
 * @returns Promise that resolves when cancellation is complete
 */
export function cancelUnarchive(): Promise<CancelResult> {
  return Unarchive.cancelUnarchive();
}

// Export types for consumers
export type { UnarchiveResult, FileInfo, CancelResult };
