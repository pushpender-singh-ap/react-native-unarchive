# React Native Unarchive

An Archive Extraction Library for React Native Projects.

For React Native developers that need to extract RAR, ZIP, CBR and CBZ files in their apps, this package is a useful resource. It supports React Native's new Turbo Module architecture and was created in Kotlin and Objective-C++.

With this package, users can quickly and easily extract RAR, ZIP, CBR and CBZ archives and other compressed files using their device's native capabilities. Using this package, multiple archive formats can be processed, and it is simple to integrate into existing projects.

If you want to provide your React Native app the ability to read and extract RAR, ZIP, CBR, CBZ files, you should definitely give this package some thought.

## Features

- **Cross-platform support**: Works on both Android and iOS
- **Multiple archive formats**: Supports CBR, RAR, ZIP and CBZ files
- **TypeScript support**: Full TypeScript definitions included
- **Document picker integration**: Easy integration with document pickers
- **File system compatibility**: Works with React Native File System libraries
- **Turbo Module**: Built using React Native's new architecture
- **Thread-safe**: Prevents concurrent extractions with busy-state checking
- **Atomic extraction**: Safe extraction with atomic directory replacement
- **Security hardened**: ZIP-SLIP protection prevents directory traversal attacks
- **Relative path preservation**: Maintains directory structure from archives
- **Debug diagnostics**: Comprehensive logging in debug builds

## Installation

### NPM/Yarn

```bash
npm install react-native-unarchive
# or
yarn add react-native-unarchive
```

Then run:

```bash
cd ios && pod install
```

### React Native Version Compatibility

- React Native 0.80+
- New Architecture (Turbo Modules) supported
- iOS min version 16.0+

## Usage

### Basic Usage

```typescript
import { unarchive, type UnarchiveResult } from 'react-native-unarchive';
import { DocumentDirectoryPath } from '@dr.pogodin/react-native-fs';

const extractArchive = async () => {
  try {
    const archivePath = '/path/to/your/archive.cbr'; // or .cbz
    // IMPORTANT: outputPath must be within app sandbox (Documents/Caches/tmp)
    const outputPath = `${DocumentDirectoryPath}/extracted`;
    
    const result: UnarchiveResult = await unarchive(archivePath, outputPath);
    
    console.log('Extraction completed!');
    console.log('Output path:', result.outputPath);
    console.log('Extracted files:', result.files);
    
    // Access individual files
    result.files.forEach((file) => {
      console.log(`File: ${file.name}, Size: ${file.size}, Path: ${file.path}`);
      console.log(`  Relative path in archive: ${file.relativePath}`);
    });
  } catch (error) {
    console.error('Extraction failed:', error);
  }
};
```

### With Document Picker

```typescript
import React, { useState } from 'react';
import { Alert } from 'react-native';
import { unarchive, type FileInfo } from 'react-native-unarchive';
import { pick } from '@react-native-documents/picker';
import { DocumentDirectoryPath, copyFile } from '@dr.pogodin/react-native-fs';

const ComicReader = () => {
  const [extractedFiles, setExtractedFiles] = useState<FileInfo[]>([]);

  const selectAndExtractArchive = async () => {
    try {
      // Pick archive file
      const result = await pick({
        type: ['application/zip', 'application/x-rar-compressed'],
      });

      if (result && result.length > 0) {
        const selectedFile = result[0];
        
        // For Android content URIs, copy to accessible location first
        const archivePath = selectedFile.uri.startsWith('content://')
          ? `${DocumentDirectoryPath}/temp_archive${selectedFile.name}`
          : selectedFile.uri;

        if (selectedFile.uri.startsWith('content://')) {
          await copyFile(selectedFile.uri, archivePath);
        }

        // Extract archive
        const outputPath = `${DocumentDirectoryPath}/comics/${Date.now()}`;
        const extractResult = await unarchive(archivePath, outputPath);
        
        setExtractedFiles(extractResult.files);
        Alert.alert('Success', `Extracted ${extractResult.files.length} files`);
      }
    } catch (error) {
      Alert.alert('Error', `Failed to extract archive: ${error.message}`);
    }
  };

  return (
    // Your component JSX
  );
};
```

### Displaying Images

```typescript
import React from 'react';
import { Image, FlatList } from 'react-native';
import { type FileInfo } from 'react-native-unarchive';

interface ComicViewerProps {
  files: FileInfo[];
}

const ComicViewer: React.FC<ComicViewerProps> = ({ files }) => {
  // Filter for image files
  const imageFiles = files.filter(file => 
    /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(file.name)
  );

  const renderImage = ({ item }: { item: FileInfo }) => (
    <Image
      source={{ uri: `file://${item.path}` }}
      style={{ width: 300, height: 400, margin: 10 }}
      resizeMode="contain"
    />
  );

  return (
    <FlatList
      data={imageFiles}
      renderItem={renderImage}
      keyExtractor={(item) => item.path}
    />
  );
};
```

## API Reference

### Methods

#### `unarchive(archivePath: string, outputPath: string): Promise<UnarchiveResult>`

Extracts the specified archive file to the given output directory.

**Parameters:**

- `archivePath` (string): Full path to the archive file (CBR or CBZ)
- `outputPath` (string): Directory where files will be extracted

**Returns:**

- `Promise<UnarchiveResult>`: Promise that resolves with extraction results

**Example:**

```typescript
const result = await unarchive('/path/to/archive.cbr', '/path/to/output');
```

#### `cancelUnarchive(): Promise<CancelResult>`

Cancels an ongoing extraction operation.

**Returns:**

- `Promise<CancelResult>`: Promise that resolves when cancellation is complete

**Example:**

```typescript
import { Platform } from 'react-native';
import { unarchive, cancelUnarchive } from 'react-native-unarchive';

