# React Native Unarchive

An Archive Extraction Library for React Native Projects.

For React Native developers that need to extract RAR, ZIP CBR and CBZ files in their apps, this package is a useful resource. It supports React Native's new Turbo Module architecture and was created in Kotlin and Objective-C++.

With this package, users can quickly and easily extract RAR, ZIP, CBR and CBZ archives and other compressed files using their device's native capabilities. Using this package, multiple archive formats can be processed, and it is simple to integrate into existing projects.

If you want to provide your React Native app the ability to read and extract RAR, ZIP, CBR, CBZ files, you should definitely give this package some thought.

## Features

- **Cross-platform support**: Works on both Android and iOS
- **Multiple archive formats**: Supports CBR, RAR, ZIP and CBZ files
- **TypeScript support**: Full TypeScript definitions included
- **Document picker integration**: Easy integration with document pickers
- **File system compatibility**: Works with React Native File System libraries
- **Turbo Module**: Built using React Native's new architecture

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

- React Native 0.76+
- New Architecture (Turbo Modules) supported

## Usage

### Basic Usage

```typescript
import { unarchive, type UnarchiveResult } from 'react-native-unarchive';
import { DocumentDirectoryPath } from '@dr.pogodin/react-native-fs';

const extractArchive = async () => {
  try {
    const archivePath = '/path/to/your/archive.cbr'; // or .cbz
    const outputPath = `${DocumentDirectoryPath}/extracted`;
    
    const result: UnarchiveResult = await unarchive(archivePath, outputPath);
    
    console.log('Extraction completed!');
    console.log('Output path:', result.outputPath);
    console.log('Extracted files:', result.files);
    
    // Access individual files
    result.files.forEach((file) => {
      console.log(`File: ${file.name}, Size: ${file.size}, Path: ${file.path}`);
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

### Types

#### `FileInfo`

Represents information about an extracted file.

```typescript
interface FileInfo {
  path: string;    // Full path to the extracted file
  name: string;    // Original filename
  size: number;    // File size in bytes
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

## Platform-Specific Notes

### Android

- Uses 7-Zip-JBinding library for extraction
- Supports content URIs (requires copying to accessible location first)
- Optimized for large archives with stream processing

### iOS

- Uses UnrarKit for CBR/RAR files
- Uses SSZipArchive for CBZ/ZIP files
- Full file system access within app sandbox
- Memory-efficient extraction process

## File System Integration

This library works well with popular React Native file system libraries:

### @dr.pogodin/react-native-fs

```typescript
import {
  DocumentDirectoryPath,
  ExternalStorageDirectoryPath,
  exists,
  readDir,
} from '@dr.pogodin/react-native-fs';

// Check if extraction directory exists
const outputDir = `${DocumentDirectoryPath}/comics`;
if (!(await exists(outputDir))) {
  // Directory will be created automatically by unarchive
}

// List extracted files
const extractedFiles = await readDir(outputDir);
```

## Error Handling

The library provides detailed error information for common scenarios:

```typescript
try {
  const result = await unarchive(archivePath, outputPath);
} catch (error) {
  if (error.message.includes('File not found')) {
    console.log('Archive file does not exist');
  } else if (error.message.includes('Permission denied')) {
    console.log('Insufficient permissions to access file');
  } else if (error.message.includes('Unsupported format')) {
    console.log('Archive format not supported');
  } else if (error.message.includes('Extraction failed')) {
    console.log('Failed to extract archive contents');
  } else {
    console.log('Unknown error:', error.message);
  }
}
```

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

## Changelog

### 1.0.0

- Initial release
- Support for RAR and ZIP extraction
- Support for CBR and CBZ extraction
- Cross-platform Android and iOS support
- TypeScript definitions
- Document picker integration examples
