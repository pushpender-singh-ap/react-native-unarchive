#import "Unarchive.h"
#import <atomic>

@implementation Unarchive {
  std::atomic_bool _activeExtraction;
  std::atomic_bool _cancellationRequested;
  NSString *_currentTempPath;
}

- (instancetype)init {
  if (self = [super init]) {
    _activeExtraction.store(false);
    _cancellationRequested.store(false);
    _currentTempPath = nil;
  }
  return self;
}

// Helper method to check a canonical path is equal to or contained by a canonical directory.
- (BOOL)canonicalPath:(NSString *)path isWithinDirectory:(NSString *)directory {
  if (!path || !directory) {
    return NO;
  }

  if ([path isEqualToString:directory]) {
    return YES;
  }

  NSString *directoryWithSeparator = [directory stringByAppendingString:@"/"];
  return [path hasPrefix:directoryWithSeparator];
}

// Helper method to canonicalize path strings consistently.
- (NSString *)canonicalPathForPath:(NSString *)path {
  NSURL *url = [NSURL fileURLWithPath:path];
  return [[[url URLByResolvingSymlinksInPath] URLByStandardizingPath] path];
}

// Helper method to validate output path is within app sandbox
- (BOOL)isOutputPathInSandbox:(NSString *)outputPath
                        error:(NSError **)error {
  if (!outputPath || outputPath.length == 0) {
    if (error) {
      *error = [NSError errorWithDomain:@"UnarchiveError"
                                   code:-10
                               userInfo:@{NSLocalizedDescriptionKey: @"Output path is nil or empty"}];
    }
    return NO;
  }

  NSString *canonicalOutput = [self canonicalPathForPath:outputPath];

  // Get allowed sandbox directories
  NSString *documentsPath = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
  NSString *cachesPath = [NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES) firstObject];
  NSString *tmpPath = NSTemporaryDirectory();

  // Canonicalize sandbox paths
  NSString *canonicalDocuments = [self canonicalPathForPath:documentsPath];
  NSString *canonicalCaches = [self canonicalPathForPath:cachesPath];
  NSString *canonicalTmp = [self canonicalPathForPath:tmpPath];

  // Check if output path is within any allowed directory using path-boundary checks.
  BOOL isInDocuments = [self canonicalPath:canonicalOutput isWithinDirectory:canonicalDocuments];
  BOOL isInCaches = [self canonicalPath:canonicalOutput isWithinDirectory:canonicalCaches];
  BOOL isInTmp = [self canonicalPath:canonicalOutput isWithinDirectory:canonicalTmp];

  if (!isInDocuments && !isInCaches && !isInTmp) {
#if DEBUG
    NSLog(@"[Unarchive] INVALID_PATH: Output path '%@' is outside app sandbox", outputPath);
    NSLog(@"[Unarchive] Allowed directories: Documents='%@', Caches='%@', Tmp='%@'",
          canonicalDocuments, canonicalCaches, canonicalTmp);
#endif
    if (error) {
      *error = [NSError errorWithDomain:@"UnarchiveError"
                                   code:-11
                               userInfo:@{
                                 NSLocalizedDescriptionKey: @"Output path must be within app sandbox (Documents/Caches/tmp)",
                                 @"outputPath": outputPath,
                                 @"canonicalPath": canonicalOutput
                               }];
    }
    return NO;
  }

  return YES;
}

