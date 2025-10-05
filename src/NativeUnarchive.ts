import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface FileInfo {
  path: string;
  name: string;
  relativePath: string;
  size: number;
}

export interface UnarchiveResult {
  files: FileInfo[];
  outputPath: string;
}

export interface CancelResult {
  cancelled: boolean;
}

export interface Spec extends TurboModule {
  multiply(a: number, b: number): number;
  unarchive(archivePath: string, outputPath: string): Promise<UnarchiveResult>;
  cancelUnarchive(): Promise<CancelResult>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Unarchive');
