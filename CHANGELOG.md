# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - (2025-10-05) Security Hardening, Concurrency Improvements, Cancellation Support

### Added

#### Cross-Platform Features

- **Cancellation Support**: Added `cancelUnarchive()` method for both iOS and Android to stop ongoing extractions
- **Directory Structure Preservation**: Added `relativePath` field to `FileInfo` to maintain original archive directory structure
- **Comprehensive Error Codes**: Added specific error codes for different failure scenarios:
  - `UNARCHIVE_BUSY`: Another extraction is already in progress
  - `UNARCHIVE_INVALID_PATH`: Output path is outside allowed app directories
  - `UNSAFE_PATH`: Archive contains path traversal attempts (ZIP-SLIP attack)
  - `UNARCHIVE_CANCELLED`: Extraction was cancelled by user
  - `ATOMIC_REPLACE_ERROR`: Failed to finalize extraction atomically
  - `FILE_NOT_FOUND`: Archive file does not exist
  - `DIRECTORY_ERROR`: Failed to create extraction directory
  - `EXTRACTION_ERROR`: Archive extraction failed
  - `UNSUPPORTED_FORMAT`: Archive format not supported

#### iOS-Specific Improvements

- **Sandbox Path Validation**: Output paths are now validated to be within app sandbox (Documents/Caches/tmp)
- **Atomic Directory Replacement**: Uses `replaceItemAtURL:withItemAtURL:` for atomic final directory swap
- **Main Thread Payload Construction**: Result payloads are now built on main thread for bridge safety
- **Cooperative Cancellation**: Checks cancellation flag at multiple points during extraction
- **Debug Diagnostics**: Added comprehensive debug logging (enabled in DEBUG builds only)
  - Extraction progress tracking
  - File count reporting
  - Path validation warnings
  - Temp directory tracking

#### Android-Specific Improvements

- **Sandbox Path Validation**: Output paths validated against `filesDir`, `cacheDir`, and `externalFilesDir`
- **Atomic Move with Fallback**: Implements atomic move with rename-backup fallback strategy
- **Single FileOutputStream per Entry**: Prevents file handle leaks and race conditions
- **Main Thread Payload Conversion**: WritableNativeArray/Map converted on Dispatchers.Main
- **Cooperative Cancellation**: Job tracking with `isActive` checks throughout extraction
- **Debug Diagnostics**: Added comprehensive debug logging (gated by BuildConfig.DEBUG)

### Security

#### Cross-Platform Security Enhancements

- **ZIP-SLIP Protection**: All archive entries validated before extraction to prevent directory traversal attacks
- **Path Canonicalization**: Prevents malicious paths with `..` or symlinks from escaping extraction directory
- **Sandbox Enforcement**:
  - iOS: Only allows extraction to Documents, Caches, or tmp directories
  - Android: Only allows extraction to app-scoped directories (filesDir, cacheDir, externalFilesDir)
- **Temp Directory Extraction**: Files extracted to temporary directory first, then atomically moved
- **Post-Extraction Validation** (iOS CBZ): Additional verification that no extracted files escaped temp directory

### Changed

#### iOS Changes

- Replaced `RCT_EXPORT_MODULE()` with proper TurboModule initialization
- Added atomic single-callback guards (`resolveOnce`/`rejectOnce`) to prevent race conditions
- Added module-level concurrency guard using `std::atomic_bool` (one extraction at a time)
- Extraction now uses per-invocation `NSFileManager` instead of `defaultManager`
- Moved from direct output extraction to temp-dir-then-atomic-move pattern
- Enhanced error reporting with partial file diagnostics in debug builds
- Removed inheritance from `RCTEventEmitter` in favor of TurboModule-only design

#### Android Changes

- Added module-level concurrency guard using `AtomicBoolean` (one extraction at a time)
- Added per-invocation single-callback guard to prevent race conditions
- Moved from direct output extraction to temp-dir-then-atomic-move pattern
- Improved error handling with structured error information
- Enhanced extraction to recursively enumerate files and preserve relative paths
- Added `BuildConfig.DEBUG` gating for all debug logs

### Fixed

#### iOS Fixes

- Fixed race condition where multiple concurrent extractions could occur
- Fixed non-atomic final directory replacement (was remove-then-move, now atomic)
- Fixed potential bridge thread-safety issue with background payload construction
- Fixed memory leaks in error paths by ensuring temp directory cleanup
- Fixed zip-slip vulnerability by validating all entry paths before extraction
- Fixed missing relative path information in extracted file metadata

#### Android Fixes

- Fixed race condition with multiple concurrent extraction attempts
- Fixed file handle leaks from repeated FileOutputStream creation per chunk
- Fixed WritableNativeArray construction off main thread
- Fixed zip-slip vulnerability with canonicalFile path validation
- Fixed non-atomic directory replacement with atomic move + fallback
- Fixed missing cancellation support
- Fixed missing relative path information in extracted file metadata

### Documentation

- Updated README.md with:
  - New `cancelUnarchive()` API documentation
  - Comprehensive error handling examples with error codes
  - Security features documentation (ZIP-SLIP, sandbox enforcement)
  - Concurrency behavior documentation
  - Atomic extraction pattern documentation
  - Directory structure preservation examples
  - Debug logging documentation
  - Platform-specific path requirements for Android and iOS
- Updated example app with:
  - Cancellation button
  - Error code handling
  - Share file functionality
  - Export to Downloads feature
  - Improved path selection for sandbox compliance

### Performance

- Reduced I/O overhead by using single FileOutputStream per entry (Android)
- Improved extraction speed with optimized path validation
- Reduced memory usage by extracting to temp directory and moving atomically
- Minimized main thread blocking by building payloads on appropriate threads

### Breaking Changes

**None** - This release is backward compatible, but behavior changes may affect apps:

1. **Path Restrictions**: Output paths must now be within app sandbox:
   - iOS: Documents, Caches, or tmp directories only
   - Android: filesDir, cacheDir, or externalFilesDir only
   - **Migration**: Update code to use app-scoped paths (e.g., `DocumentDirectoryPath` from react-native-fs)

2. **Concurrency**: Only one extraction can run at a time per module instance
   - Concurrent extraction attempts will immediately fail with `UNARCHIVE_BUSY`
   - **Migration**: Queue extraction requests or wait for completion before starting new ones

3. **Error Codes**: Errors now include specific `code` property for programmatic handling
   - **Migration**: Update error handlers to check `error.code` instead of `error.message`

## [1.0.1] - (2025-09-30) Initial Release

### Added

- Initial release of react-native-unarchive
- Support for RAR (CBR) and ZIP (CBZ) archive extraction
- Cross-platform support for iOS and Android
- TurboModule implementation for React Native 0.80+
- TypeScript support with full type definitions
- Basic error handling
- File metadata (path, name, size) for extracted files

### iOS Features

- UnrarKit integration for RAR/CBR files
- SSZipArchive integration for ZIP/CBZ files
- File enumeration with size information

### Android Features

- SevenZip JBinding integration for archive extraction
- Kotlin coroutines for async operations
- Stream-based extraction for memory efficiency

---

## Version History

- **1.1.0** (2025-10-05): Security hardening, concurrency improvements, cancellation support
- **1.0.1** (2025-09-30): Initial release with basic extraction functionality