// Helper method for zip-slip sanitization
- (BOOL)isSafePath:(NSString *)entryPath
     withinBaseURL:(NSURL *)baseURL
             error:(NSError **)error {
  if (!entryPath || entryPath.length == 0 || !baseURL) {
    if (error) {
      *error = [NSError errorWithDomain:@"UnarchiveError"
                                   code:-1
                               userInfo:@{NSLocalizedDescriptionKey: @"Invalid path or base URL"}];
    }
    return NO;
  }

  NSString *normalizedEntry = [entryPath stringByReplacingOccurrencesOfString:@"\\" withString:@"/"];

  // Reject absolute Unix paths, Windows drive-letter paths, UNC paths, and entries
  // that normalize to the extraction root instead of a child entry. Never strip
  // traversal components because extraction libraries receive the original name.
  NSRegularExpression *windowsDrive = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z]:"
                                                                                options:0
                                                                                  error:nil];
  BOOL hasWindowsDrive = [windowsDrive firstMatchInString:normalizedEntry
                                                  options:0
                                                    range:NSMakeRange(0, normalizedEntry.length)] != nil;
  if ([normalizedEntry hasPrefix:@"/"] || [normalizedEntry hasPrefix:@"//"] ||
      hasWindowsDrive || [normalizedEntry isEqualToString:@"."]) {
    if (error) {
      *error = [NSError errorWithDomain:@"UnarchiveError"
                                   code:-2
                               userInfo:@{
                                 NSLocalizedDescriptionKey: @"Archive contains unsafe absolute path",
                                 @"entryPath": entryPath
                               }];
    }
    return NO;
  }

  NSString *basePath = [[baseURL URLByStandardizingPath] path];
  NSString *destinationPath = [[basePath stringByAppendingPathComponent:normalizedEntry] stringByStandardizingPath];

  if (![self canonicalPath:destinationPath isWithinDirectory:basePath] ||
      [destinationPath isEqualToString:basePath]) {
#if DEBUG
    NSLog(@"[Unarchive] ZIP-SLIP detected: Entry '%@' would escape base directory", entryPath);
#endif
    if (error) {
      *error = [NSError errorWithDomain:@"UnarchiveError"
                                   code:-2
                               userInfo:@{
                                 NSLocalizedDescriptionKey: @"Archive contains unsafe path that attempts to escape extraction directory",
                                 @"entryPath": entryPath
                               }];
    }
    return NO;
  }

  return YES;
}

// Helper method to recursively enumerate all files and preserve relative paths
- (NSArray *)enumerateFilesRecursively:(NSString *)directoryPath
                          baseDirectory:(NSString *)baseDirectory
                            fileManager:(NSFileManager *)fileManager
                                  error:(NSError **)error {
  NSMutableArray *allFiles = [NSMutableArray array];
  NSDirectoryEnumerator *enumerator = [fileManager enumeratorAtPath:directoryPath];

  for (NSString *relativePath in enumerator) {
    NSString *fullPath = [directoryPath stringByAppendingPathComponent:relativePath];
    BOOL isDirectory = NO;
    
    if ([fileManager fileExistsAtPath:fullPath isDirectory:&isDirectory]) {
      if (!isDirectory) {
  // Get file attributes
  NSError * __autoreleasing attrError = nil;
  NSDictionary *attributes = [fileManager attributesOfItemAtPath:fullPath error:&attrError];
        
        if (attrError) {
#if DEBUG
          NSLog(@"[Unarchive] Warning: Could not get attributes for %@: %@", relativePath, attrError.localizedDescription);
#endif
        }

        // Include relativePath in result
        NSMutableDictionary *fileDict = [NSMutableDictionary dictionary];
        fileDict[@"path"] = [baseDirectory stringByAppendingPathComponent:relativePath];
        fileDict[@"name"] = [relativePath lastPathComponent];
        fileDict[@"relativePath"] = relativePath;
        fileDict[@"size"] = attributes[NSFileSize] ?: @0;
        [allFiles addObject:fileDict];
      }
    }
  }

  return allFiles;
}

- (NSNumber *)multiply:(double)a b:(double)b {
  NSNumber *result = @(a * b);

  return result;
}

// Helper methods for single-callback guard
- (void)resolveOnce:(RCTPromiseResolveBlock)resolve
             result:(id)result
           invoked:(std::atomic_bool *)cbInvoked {
  bool expected = false;
  if (cbInvoked->compare_exchange_strong(expected, true)) {
    dispatch_async(dispatch_get_main_queue(), ^{
      resolve(result);
    });
  }
}

