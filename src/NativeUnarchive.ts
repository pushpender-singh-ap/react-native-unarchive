import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface FileInfo {
  path: string;
  name: string;
  size: number;
}

export interface UnarchiveResult {
  files: FileInfo[];
  outputPath: string;
}

export interface Spec extends TurboModule {
  multiply(a: number, b: number): number;
  unarchive(archivePath: string, outputPath: string): Promise<UnarchiveResult>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Unarchive');