// Start extraction
const extractionPromise = unarchive(archivePath, outputPath);

try {
   const result = await cancelUnarchive();
   console.log('Cancelled:', result.cancelled);
} catch (error) {
   console.error('Cancellation failed:', error);
}

// Handle extraction result or cancellation
try {
  const result = await extractionPromise;
  console.log('Extraction completed');
} catch (error) {
  if (error.code === 'UNARCHIVE_CANCELLED') {
    console.log('Extraction was cancelled by user');
  }
}
```

### Types

#### `FileInfo`

Represents information about an extracted file.

```typescript
interface FileInfo {
  path: string;         // Full path to the extracted file
  name: string;         // Filename (basename)
  relativePath: string; // Relative path within the archive (preserves directory structure)
  size: number;         // File size in bytes
}
```

#### `UnarchiveResult`

Contains the results of an extraction operation.

```typescript
interface UnarchiveResult {
  files: FileInfo[];     // Array of extracted files
  outputPath: string;    // Path where files were extracted
}
```

#### `CancelResult`

Contains the result of a cancellation operation.

```typescript
interface CancelResult {
  cancelled: boolean; // Always true when cancellation succeeds
}
```

## File System Integration

This library works well with popular React Native file system libraries:

### @dr.pogodin/react-native-fs

```typescript
import {
  DocumentDirectoryPath,
  CachesDirectoryPath,
  TemporaryDirectoryPath,
  exists,
  readDir,
} from '@dr.pogodin/react-native-fs';

// IMPORTANT: Use app-scoped directories only
const outputDir = `${DocumentDirectoryPath}/comics`;
if (!(await exists(outputDir))) {
  // Directory will be created automatically by unarchive
}

// List extracted files
const extractedFiles = await readDir(outputDir);
```

## Security and Path Requirements

### Sandbox Path Enforcement

For security, the library enforces that extraction only occurs within app-scoped directories:

**iOS Allowed Paths:**
- Documents directory: `NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, ...)`
- Caches directory: `NSSearchPathForDirectoriesInDomains(NSCachesDirectory, ...)`
- Temporary directory: `NSTemporaryDirectory()`

In React Native with `@dr.pogodin/react-native-fs`:
```typescript
import { DocumentDirectoryPath, CachesDirectoryPath, TemporaryDirectoryPath } from '@dr.pogodin/react-native-fs';

// ✅ Valid paths
const validPaths = [
  `${DocumentDirectoryPath}/extracted`,
  `${CachesDirectoryPath}/archives`,
  `${TemporaryDirectoryPath}/temp-extract`,
];

// ❌ Invalid paths (will reject with UNARCHIVE_INVALID_PATH)
const invalidPaths = [
  '/var/mobile/Containers/Shared',  // Outside sandbox
  '/Users/shared/archives',          // Absolute path outside app
];
```

**Android Allowed Paths:**
- App files directory: `context.filesDir`
- App cache directory: `context.cacheDir`
- External files directory: `context.getExternalFilesDir(null)`

In React Native with `@dr.pogodin/react-native-fs`:
```typescript
import { DocumentDirectoryPath, CachesDirectoryPath, ExternalStorageDirectoryPath } from '@dr.pogodin/react-native-fs';

// ✅ Valid paths
const validPaths = [
  `${DocumentDirectoryPath}/extracted`,                           // App internal files
  `${CachesDirectoryPath}/archives`,                              // App cache
  `${ExternalStorageDirectoryPath}/Android/data/YOUR_PACKAGE/files`,  // App external files
];