- (void)rejectOnce:(RCTPromiseRejectBlock)reject
              code:(NSString *)code
           message:(NSString *)message
             error:(NSError *)error
           invoked:(std::atomic_bool *)cbInvoked {
  bool expected = false;
  if (cbInvoked->compare_exchange_strong(expected, true)) {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(code, message, error);
    });
  }
}

- (void)unarchive:(NSString *)archivePath
       outputPath:(NSString *)outputPath
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {

  // Immediate-busy concurrency check
  bool expected = false;
  if (!_activeExtraction.compare_exchange_strong(expected, true)) {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"UNARCHIVE_BUSY",
             @"Another unarchive operation is already in progress", nil);
    });
    return;
  }

  // Reset cancellation flag for new operation
  _cancellationRequested.store(false);

  // Validate outputPath is within app sandbox
  NSError *sandboxError = nil;
  if (![self isOutputPathInSandbox:outputPath error:&sandboxError]) {
    _activeExtraction.store(false);
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"UNARCHIVE_INVALID_PATH",
             sandboxError.localizedDescription ?: @"Output path must be within app sandbox",
             sandboxError);
    });
    return;
  }

  // Per-invocation callback guard
  std::shared_ptr<std::atomic_bool> cbInvoked =
      std::make_shared<std::atomic_bool>(false);

  dispatch_async(
      dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        // Per-invocation NSFileManager
        NSFileManager *fileManager = [[NSFileManager alloc] init];
        NSError *error = nil;

        // Check if archive file exists
        if (![fileManager fileExistsAtPath:archivePath]) {
          [self rejectOnce:reject
                      code:@"FILE_NOT_FOUND"
                   message:[NSString
                               stringWithFormat:
                                   @"Archive file does not exist: %@",
                                   archivePath]
                     error:nil
                   invoked:cbInvoked.get()];
          _activeExtraction.store(false);
          return;
        }

        // Create unique temporary directory for extraction
        NSString *outputParent = [outputPath stringByDeletingLastPathComponent];
        NSString *tempDirName =
            [NSString stringWithFormat:@".unarchive_temp_%@_%ld",
                                       [[NSUUID UUID] UUIDString],
                                       (long)[[NSDate date] timeIntervalSince1970]];
        NSString *tempPath =
            [outputParent stringByAppendingPathComponent:tempDirName];

        // Track current temp path for cancellation cleanup
        _currentTempPath = tempPath;

        // Create temp directory
        if (![fileManager createDirectoryAtPath:tempPath
                    withIntermediateDirectories:YES
                                     attributes:nil
                                          error:&error]) {
          [self rejectOnce:reject
                      code:@"DIRECTORY_ERROR"
                   message:[NSString
                               stringWithFormat:
                                   @"Failed to create temp directory: %@",
                                   error.localizedDescription]
                     error:error
                   invoked:cbInvoked.get()];
          _activeExtraction.store(false);
          _currentTempPath = nil;
          return;
        }

        // Check for cancellation after temp directory creation
        if (_cancellationRequested.load()) {
#if DEBUG
          NSLog(@"[Unarchive] Cancellation detected before extraction");
#endif
          [fileManager removeItemAtPath:tempPath error:nil];
          [self rejectOnce:reject
                      code:@"UNARCHIVE_CANCELLED"
                   message:@"Extraction was cancelled by user"
                     error:nil
                   invoked:cbInvoked.get()];
          _activeExtraction.store(false);
          _currentTempPath = nil;
          return;
        }

        // Check file extension to determine archive type
        NSString *fileExtension = [[archivePath pathExtension] lowercaseString];

        if ([fileExtension isEqualToString:@"cbr"] ||
            [fileExtension isEqualToString:@"rar"]) {
          // Use UnrarKit for RAR/CBR files
          [self extractCBRFile:archivePath
                      tempPath:tempPath
                    outputPath:outputPath
                   fileManager:fileManager
                     cbInvoked:cbInvoked
                       resolve:resolve
                        reject:reject];

        } else if ([fileExtension isEqualToString:@"cbz"] ||
                   [fileExtension isEqualToString:@"zip"]) {
          // Use SSZipArchive for ZIP/CBZ files
          [self extractCBZFile:archivePath
                      tempPath:tempPath
                    outputPath:outputPath
                   fileManager:fileManager
                     cbInvoked:cbInvoked
                       resolve:resolve
                        reject:reject];

        } else {
          // Clean up temp directory on error
          [fileManager removeItemAtPath:tempPath error:nil];
          [self rejectOnce:reject
                      code:@"UNSUPPORTED_FORMAT"
                   message:@"Unsupported archive format. Only CBR and CBZ files "
                           @"are supported."
                     error:nil
                   invoked:cbInvoked.get()];
          _activeExtraction.store(false);
          _currentTempPath = nil; // Clear temp path
        }
      });
}

