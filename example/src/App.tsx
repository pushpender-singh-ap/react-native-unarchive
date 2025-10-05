import { useState } from 'react';
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
  cancelUnarchive,
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
import { PermissionsAndroid, Share } from 'react-native';

const multiplyResult = multiply(3, 7);

// Utility function to convert file URI to file path
const uriToPath = (uri: string): string => {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.replace('file://', ''));
  }
  return uri;
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
    // Both platforms now require app-scoped directories for security
    // Android: Use DocumentDirectoryPath (filesDir) which is always allowed
    // iOS: Use DocumentDirectoryPath as before
    return `${DocumentDirectoryPath}/UnarchiveApp`;
  });
  const [extractionResult, setExtractionResult] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalImage, setModalImage] = useState('');

  const selectOutputDirectory = async () => {
    // Security: Only app-scoped directories are allowed on both platforms
    Alert.alert(
      'Output Directory',
      'For security, extraction is limited to app directories. Choose a location:',
      [
        {
          text: 'App Documents',
          onPress: () => {
            setOutputPath(`${DocumentDirectoryPath}/UnarchiveApp`);
          },
        },
        {
          text: 'App Cache',
          onPress: () => {
            const cachePath = DocumentDirectoryPath.replace(
              '/Documents',
              '/Library/Caches'
            );
            setOutputPath(`${cachePath}/UnarchiveApp`);
          },
        },
        {
          text: 'App Files (Android)',
          onPress: () => {
            if (Platform.OS === 'android') {
              // Derive the Android app package name from the internal DocumentDirectoryPath
              // DocumentDirectoryPath on Android looks like: /data/user/0/<package>/files
              // Use the same package to construct the app-scoped external files path so
              // it matches the native allowed root and avoids UNARCHIVE_INVALID_PATH.
              const pkgRegex = /\/data\/user\/(?:0\/)?([^/]+)\/files/;
              const match = (DocumentDirectoryPath || '').match(pkgRegex);
              const packageName = match && match[1] ? match[1] : null;
              const androidPath = packageName
                ? `${ExternalStorageDirectoryPath}/Android/data/${packageName}/files/UnarchiveApp`
                : `${DocumentDirectoryPath}/UnarchiveApp`;

              setOutputPath(androidPath);
            } else {
              setOutputPath(`${DocumentDirectoryPath}/UnarchiveApp`);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
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
        `Extracted ${result.files.length} files\n\nLocation: ${result.outputPath}\n\nFirst file: ${result.files[0]?.name || 'None'}\n\nNote: Files are in app directory for security.`
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
    } catch (error: any) {
      console.error('=== UNARCHIVE ERROR ===');
      console.error('Error details:', error);

      // Handle specific error codes
      let errorMessage = `Failed to extract archive: ${error.message || error}`;

      if (error.code === 'UNARCHIVE_BUSY') {
        errorMessage =
          'Another extraction is already in progress. Please wait for it to complete.';
      } else if (error.code === 'UNARCHIVE_INVALID_PATH') {
        errorMessage = `Invalid output path. For security, extraction is only allowed to app directories.\n\nCurrent path: ${outputPath}\n\nPlease use "Select Output Folder" to choose a valid location.`;
      } else if (error.code === 'UNARCHIVE_ENTRY_INVALID') {
        errorMessage =
          'Archive contains unsafe entries (possible ZIP-SLIP attack). The archive may be malicious or corrupted.';
      } else if (error.code === 'UNARCHIVE_CANCELLED') {
        errorMessage = 'Extraction was cancelled.';
      } else if (error.code === 'FILE_NOT_FOUND') {
        errorMessage = 'Archive file not found. Please select the file again.';
      }

      // Include debug info if available
      if (error.userInfo) {
        const debugInfo: string[] = [];
        if (error.userInfo.partialFilesCount) {
          debugInfo.push(`Partial files: ${error.userInfo.partialFilesCount}`);
        }
        if (error.userInfo.tempPath) {
          debugInfo.push(`Temp path: ${error.userInfo.tempPath}`);
        }
        if (debugInfo.length > 0) {
          errorMessage += `\n\nDebug info:\n${debugInfo.join('\n')}`;
        }
      }

      Alert.alert('Extraction Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelUnarchive = async () => {
    if (!loading) {
      Alert.alert('Info', 'No extraction in progress');
      return;
    }

    try {
      console.log('=== CANCELLING UNARCHIVE ===');
      const result = await cancelUnarchive();
      console.log('Cancellation result:', result);
      Alert.alert('Cancelled', 'Extraction has been cancelled');
    } catch (error) {
      console.error('Cancellation error:', error);
      Alert.alert('Error', `Failed to cancel: ${error}`);
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
            const safeFileName = (fileName || 'archive').replace(
              /[^a-zA-Z0-9.-]/g,
              '_'
            );
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

  // Export extracted files to the user's Downloads folder so they are visible
  // in the system Files app. Note: on Android 11+ scoped storage prevents
  // writing into shared folders without special APIs; we attempt to copy and
  // surface friendly errors / fallbacks.
  const exportToDownloads = async () => {
    if (extractionResult.length === 0) {
      Alert.alert('No files', 'There are no extracted files to export');
      return;
    }

    if (Platform.OS !== 'android') {
      Alert.alert(
        'Unsupported',
        'Export to Downloads is currently Android-only'
      );
      return;
    }

    // For Android < 29, request WRITE_EXTERNAL_STORAGE
    const sdk = Platform.Version as number;
    if (sdk < 29) {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          {
            title: 'Storage Permission',
            message:
              'This app needs permission to write to external storage to export files',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );

        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            'Permission denied',
            'Cannot export files without storage permission'
          );
          return;
        }
      } catch (permErr) {
        console.error('Permission request failed', permErr);
        Alert.alert(
          'Permission error',
          `Permission request failed: ${permErr}`
        );
        return;
      }
    }

    const results: { name: string; ok: boolean; error?: string }[] = [];
    for (const file of extractionResult) {
      try {
        const destPath = `${DownloadDirectoryPath}/${file.name}`;
        console.log('Copying to Downloads:', file.path, '->', destPath);
        await copyFile(file.path, destPath);
        const ok = await exists(destPath);
        if (ok) {
          results.push({ name: file.name, ok: true });
        } else {
          results.push({
            name: file.name,
            ok: false,
            error: 'Verification failed',
          });
        }
      } catch (copyErr: any) {
        console.error('Export failed for', file.path, copyErr);
        results.push({
          name: file.name,
          ok: false,
          error: `${copyErr?.message || copyErr}`,
        });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);

    let message = `Exported ${successCount}/${results.length} files to your Downloads folder.`;
    if (failed.length > 0) {
      message += `\n\nFailed:\n${failed.map((f) => `${f.name}: ${f.error}`).join('\n')}`;
      message += `\n\nNote: On Android 11+ the system may prevent apps from writing directly to Downloads. Use "Share" on a file to move it to another app or use a file manager export.`;
    }

    Alert.alert('Export Complete', message);
  };

  // Share a single file using the system share sheet. This is the recommended
  // way for users to move files to locations not directly writable by the app.
  const shareFile = async (filePath: string) => {
    try {
      const uri =
        Platform.OS === 'android' && !filePath.startsWith('file://')
          ? `file://${filePath}`
          : filePath;
      await Share.share({ url: uri, title: 'Share file' });
    } catch (e: any) {
      console.error('Share failed', e);
      Alert.alert('Share failed', `${e?.message || e}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>React Native Unarchive</Text>
        <Text style={styles.subtitle}>CBR/CBZ Extraction Demo</Text>
        <Text style={styles.result}>Multiply Test: {multiplyResult}</Text>
        <Text style={styles.securityNote}>
          🔒 Secure extraction to app directories only
        </Text>
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

        {loading && (
          <TouchableOpacity
            style={[styles.cancelButton]}
            onPress={handleCancelUnarchive}
          >
            <Text style={styles.cancelButtonText}>Cancel Extraction</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.debugButton]}
          onPress={checkOutputDirectory}
        >
          <Text style={styles.debugButtonText}>Check Output Directory</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.exportButton]}
          onPress={exportToDownloads}
        >
          <Text style={styles.exportButtonText}>Export to Downloads</Text>
        </TouchableOpacity>
      </View>

      {extractionResult.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Extracted Files ({extractionResult.length} files)
          </Text>
          <ScrollView style={styles.fileList} nestedScrollEnabled={true}>
            {extractionResult.map((file: FileInfo, index: number) => (
              <View key={index} style={styles.fileItemRow}>
                <TouchableOpacity
                  onPress={() => handleImagePress(file.path)}
                  style={styles.fileItemTouchable}
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
                <View style={styles.fileActions}>
                  <TouchableOpacity
                    style={styles.shareButton}
                    onPress={() => shareFile(file.path)}
                  >
                    <Text style={styles.shareButtonText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.exportRow}>
            <TouchableOpacity
              style={styles.exportButton}
              onPress={exportToDownloads}
            >
              <Text style={styles.exportButtonText}>
                Export All to Downloads
              </Text>
            </TouchableOpacity>
          </View>
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
  securityNote: {
    fontSize: 12,
    color: '#34C759',
    marginTop: 8,
    fontWeight: '500',
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
  cancelButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 10,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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
  fileItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  fileItemTouchable: {
    flex: 1,
  },
  fileActions: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  exportRow: {
    marginTop: 10,
    alignItems: 'center',
  },
  exportButton: {
    backgroundColor: '#34C759',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  exportButtonText: {
    color: '#fff',
    fontWeight: '600',
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