// ❌ Invalid paths (will reject with UNARCHIVE_INVALID_PATH)
const invalidPaths = [
  '/sdcard/Download/archives',       // Shared storage (Android 11+)
  ExternalStorageDirectoryPath,      // Root of external storage
];
```

### Why Sandbox Enforcement?

1. **Security**: Prevents directory traversal attacks and unauthorized file access
2. **Privacy**: Ensures files are only written to app-controlled locations
3. **Compliance**: Follows platform security guidelines (iOS App Sandbox, Android Scoped Storage)
4. **Predictability**: Guarantees cleanup when app is uninstalled

## Error Handling

The library provides detailed error information for common scenarios:

```typescript
try {
  const result = await unarchive(archivePath, outputPath);
} catch (error) {
  if (error.code === 'UNARCHIVE_BUSY') {
    console.log('Another extraction is in progress. Please wait and try again.');
  } else if (error.code === 'UNARCHIVE_INVALID_PATH') {
    console.log('Output path must be within app sandbox (Documents/Caches/tmp)');
  } else if (error.code === 'FILE_NOT_FOUND') {
    console.log('Archive file does not exist');
  } else if (error.code === 'DIRECTORY_ERROR') {
    console.log('Failed to create extraction directory');
  } else if (error.code === 'UNSUPPORTED_FORMAT') {
    console.log('Archive format not supported');
  } else if (error.code === 'EXTRACTION_ERROR') {
    console.log('Failed to extract archive contents');
    // In debug builds, error may include partialFilesCount and partialFilesList
    if (__DEV__ && error.userInfo) {
      console.log('Partial files extracted:', error.userInfo.partialFilesCount);
      console.log('Temp path:', error.userInfo.tempPath);
    }
  } else if (error.code === 'UNSAFE_PATH') {
    console.log('Archive contains unsafe paths (potential ZIP-SLIP attack)');
  } else if (error.code === 'UNARCHIVE_CANCELLED') {
    console.log('Extraction was cancelled by user');
  } else if (error.code === 'ATOMIC_REPLACE_ERROR') {
    console.log('Failed to finalize extraction');
  } else {
    console.log('Unknown error:', error.message);
  }
}
```

### Concurrency

The library implements a busy-state check to prevent concurrent extractions:

- Only one extraction operation can run at a time per module instance
- If you attempt to start a new extraction while one is in progress, you'll receive an `UNARCHIVE_BUSY` error immediately
- This prevents I/O saturation and ensures predictable behavior
- After an extraction completes (successfully or with error), the module is ready for the next operation

### Atomic Extraction

For data safety and consistency:

- Files are extracted to a temporary directory first
- On success, the temporary directory is atomically moved to the final output location
- On failure, the temporary directory is automatically cleaned up
- This ensures you never see partial extraction results in the output directory
- The output directory only appears when extraction is fully complete

### Security

The library includes protection against directory traversal attacks:

- **ZIP-SLIP Protection**: All archive entries are validated before extraction
- **Path Canonicalization**: Entries with `..` or absolute paths that attempt to escape the extraction directory are rejected
- **Sandbox Enforcement**: Files are verified to remain within the intended extraction directory
- Archives containing malicious paths will be rejected with an `UNSAFE_PATH` error

### Directory Structure Preservation

The library preserves the original directory structure from archives:

- `relativePath` field in `FileInfo` shows the file's path within the archive
- Nested directories are maintained in the extraction output
- Duplicate basenames in different directories are handled correctly
- Example: An archive with `folder1/image.jpg` and `folder2/image.jpg` will extract both files to their respective directories

### Debug Logging

In debug builds, comprehensive logging is enabled:

```typescript
// Debug logs appear in Metro/Xcode console
// Example output:
// [Unarchive] Starting CBR extraction: archive.cbr
// [Unarchive] Archive contains 125 entries
// [Unarchive] Extraction successful, enumerating files...
// [Unarchive] Enumerated 125 files
// [Unarchive] Extraction completed successfully with 125 files
```

Debug features include:
- Extraction progress logging
- Error details with file counts
- Path validation warnings

In release builds, logging is automatically disabled to reduce overhead.

## Troubleshooting

### Common Issues

1. **Android: "File not found" with content URIs**

   ```typescript
   // Copy content URI to accessible location first
   if (uri.startsWith('content://')) {
     const tempPath = `${DocumentDirectoryPath}/temp_${Date.now()}.cbr`;
     await copyFile(uri, tempPath);
     await unarchive(tempPath, outputPath);
   }
   ```

2. **iOS: CocoaPods dependency issues**

   ```bash
   cd ios
   pod deintegrate
   pod install
   ```

3. **Images not displaying**

   ```typescript
   // Ensure proper file:// URI format
   const imageUri = file.path.startsWith('file://') 
     ? file.path 
     : `file://${file.path}`;
   
   <Image source={{ uri: imageUri }} />
   ```

4. **Large archives causing memory issues**
   - The library handles large files efficiently with stream processing
   - Consider extracting to external storage on Android for very large archives

### Debug Logging

Enable debug logs to troubleshoot extraction issues:

```typescript
// The library automatically logs extraction progress
// Check Metro/Xcode console for detailed information
```

## Supported File Formats

### Supported Formats

| Archive Type          | Format        | Extension      |
|:----------------------|:--------------|:---------------|
| Comic Book RAR        | CBR           | .cbr           |
| Comic Book ZIP        | CBZ           | .cbz           |
| General RAR           | RAR           | .rar           |
| General ZIP           | ZIP           | .zip           |

## Performance Considerations

- **Large Archives**: The library uses streaming extraction to handle large files efficiently
- **Memory Usage**: Optimized for minimal memory footprint during extraction
- **Storage**: Extracted files are written directly to disk to avoid memory accumulation

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Search existing GitHub issues
3. Create a new issue with detailed reproduction steps