// Helper method for CBR extraction using UnrarKit
- (void)extractCBRFile:(NSString *)archivePath
              tempPath:(NSString *)tempPath
            outputPath:(NSString *)outputPath
           fileManager:(NSFileManager *)fileManager
             cbInvoked:(std::shared_ptr<std::atomic_bool>)cbInvoked
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {

#if DEBUG
  NSLog(@"[Unarchive] Starting CBR extraction: %@", [archivePath lastPathComponent]);
#endif

  NSError * __autoreleasing error = nil;
  URKArchive *archive = [[URKArchive alloc] initWithPath:archivePath
                                                   error:&error];

  if (error) {
#if DEBUG
    NSLog(@"[Unarchive] Error: Failed to open CBR archive: %@", error.localizedDescription);
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"ARCHIVE_ERROR"
             message:[NSString stringWithFormat:@"Failed to open CBR archive: %@",
                                                error.localizedDescription]
               error:error
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil; // Clear temp path
    return;
  }

  // Check for cancellation after opening archive
  if (_cancellationRequested.load()) {
#if DEBUG
    NSLog(@"[Unarchive] Cancellation detected after opening archive");
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"UNARCHIVE_CANCELLED"
             message:@"Extraction was cancelled by user"
               error:nil
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil;
    return;
  }

  NSArray<NSString *> *filenames = [archive listFilenames:&error];
  if (error) {
#if DEBUG
    NSLog(@"[Unarchive] Error: Failed to list CBR contents: %@", error.localizedDescription);
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"LIST_ERROR"
             message:[NSString stringWithFormat:@"Failed to list CBR contents: %@",
                                                error.localizedDescription]
               error:error
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil; // Clear temp path
    return;
  }

#if DEBUG
  NSLog(@"[Unarchive] Archive contains %lu entries", (unsigned long)filenames.count);
#endif

  // Check for cancellation before validation
  if (_cancellationRequested.load()) {
#if DEBUG
    NSLog(@"[Unarchive] Cancellation detected before validation");
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"UNARCHIVE_CANCELLED"
             message:@"Extraction was cancelled by user"
               error:nil
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil;
    return;
  }

  // Validate all entry paths for zip-slip before extraction
  NSURL *tempBaseURL = [NSURL fileURLWithPath:tempPath];
  for (NSString *entryPath in filenames) {
    NSError * __autoreleasing pathError = nil;
    if (![self isSafePath:entryPath withinBaseURL:tempBaseURL error:&pathError]) {
      [fileManager removeItemAtPath:tempPath error:nil];
      [self rejectOnce:reject
                  code:@"UNSAFE_PATH"
               message:[NSString stringWithFormat:@"Archive contains unsafe path: %@", entryPath]
                 error:pathError
               invoked:cbInvoked.get()];
      _activeExtraction.store(false);
      _currentTempPath = nil; // Clear temp path
      return;
    }
  }

  NSMutableArray *extractedFiles = [NSMutableArray array];

  // Check for cancellation before extraction
  if (_cancellationRequested.load()) {
#if DEBUG
    NSLog(@"[Unarchive] Cancellation detected before extraction");
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"UNARCHIVE_CANCELLED"
             message:@"Extraction was cancelled by user"
               error:nil
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil;
    return;
  }

  // Extract all files to temp directory
#if DEBUG
  NSLog(@"[Unarchive] Extracting to temp directory: %@", tempPath);
#endif
  BOOL success = [archive extractFilesTo:tempPath overwrite:YES error:&error];

  if (success && !error) {
#if DEBUG
    NSLog(@"[Unarchive] Extraction successful, enumerating files...");
#endif
    // Use recursive enumeration to preserve relative paths
    NSError * __autoreleasing enumError = nil;
    extractedFiles = [[self enumerateFilesRecursively:tempPath
                                        baseDirectory:outputPath
                                          fileManager:fileManager
                                                error:&enumError] mutableCopy];

    if (enumError || extractedFiles.count == 0) {
#if DEBUG
      NSLog(@"[Unarchive] Error: Failed to enumerate extracted files: %@", enumError.localizedDescription);
#endif
      // Include partial diagnostics on failure
      NSError *diagError = enumError;
      NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
      if (enumError) {
        userInfo[NSLocalizedDescriptionKey] = [NSString stringWithFormat:@"Failed to enumerate extracted files: %@", enumError.localizedDescription];
      } else {
        userInfo[NSLocalizedDescriptionKey] = @"No files were extracted from archive";
      }
      userInfo[@"partialFilesCount"] = @(extractedFiles.count);
      userInfo[@"tempPath"] = tempPath;
#if DEBUG
      // Include detailed file list in debug builds only
      if (extractedFiles.count > 0) {
        userInfo[@"partialFilesList"] = extractedFiles;
      }
#endif
      diagError = [NSError errorWithDomain:@"UnarchiveError"
                                      code:-3
                                  userInfo:userInfo];
      
      [fileManager removeItemAtPath:tempPath error:nil];
      [self rejectOnce:reject
                  code:@"LIST_ERROR"
               message:userInfo[NSLocalizedDescriptionKey]
                 error:diagError
               invoked:cbInvoked.get()];
      _activeExtraction.store(false);
      _currentTempPath = nil; // Clear temp path
      return;
    }

#if DEBUG
    NSLog(@"[Unarchive] Enumerated %lu files", (unsigned long)extractedFiles.count);
#endif

    // Check for cancellation after enumeration
    if (_cancellationRequested.load()) {
#if DEBUG
      NSLog(@"[Unarchive] Cancellation detected after enumeration");
#endif
      [fileManager removeItemAtPath:tempPath error:nil];
      [self rejectOnce:reject
                  code:@"UNARCHIVE_CANCELLED"
               message:@"Extraction was cancelled by user"
                 error:nil
               invoked:cbInvoked.get()];
      _activeExtraction.store(false);
      _currentTempPath = nil;
      return;
    }

    // Atomic replace - use replaceItemAtURL for atomic swap
    NSURL *tempURL = [NSURL fileURLWithPath:tempPath];
    NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
    NSURL *resultingURL = nil;
    NSError * __autoreleasing replaceError = nil;

#if DEBUG
    NSLog(@"[Unarchive] Performing atomic replacement to final location");
#endif

    BOOL replaceSuccess = NO;
    if ([fileManager fileExistsAtPath:outputPath]) {
      // Output exists - use atomic replaceItemAtURL
      replaceSuccess = [fileManager replaceItemAtURL:outputURL
                                       withItemAtURL:tempURL
                                      backupItemName:nil
                                             options:NSFileManagerItemReplacementUsingNewMetadataOnly
                                    resultingItemURL:&resultingURL
                                               error:&replaceError];
    } else {
      // Output doesn't exist - simple move
      replaceSuccess = [fileManager moveItemAtURL:tempURL
                                            toURL:outputURL
                                            error:&replaceError];
    }

    if (replaceSuccess) {
#if DEBUG
      NSLog(@"[Unarchive] Extraction completed successfully with %lu files", (unsigned long)extractedFiles.count);
#endif
      // Convert extracted files array to immutable copy for thread safety
      NSArray *filesCopy = [extractedFiles copy];
      NSString *outputPathCopy = [outputPath copy];
      
      // Build result payload on main thread
      dispatch_async(dispatch_get_main_queue(), ^{
        NSDictionary *result = @{
          @"files": filesCopy,
          @"outputPath": outputPathCopy
        };
        [self resolveOnce:resolve result:result invoked:cbInvoked.get()];
        self->_activeExtraction.store(false);
        self->_currentTempPath = nil;
      });
    } else {
#if DEBUG
      NSLog(@"[Unarchive] Error: Atomic replacement failed: %@", replaceError.localizedDescription);
#endif
      [fileManager removeItemAtPath:tempPath error:nil];
      [self rejectOnce:reject
                  code:@"ATOMIC_REPLACE_ERROR"
               message:[NSString
                           stringWithFormat:
                               @"Failed to atomically replace output directory: %@",
                               replaceError.localizedDescription]
                 error:replaceError
               invoked:cbInvoked.get()];
      _activeExtraction.store(false);
      _currentTempPath = nil;
    }
  } else {
#if DEBUG
    NSLog(@"[Unarchive] Error: Extraction failed: %@", error ? error.localizedDescription : @"Unknown error");
#endif
    // Include partial diagnostics on failure
    NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
    userInfo[NSLocalizedDescriptionKey] = [NSString stringWithFormat:@"Failed to extract CBR archive: %@",
                                                                      error ? error.localizedDescription : @"Unknown error"];
    userInfo[@"partialFilesCount"] = @(extractedFiles.count);
    userInfo[@"tempPath"] = tempPath;
#if DEBUG
    // Include partial file list in debug builds only
    if (extractedFiles.count > 0) {
      userInfo[@"partialFilesList"] = extractedFiles;
    }
#endif
    
    NSError *diagError = [NSError errorWithDomain:@"UnarchiveError"
                                             code:-4
                                         userInfo:userInfo];
    
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"EXTRACTION_ERROR"
             message:userInfo[NSLocalizedDescriptionKey]
               error:diagError
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil; // Clear temp path
    return;
  }
}

