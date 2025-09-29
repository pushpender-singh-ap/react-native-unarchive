import React, { useState } from 'react';
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Platform,
  Image,
  Modal,
} from 'react-native';
import {
  multiply,
  unarchive,
  type FileInfo,
  type UnarchiveResult,
} from 'react-native-unarchive';
import {
  DocumentDirectoryPath,
  exists,
  readDir,
  ExternalStorageDirectoryPath,
  DownloadDirectoryPath,
  copyFile,
} from '@dr.pogodin/react-native-fs';
import { pick } from '@react-native-documents/picker';

const multiplyResult = multiply(3, 7);

// Utility function to convert file URI to file path
const uriToPath = (uri: string): string => {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.replace('file://', ''));
  }
  return uri;
};

// Utility function to convert file path to URI if needed
const pathToUri = (path: string): string => {
  if (path.startsWith('file://')) {
    return path;
  }
  return `file://${encodeURI(path)}`;
};

function App() {
  // Debug: Log the file system paths on startup
  console.log('=== FILE SYSTEM PATHS DEBUG ===');
  console.log('Platform:', Platform.OS);
  console.log('DocumentDirectoryPath:', DocumentDirectoryPath);
  console.log('ExternalStorageDirectoryPath:', ExternalStorageDirectoryPath);
  console.log('DownloadDirectoryPath:', DownloadDirectoryPath);
  console.log('===============================');

  const [archivePath, setArchivePath] = useState('');
  const [outputPath, setOutputPath] = useState(() => {
    if (Platform.OS === 'android') {
      return `${ExternalStorageDirectoryPath}/Download/UnarchiveApp`;
    } else {
      // iOS: Use DocumentDirectoryPath, it should always be available
      return `${DocumentDirectoryPath || '/tmp'}/UnarchiveApp`;
    }
  });
  const [extractionResult, setExtractionResult] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalImage, setModalImage] = useState('');

  const selectOutputDirectory = async () => {
    // For now, let's use a simple preset directory or let user type manually
    Alert.alert('Output Directory', 'Choose where to extract files:', [
      {
        text: 'Downloads Folder',
        onPress: () => {
          const downloadsPath =
            Platform.OS === 'android'
              ? `${ExternalStorageDirectoryPath}/Download/UnarchiveApp`
              : `${DownloadDirectoryPath || '/var/mobile/Containers/Data/Application/Documents'}/UnarchiveApp`;
          setOutputPath(downloadsPath);
        },
      },
      {
        text: 'External Storage',
        onPress: () => {
          const externalPath =
            Platform.OS === 'android'
              ? `${ExternalStorageDirectoryPath}/UnarchiveApp`
              : `${DocumentDirectoryPath || '/var/mobile/Containers/Data/Application/Documents'}/UnarchiveApp`;
          setOutputPath(externalPath);
        },
      },
      {
        text: 'Custom Path',
        onPress: () => {
          Alert.alert(
            'Custom Path',
            'Enter the full path where you want to extract files:',
            [
              {
                text: 'Cancel',
                style: 'cancel',
              },
              {
                text: 'Use /sdcard/UnarchiveApp',
                onPress: () => setOutputPath('/sdcard/UnarchiveApp'),
              },
            ]
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleUnarchive = async () => {
    if (!archivePath) {
      Alert.alert('Error', 'Please enter an archive path');
      return;
    }

    console.log('=== STARTING UNARCHIVE ===');
    console.log('Archive Path:', archivePath);
    console.log('Output Path:', outputPath);

    setLoading(true);
    try {
      // Convert URI to path for file system operations
      const archiveFilePath = uriToPath(archivePath);
      console.log('Converted Archive Path:', archiveFilePath);

      // Check if archive file exists
      const archiveExists = await exists(archiveFilePath);
      console.log('Archive file exists:', archiveExists);

      if (!archiveExists) {
        Alert.alert(
          'Error',
          'Archive file not found. Please select the file again.'
        );
        setLoading(false);
        return;
      }

      // Check/create output directory
      const outputExists = await exists(outputPath);
      console.log('Output directory exists:', outputExists);

      if (!outputExists) {
        console.log('Creating output directory:', outputPath);
        // Note: You might need to create the directory here
      }

      console.log('Calling unarchive function...');
      const result: UnarchiveResult = await unarchive(
        archiveFilePath,
        outputPath
      );

      console.log('=== UNARCHIVE RESULT ===');
      console.log('Files extracted:', result.files.length);
      console.log('Output path:', result.outputPath);
      console.log('Extracted files:', result.files);

      setExtractionResult(result.files);

      // Verify files actually exist
      if (result.files.length > 0 && result.files[0]) {
        console.log('Checking if first file exists:', result.files[0].path);
        const firstFileExists = await exists(result.files[0].path);
        console.log('First extracted file exists:', firstFileExists);
      }

      Alert.alert(
        'Success',
        `Extracted ${result.files.length} files to:\n${result.outputPath}\n\nFirst file: ${result.files[0]?.name || 'None'}`
      );

      // Also check what's actually in the output directory
      try {
        console.log('Reading output directory contents...');
        const dirContents = await readDir(outputPath);
        console.log(
          'Directory contents:',
          dirContents.map((item) => ({
            name: item.name,
            path: item.path,
            isFile: item.isFile(),
            size: item.size,
          }))
        );
      } catch (dirError) {
        console.error('Error reading output directory:', dirError);
      }
    } catch (error) {
      console.error('=== UNARCHIVE ERROR ===');
      console.error('Error details:', error);
      Alert.alert('Error', `Failed to extract archive: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const selectTheFile = async () => {
    try {
      const pickerResult = await pick({
        type: [
          'public.zip-archive',
          'public.archive',
          'application/zip',
          'application/x-rar-compressed',
          'public.data', // Fallback for unrecognized files
          'com.rarlab.rar-archive', // RAR files
          'com.rarlab.cbr-archive', // CBR files
          'com.rarlab.cbz-archive', // CBZ files
          'dyn.ah62d4rv4ge80g2x4', // CBZ files (dynamic type)
          'application/x-cbz', // CBZ MIME type
          'application/x-cbr', // CBR MIME type
          'application/vnd.comicbook+zip', // CBZ alternative
          'application/vnd.comicbook-rar', // CBR alternative
        ],
        allowMultiSelection: false,
        copyTo: 'documentDirectory',
        mode: 'open', // Explicitly set mode for better compatibility
      });

      if (pickerResult && pickerResult.length > 0) {
        const selectedFile = pickerResult[0];
        console.log('Picked file:', selectedFile);

        // Extract filename from URI or use provided name
        let fileName: string | null = selectedFile.name;
        const originalUri = selectedFile.uri;

        if (!fileName && originalUri) {
          const uriParts = decodeURIComponent(originalUri).split('/');
          fileName = uriParts[uriParts.length - 1] || 'archive';

          // Ensure proper extension
          if (
            !fileName.toLowerCase().includes('.cb') &&
            !fileName.toLowerCase().includes('.rar') &&
            !fileName.toLowerCase().includes('.zip')
          ) {
            // Try to detect from original filename in URI
            const fullUri = decodeURIComponent(originalUri);
            const matches = fullUri.match(
              /([^/]+\.(cbz|cbr|zip|rar))(?:\?|$)/i
            );
            if (matches && matches[1]) {
              fileName = matches[1];
            } else {
              fileName += '.cbz'; // Default extension
            }
          }
        }

        console.log('Extracted filename:', fileName);

        // Priority 1: Use fileCopyUri if available (most reliable)
        if ((selectedFile as any).fileCopyUri) {
          console.log(
            'Using fileCopyUri (copied to document directory):',
            (selectedFile as any).fileCopyUri
          );
          setArchivePath((selectedFile as any).fileCopyUri);
          Alert.alert(
            'File Selected',
            `Selected: ${fileName}\nFile copied to app directory\nReady for extraction`
          );
          return;
        }

        // Priority 2: Handle Android content URIs (needs to be copied to accessible location)
        if (Platform.OS === 'android' && originalUri.startsWith('content://')) {
          try {
            // Create a unique filename to avoid conflicts
            const timestamp = Date.now();
            const safeFileName = (fileName || 'archive').replace(/[^a-zA-Z0-9.-]/g, '_');
            const permanentPath = `${DocumentDirectoryPath}/imported_${timestamp}_${safeFileName}`;

            console.log('Copying Android content URI to permanent location:');
            console.log('From:', originalUri);
            console.log('To:', permanentPath);

            // Copy from content URI to app's document directory
            await copyFile(originalUri, permanentPath);
            console.log('File successfully copied from content URI');

            // Verify the copied file
            const copiedExists = await exists(permanentPath);
            if (!copiedExists) {
              throw new Error('File copy verification failed');
            }

            setArchivePath(permanentPath);
            Alert.alert(
              'File Selected & Copied',
              `Selected: ${fileName}\nCopied from Downloads to app directory\nReady for extraction`
            );
            return;
          } catch (copyError) {
            console.error('Failed to copy file from content URI:', copyError);
            Alert.alert(
              'File Copy Failed',
              `Cannot copy file from Downloads: ${copyError}\n\nTry:\n1. Moving the file to internal storage\n2. Using a different file manager\n3. Selecting a different file location`
            );
            return;
          }
        }

        // Priority 3: Handle temporary inbox files (iOS security restriction)
        if (
          Platform.OS === 'ios' &&
          (originalUri.includes('/tmp/') || originalUri.includes('-Inbox/'))
        ) {
          try {
            // Create a unique filename to avoid conflicts
            const timestamp = Date.now();
            const safeFileName = (fileName || 'archive').replace(
              /[^a-zA-Z0-9.-]/g,
              '_'
            );
            const permanentPath = `${DocumentDirectoryPath}/imported_${timestamp}_${safeFileName}`;

            console.log('Copying from temp/inbox to permanent location:');
            console.log('From:', originalUri);
            console.log('To:', permanentPath);

            // Check if source file exists and is readable
            const sourceExists = await exists(originalUri);
            console.log('Source file exists:', sourceExists);

            if (!sourceExists) {
              throw new Error(
                'Source file is not accessible or does not exist'
              );
            }

            // Remove existing file if it exists
            const permanentExists = await exists(permanentPath);
            if (permanentExists) {
              console.log('Removing existing file at permanent location');
              // Note: You might need to add unlink functionality here
            }

            await copyFile(originalUri, permanentPath);
            console.log('File successfully copied to permanent location');

            // Verify the copied file
            const copiedExists = await exists(permanentPath);
            if (!copiedExists) {
              throw new Error('File copy verification failed');
            }

            setArchivePath(permanentPath);
            Alert.alert(
              'File Selected & Copied',
              `Selected: ${fileName}\nCopied to app directory for secure access\nReady for extraction`
            );
            return;
          } catch (copyError) {
            console.error('Failed to copy file from temp location:', copyError);
            Alert.alert(
              'File Access Failed',
              `Cannot access this file due to iOS security restrictions.\n\nError: ${copyError}\n\nTo fix this:\n1. Open Files app\n2. Navigate to "On My iPhone" > "UnarchiveExample"\n3. Copy your CBZ/CBR file there\n4. Then select it from that location\n\nOr create an app folder first using the "Create App Folder in Files" button.`
            );
            return;
          }
        }

        // Priority 3: Use original URI for files in accessible locations
        if (originalUri) {
          console.log(
            'Using original URI (should be accessible):',
            originalUri
          );
          setArchivePath(originalUri);
          Alert.alert(
            'File Selected',
            `Selected: ${fileName || 'archive'}\nReady for extraction`
          );
        } else {
          throw new Error('No valid file URI received from picker');
        }
      }
    } catch (error) {
      console.error('File picker error:', error);
      Alert.alert(
        'File Selection Error',
        `Failed to select file: ${error}\n\nFor CBZ/CBR files, make sure they're in an accessible location like your app's document folder.`
      );
    }
  };

  const checkOutputDirectory = async () => {
    try {
      console.log('Checking output directory:', outputPath);
      const dirExists = await exists(outputPath);

      if (!dirExists) {
        Alert.alert(
          'Directory Check',
          `Output directory does not exist:\n${outputPath}`
        );
        return;
      }

      const dirContents = await readDir(outputPath);
      console.log('Directory contents:', dirContents);

      const filesList = dirContents
        .map(
          (item) =>
            `${item.name} (${item.isFile() ? 'File' : 'Dir'}) - ${item.size} bytes`
        )
        .join('\n');

      Alert.alert(
        'Directory Contents',
        `Path: ${outputPath}\n\nFiles (${dirContents.length}):\n${filesList || 'Empty directory'}`
      );
    } catch (error) {
      console.error('Error checking directory:', error);
      Alert.alert('Error', `Failed to check directory: ${error}`);
    }
  };

  const handleImagePress = (path: string) => {
    console.log('=== IMAGE PRESS ===');
    console.log('Original path:', path);
    
    // Ensure proper file URI format for image display
    let imageUri = path;
    if (Platform.OS === 'android' && !path.startsWith('file://')) {
      imageUri = `file://${path}`;
    }
    console.log('Image URI for display:', imageUri);
    
    setShowModal(true);
    setModalImage(imageUri);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>React Native Unarchive</Text>
        <Text style={styles.subtitle}>CBR/CBZ Extraction Demo</Text>
        <Text style={styles.result}>Multiply Test: {multiplyResult}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Archive Path</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.pickerButton} onPress={selectTheFile}>
            <Text style={styles.pickerButtonText}>Select CBR/CBZ File</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={archivePath}
          onChangeText={setArchivePath}
          placeholder={
            Platform.OS === 'ios'
              ? '/path/to/your/archive.cbr'
              : '/storage/emulated/0/Download/archive.cbz'
          }
          multiline={false}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Output Path</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={selectOutputDirectory}
          >
            <Text style={styles.pickerButtonText}>Select Output Folder</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={outputPath}
          onChangeText={setOutputPath}
          placeholder="Extraction destination"
          multiline={false}
        />
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleUnarchive}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Extracting...' : 'Unarchive'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton]}
          onPress={checkOutputDirectory}
        >
          <Text style={styles.debugButtonText}>Check Output Directory</Text>
        </TouchableOpacity>
      </View>

      {extractionResult.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Extracted Files ({extractionResult.length} files)
          </Text>
          <ScrollView style={styles.fileList} nestedScrollEnabled={true}>
            {extractionResult.map((file: FileInfo, index: number) => (
              <TouchableOpacity
                onPress={() => handleImagePress(file.path)}
                key={index}
                style={styles.fileItem}
              >
                <Text style={styles.fileName} numberOfLines={2}>
                  {file.name}
                </Text>
                <Text style={styles.fileDetails}>
                  {formatFileSize(file.size)}
                </Text>
                <Text style={styles.filePath} numberOfLines={1}>
                  {file.path}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <Modal
        visible={showModal}
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.modalImage}
            onPress={() => setShowModal(false)}
          >
            <Image
              source={{ uri: modalImage }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#fff',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 5,
  },
  result: {
    fontSize: 14,
    color: '#888',
    marginTop: 10,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    marginBottom: 15,
    padding: 15,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  buttonRow: {
    marginBottom: 10,
  },
  pickerButton: {
    backgroundColor: '#34C759',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 6,
    alignItems: 'center',
  },
  pickerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  buttonContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 10,
  },
  debugButton: {
    backgroundColor: '#FF9500',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  debugButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fileList: {
    maxHeight: 200,
  },
  fileItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  fileDetails: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  filePath: {
    fontSize: 10,
    color: '#888',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
});

export default App;
