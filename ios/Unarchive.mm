#import "Unarchive.h"

@implementation Unarchive
RCT_EXPORT_MODULE()

- (NSNumber *)multiply:(double)a b:(double)b {
  NSNumber *result = @(a * b);

  return result;
}

- (void)unarchive:(NSString *)archivePath
       outputPath:(NSString *)outputPath
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {

  dispatch_async(
      dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        NSError *error = nil;

        // Check if archive file exists
        if (![[NSFileManager defaultManager] fileExistsAtPath:archivePath]) {
          dispatch_async(dispatch_get_main_queue(), ^{
            reject(
                @"FILE_NOT_FOUND",
                [NSString stringWithFormat:@"Archive file does not exist: %@",
                                           archivePath],
                nil);
          });
          return;
        }

        // Create output directory if it doesn't exist
        [[NSFileManager defaultManager] createDirectoryAtPath:outputPath
                                  withIntermediateDirectories:YES
                                                   attributes:nil
                                                        error:&error];
        if (error) {
          dispatch_async(dispatch_get_main_queue(), ^{
            reject(
                @"DIRECTORY_ERROR",
                [NSString
                    stringWithFormat:@"Failed to create output directory: %@",
                                     error.localizedDescription],
                error);
          });
          return;
        }

        // Check file extension to determine archive type
        NSString *fileExtension = [[archivePath pathExtension] lowercaseString];

        if ([fileExtension isEqualToString:@"cbr"] ||
            [fileExtension isEqualToString:@"rar"]) {
          // Use UnrarKit for RAR/CBR files
          [self extractCBRFile:archivePath
                    outputPath:outputPath
                       resolve:resolve
                        reject:reject];

        } else if ([fileExtension isEqualToString:@"cbz"] ||
                   [fileExtension isEqualToString:@"zip"]) {
          // Use SSZipArchive for ZIP/CBZ files
          [self extractCBZFile:archivePath
                    outputPath:outputPath
                       resolve:resolve
                        reject:reject];

        } else {
          dispatch_async(dispatch_get_main_queue(), ^{
            reject(@"UNSUPPORTED_FORMAT",
                   @"Unsupported archive format. Only CBR and CBZ files are "
                   @"supported.",
                   nil);
          });
        }
      });
}

// Helper method for CBR extraction using UnrarKit
- (void)extractCBRFile:(NSString *)archivePath
            outputPath:(NSString *)outputPath
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {

  NSError *error = nil;
  URKArchive *archive = [[URKArchive alloc] initWithPath:archivePath
                                                   error:&error];

  if (error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"ARCHIVE_ERROR",
             [NSString stringWithFormat:@"Failed to open CBR archive: %@",
                                        error.localizedDescription],
             error);
    });
    return;
  }

  NSArray<NSString *> *filenames = [archive listFilenames:&error];
  if (error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"LIST_ERROR",
             [NSString stringWithFormat:@"Failed to list CBR contents: %@",
                                        error.localizedDescription],
             error);
    });
    return;
  }

  NSMutableArray *extractedFiles = [NSMutableArray array];

  // Extract all files from the CBR archive
  BOOL success = [archive extractFilesTo:outputPath overwrite:YES error:&error];

  if (success && !error) {
    // List extracted files
    NSError *listError = nil;
    NSArray *extractedFileNames =
        [[NSFileManager defaultManager] contentsOfDirectoryAtPath:outputPath
                                                            error:&listError];

    if (listError) {
      dispatch_async(dispatch_get_main_queue(), ^{
        reject(@"LIST_ERROR",
               [NSString stringWithFormat:@"Failed to list extracted files: %@",
                                          listError.localizedDescription],
               listError);
      });
      return;
    }

    // Filter only filenames that were originally in the archive
    for (NSString *originalFilename in filenames) {
      NSString *baseFilename = [originalFilename lastPathComponent];
      if ([extractedFileNames containsObject:baseFilename]) {
        NSString *filePath =
            [outputPath stringByAppendingPathComponent:baseFilename];

        // Get file attributes for size
        NSDictionary *attributes =
            [[NSFileManager defaultManager] attributesOfItemAtPath:filePath
                                                             error:nil];

        NSMutableDictionary *fileDict = [NSMutableDictionary dictionary];
        fileDict[@"path"] = filePath;
        fileDict[@"name"] = baseFilename;
        fileDict[@"size"] = attributes[NSFileSize] ?: @0;
        [extractedFiles addObject:fileDict];
      }
    }
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"EXTRACTION_ERROR",
             [NSString stringWithFormat:@"Failed to extract CBR archive: %@",
                                        error ? error.localizedDescription
                                              : @"Unknown error"],
             error);
    });
    return;
  }

  NSDictionary *result =
      @{@"files" : extractedFiles, @"outputPath" : outputPath};

  dispatch_async(dispatch_get_main_queue(), ^{
    resolve(result);
  });
}

// Helper method for CBZ extraction using SSZipArchive
- (void)extractCBZFile:(NSString *)archivePath
            outputPath:(NSString *)outputPath
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {

  BOOL success = [SSZipArchive unzipFileAtPath:archivePath
                                 toDestination:outputPath];

  if (!success) {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"EXTRACTION_ERROR",
             @"Failed to extract CBZ archive using SSZipArchive", nil);
    });
    return;
  }

  // Get list of extracted files
  NSMutableArray *extractedFiles = [NSMutableArray array];
  NSError *error = nil;
  NSArray *contents =
      [[NSFileManager defaultManager] contentsOfDirectoryAtPath:outputPath
                                                          error:&error];

  if (error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      reject(@"LIST_ERROR",
             [NSString stringWithFormat:@"Failed to list extracted files: %@",
                                        error.localizedDescription],
             error);
    });
    return;
  }

  for (NSString *filename in contents) {
    NSString *filePath = [outputPath stringByAppendingPathComponent:filename];
    NSDictionary *attributes =
        [[NSFileManager defaultManager] attributesOfItemAtPath:filePath
                                                         error:nil];

    NSMutableDictionary *fileDict = [NSMutableDictionary dictionary];
    fileDict[@"path"] = filePath;
    fileDict[@"name"] = filename;
    fileDict[@"size"] = attributes[NSFileSize] ?: @0;
    [extractedFiles addObject:fileDict];
  }

  NSDictionary *result =
      @{@"files" : extractedFiles, @"outputPath" : outputPath};

  dispatch_async(dispatch_get_main_queue(), ^{
    resolve(result);
  });
}

// Helper method to get the app's documents directory
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