// Helper method for CBZ extraction using SSZipArchive
- (void)extractCBZFile:(NSString *)archivePath
              tempPath:(NSString *)tempPath
            outputPath:(NSString *)outputPath
           fileManager:(NSFileManager *)fileManager
             cbInvoked:(std::shared_ptr<std::atomic_bool>)cbInvoked
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {

#if DEBUG
  NSLog(@"[Unarchive] Starting CBZ extraction: %@", [archivePath lastPathComponent]);
#endif

  NSError * __autoreleasing error = nil;
  __block NSError *unsafeEntryError = nil;

  // Validate each ZIP entry name before accepting the extraction result.
  BOOL success = [SSZipArchive unzipFileAtPath:archivePath
                                 toDestination:tempPath
                            preserveAttributes:YES
                                     overwrite:YES
                                nestedZipLevel:0
                                      password:nil
                                         error:&error
                                      delegate:nil
                               progressHandler:^(NSString *entry,
                                                 unz_file_info zipInfo,
                                                 long entryNumber,
                                                 long total) {
    (void)zipInfo;
    (void)entryNumber;
    (void)total;
    if (!unsafeEntryError) {
      NSError * __autoreleasing pathError = nil;
      NSURL *tempBaseURL = [NSURL fileURLWithPath:tempPath];
      if (![self isSafePath:entry withinBaseURL:tempBaseURL error:&pathError]) {
        unsafeEntryError = pathError;
      }
    }
  }
                             completionHandler:nil];

  if (!success || unsafeEntryError) {
#if DEBUG
    NSLog(@"[Unarchive] Error: Failed to extract CBZ archive: %@",
          unsafeEntryError ? unsafeEntryError.localizedDescription : error.localizedDescription);
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    NSString *errorCode = unsafeEntryError ? @"UNSAFE_PATH" : @"EXTRACTION_ERROR";
    NSString *errorMessage = unsafeEntryError
        ? @"Archive contains unsafe path that attempts to escape extraction directory"
        : @"Failed to extract CBZ archive using SSZipArchive";
    NSError *reportedError = unsafeEntryError ?: error;
    [self rejectOnce:reject
                code:errorCode
             message:errorMessage
               error:reportedError
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil; // Clear temp path
    return;
  }

  // Check for cancellation after extraction
  if (_cancellationRequested.load()) {
#if DEBUG
    NSLog(@"[Unarchive] Cancellation detected after extraction");
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"UNARCHIVE_CANCELLED"
             message:@"Extraction was cancelled by user"
               error:nil
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil;
    return;
  }

#if DEBUG
  NSLog(@"[Unarchive] Extraction successful, enumerating files...");
#endif

  // Post-extraction validation - verify no files escaped temp directory
  // Canonicalize both the temp directory and each extracted file path so
  // equivalent paths with different representations (for example
  // '/private/var/...' vs '/var/...') do not trigger false positives.
  NSURL *tempBaseURL = [NSURL fileURLWithPath:tempPath];
  NSURL *canonicalTempURL = [[tempBaseURL URLByResolvingSymlinksInPath] URLByStandardizingPath];
  NSString *canonicalTempPath = [canonicalTempURL path];

  NSDirectoryEnumerator *validator = [fileManager enumeratorAtURL:tempBaseURL
                                       includingPropertiesForKeys:nil
                                                          options:0
                                                     errorHandler:nil];
  for (NSURL *fileURL in validator) {
    NSURL *canonicalFileURL = [[fileURL URLByResolvingSymlinksInPath] URLByStandardizingPath];
    NSString *canonicalFilePath = [canonicalFileURL path];

    if (![self canonicalPath:canonicalFilePath isWithinDirectory:canonicalTempPath]) {
#if DEBUG
      NSLog(@"[Unarchive] Error: File escaped temp directory: %@ (canonical: %@), temp: %@", [fileURL path], canonicalFilePath, canonicalTempPath);
#endif
      [fileManager removeItemAtPath:tempPath error:nil];

      NSError *pathError = [NSError errorWithDomain:@"UnarchiveError"
                                               code:-2
                                           userInfo:@{
                                             NSLocalizedDescriptionKey: @"Archive contains unsafe path that attempts to escape extraction directory",
                                             @"filePath": canonicalFilePath,
                                             @"tempPath": canonicalTempPath
                                           }];

      [self rejectOnce:reject
                  code:@"UNSAFE_PATH"
               message:@"Archive contained files that attempted to escape extraction directory"
                 error:pathError
               invoked:cbInvoked.get()];
      _activeExtraction.store(false);
      _currentTempPath = nil; // Clear temp path
      return;
    }
  }

  // Use recursive enumeration to preserve relative paths
  NSError * __autoreleasing enumError = nil;
  NSMutableArray *extractedFiles = [[self enumerateFilesRecursively:tempPath
                                                      baseDirectory:outputPath
                                                        fileManager:fileManager
                                                              error:&enumError] mutableCopy];

  if (enumError || extractedFiles.count == 0) {
#if DEBUG
    NSLog(@"[Unarchive] Error: Failed to enumerate extracted files: %@", enumError.localizedDescription);
#endif
    // Include partial diagnostics on failure
    NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
    if (enumError) {
      userInfo[NSLocalizedDescriptionKey] = [NSString stringWithFormat:@"Failed to enumerate extracted files: %@", enumError.localizedDescription];
    } else {
      userInfo[NSLocalizedDescriptionKey] = @"No files were extracted from archive";
    }
    userInfo[@"partialFilesCount"] = @(extractedFiles.count);
    userInfo[@"tempPath"] = tempPath;
#if DEBUG
    if (extractedFiles.count > 0) {
      userInfo[@"partialFilesList"] = extractedFiles;
    }
#endif
    NSError *diagError = [NSError errorWithDomain:@"UnarchiveError"
                                             code:-5
                                         userInfo:userInfo];
    
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"LIST_ERROR"
             message:userInfo[NSLocalizedDescriptionKey]
               error:diagError
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil; // Clear temp path
    return;
  }

#if DEBUG
  NSLog(@"[Unarchive] Enumerated %lu files", (unsigned long)extractedFiles.count);
#endif

  // Check for cancellation after enumeration
  if (_cancellationRequested.load()) {
#if DEBUG
    NSLog(@"[Unarchive] Cancellation detected after enumeration");
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"UNARCHIVE_CANCELLED"
             message:@"Extraction was cancelled by user"
               error:nil
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil;
    return;
  }

  // Atomic replace - use replaceItemAtURL for atomic swap
  NSURL *tempURL = [NSURL fileURLWithPath:tempPath];
  NSURL *outputURL = [NSURL fileURLWithPath:outputPath];
  NSURL *resultingURL = nil;
  NSError * __autoreleasing replaceError = nil;

#if DEBUG
  NSLog(@"[Unarchive] Performing atomic replacement to final location");
#endif

  BOOL replaceSuccess = NO;
  if ([fileManager fileExistsAtPath:outputPath]) {
    // Output exists - use atomic replaceItemAtURL
    replaceSuccess = [fileManager replaceItemAtURL:outputURL
                                     withItemAtURL:tempURL
                                    backupItemName:nil
                                           options:NSFileManagerItemReplacementUsingNewMetadataOnly
                                  resultingItemURL:&resultingURL
                                             error:&replaceError];
  } else {
    // Output doesn't exist - simple move
    replaceSuccess = [fileManager moveItemAtURL:tempURL
                                          toURL:outputURL
                                          error:&replaceError];
  }

  if (replaceSuccess) {
#if DEBUG
    NSLog(@"[Unarchive] Extraction completed successfully with %lu files", (unsigned long)extractedFiles.count);
#endif
    // Convert extracted files array to immutable copy for thread safety
    NSArray *filesCopy = [extractedFiles copy];
    NSString *outputPathCopy = [outputPath copy];
    
    // Build result payload on main thread
    dispatch_async(dispatch_get_main_queue(), ^{
      NSDictionary *result = @{
        @"files": filesCopy,
        @"outputPath": outputPathCopy
      };
      [self resolveOnce:resolve result:result invoked:cbInvoked.get()];
      self->_activeExtraction.store(false);
      self->_currentTempPath = nil;
    });
  } else {
#if DEBUG
    NSLog(@"[Unarchive] Error: Atomic replacement failed: %@", replaceError.localizedDescription);
#endif
    [fileManager removeItemAtPath:tempPath error:nil];
    [self rejectOnce:reject
                code:@"ATOMIC_REPLACE_ERROR"
             message:[NSString
                         stringWithFormat:
                             @"Failed to atomically replace output directory: %@",
                             replaceError.localizedDescription]
               error:replaceError
             invoked:cbInvoked.get()];
    _activeExtraction.store(false);
    _currentTempPath = nil;
  }
}

// Helper method to get the app's documents directory
// Cancellation API
- (void)cancelUnarchive:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
#if DEBUG
  NSLog(@"[Unarchive] Cancellation requested");
#endif

  // Set cancellation flag
  _cancellationRequested.store(true);

  // Give the extraction operation time to notice cancellation and clean up
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
                 dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    // Try to clean up temp directory if it exists
    NSString *tempPath = self->_currentTempPath;
    if (tempPath) {
      NSFileManager *fileManager = [[NSFileManager alloc] init];
  NSError * __autoreleasing cleanupError = nil;
      if ([fileManager fileExistsAtPath:tempPath]) {
#if DEBUG
        NSLog(@"[Unarchive] Cleaning up temp directory: %@", tempPath);
#endif
        [fileManager removeItemAtPath:tempPath error:&cleanupError];
        if (cleanupError) {
#if DEBUG
          NSLog(@"[Unarchive] Warning: Failed to clean up temp directory: %@",
                cleanupError.localizedDescription);
#endif
        }
      }
    }

    dispatch_async(dispatch_get_main_queue(), ^{
#if DEBUG
      NSLog(@"[Unarchive] Cancellation completed");
#endif
      resolve(@{@"cancelled": @YES});
    });
  });
}

- (NSString *)documentsDirectory {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,
                                                       NSUserDomainMask, YES);
  return [paths firstObject];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeUnarchiveSpecJSI>(params);
}

@end
