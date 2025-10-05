package com.unarchive

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.module.annotations.ReactModule
import net.sf.sevenzipjbinding.SevenZip
import net.sf.sevenzipjbinding.IInArchive
import net.sf.sevenzipjbinding.ExtractOperationResult
import net.sf.sevenzipjbinding.impl.RandomAccessFileInStream
import net.sf.sevenzipjbinding.simple.ISimpleInArchiveItem
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@ReactModule(name = UnarchiveModule.NAME)
class UnarchiveModule(reactContext: ReactApplicationContext) :
  NativeUnarchiveSpec(reactContext) {

  // Module-level concurrency guard
  private val activeExtraction = AtomicBoolean(false)
  
  // Track active job for cancellation
  private val currentJobRef = AtomicReference<Job?>(null)

  override fun getName(): String {
    return NAME
  }

  // Example method
  // See https://reactnative.dev/docs/native-modules-android
  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  // Enforce allowed output roots
  private fun isPathAllowed(path: String): Boolean {
    try {
      val file = File(path).canonicalFile
      val canonicalPath = file.path
      
      val allowedRoots = listOf(
        reactApplicationContext.filesDir.canonicalPath,
        reactApplicationContext.cacheDir.canonicalPath,
        reactApplicationContext.getExternalFilesDir(null)?.canonicalPath
      ).filterNotNull()
      
      return allowedRoots.any { root ->
        canonicalPath.startsWith(root)
      }
    } catch (e: Exception) {
      return false
    }
  }

  // Zip-slip sanitization per entry
  private fun isSafeEntryPath(entryPath: String, tempDir: File): File? {
    try {
      val destFile = File(tempDir, entryPath).canonicalFile
      val tempDirCanonical = tempDir.canonicalPath + File.separator
      
      if (!destFile.path.startsWith(tempDirCanonical)) {
        return null
      }
      return destFile
    } catch (e: Exception) {
      return null
    }
  }

  // Atomic move with fallback
  private fun atomicMoveOrFallback(source: File, dest: File): Boolean {
    try {
      // Try atomic move first
      try {
        Files.move(source.toPath(), dest.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        return true
      } catch (e: UnsupportedOperationException) {
        // Atomic move not supported, use fallback
        debugLog("Atomic move not supported, using fallback strategy")
      } catch (e: Exception) {
        debugLog("Atomic move failed: ${e.message}, trying fallback")
      }
      
      // Fallback: rename-with-backup strategy
      val backupFile = if (dest.exists()) {
        File(dest.parentFile, "${dest.name}.backup.${UUID.randomUUID()}")
      } else null
      
      try {
        // Backup existing destination if it exists
        if (backupFile != null && dest.exists()) {
          if (!dest.renameTo(backupFile)) {
            return false
          }
        }
        
        // Move temp to destination
        if (!source.renameTo(dest)) {
          // Restore backup on failure
          if (backupFile != null && backupFile.exists()) {
            backupFile.renameTo(dest)
          }
          return false
        }
        
        // Delete backup on success
        backupFile?.delete()
        return true
      } catch (e: Exception) {
        // Attempt to restore backup on any error
        if (backupFile != null && backupFile.exists()) {
          try {
            backupFile.renameTo(dest)
          } catch (restoreError: Exception) {
            Log.e(TAG, "Failed to restore backup: ${restoreError.message}")
          }
        }
        throw e
      }
    } catch (e: Exception) {
      Log.e(TAG, "Move operation failed: ${e.message}", e)
      return false
    }
  }

  override fun unarchive(archivePath: String, outputPath: String, promise: Promise) {
    // Immediate busy rejection
    if (!activeExtraction.compareAndSet(false, true)) {
      promise.reject("UNARCHIVE_BUSY", "Another unarchive operation is already in progress")
      return
    }

    // Enforce allowed output roots
    if (!isPathAllowed(outputPath)) {
      activeExtraction.set(false)
      promise.reject("UNARCHIVE_INVALID_PATH", "Output path is outside allowed app directories: $outputPath")
      return
    }

    debugLog("Starting unarchive: $archivePath -> $outputPath")

    // Single-callback guard per invocation
    val cbInvoked = AtomicBoolean(false)
    
    fun resolveOnce(result: WritableMap) {
      if (cbInvoked.compareAndSet(false, true)) {
        CoroutineScope(Dispatchers.Main).launch {
          promise.resolve(result)
        }
      }
    }
    
    fun rejectOnce(code: String, message: String, error: Throwable? = null, userInfo: WritableMap? = null) {
      if (cbInvoked.compareAndSet(false, true)) {
        CoroutineScope(Dispatchers.Main).launch {
          if (userInfo != null) {
            promise.reject(code, message, error, userInfo)
          } else {
            promise.reject(code, message, error)
          }
        }
      }
    }

    // Store job for cancellation
    val job = CoroutineScope(Dispatchers.IO).launch {
      var tempDir: File? = null
      var randomAccessFile: RandomAccessFile? = null
      var inStream: RandomAccessFileInStream? = null
      var inArchive: IInArchive? = null
      
      // Collect data as POJOs for main-thread conversion
      data class ExtractedFileInfo(val path: String, val name: String, val relativePath: String, val size: Long)
      val extractedFilesList = mutableListOf<ExtractedFileInfo>()
      
      try {
        val archiveFile = File(archivePath)
        if (!archiveFile.exists()) {
          rejectOnce("FILE_NOT_FOUND", "Archive file does not exist: $archivePath")
          return@launch
        }

        // Check for cancellation
        if (!isActive) {
          rejectOnce("UNARCHIVE_CANCELLED", "Unarchive operation cancelled by user")
          return@launch
        }

        // Create temp directory for extraction
        val outputDir = File(outputPath)
        val tempDirName = "unarchive_temp_${UUID.randomUUID()}_${System.currentTimeMillis()}"
        tempDir = File(outputDir.parentFile, tempDirName)
        
        if (!tempDir.mkdirs()) {
          rejectOnce("TEMP_DIR_CREATION_FAILED", "Failed to create temporary directory: ${tempDir.absolutePath}")
          return@launch
        }

        debugLog("Created temp directory: ${tempDir.absolutePath}")

        randomAccessFile = RandomAccessFile(archiveFile, "r")
        inStream = RandomAccessFileInStream(randomAccessFile)
        inArchive = SevenZip.openInArchive(null, inStream)

        debugLog("Opened archive successfully")

        try {
          val simpleInArchive = inArchive.simpleInterface
          val items = simpleInArchive.archiveItems
          
          debugLog("Archive contains ${items.size} items")

          // Check for cancellation
          if (!isActive) {
            rejectOnce("UNARCHIVE_CANCELLED", "Unarchive operation cancelled by user")
            return@launch
          }

          for ((index, item) in items.withIndex()) {
            // Check for cancellation cooperatively
            if (!isActive) {
              debugLog("Cancellation detected at entry $index")
              rejectOnce("UNARCHIVE_CANCELLED", "Unarchive operation cancelled by user")
              return@launch
            }

            if (!item.isFolder) {
              val itemPath = item.path ?: "unknown_file_$index"
              
              debugLog("Processing entry: $itemPath")

              // Zip-slip sanitization
              val outputFile = isSafeEntryPath(itemPath, tempDir)
              if (outputFile == null) {
                val errorMsg = "Unsafe entry path detected (ZIP-SLIP): $itemPath"
                Log.e(TAG, errorMsg)
                rejectOnce("UNARCHIVE_ENTRY_INVALID", errorMsg)
                return@launch
              }
              
              // Create parent directories if they don't exist
              outputFile.parentFile?.mkdirs()
              
              // Delete existing file if it exists to ensure clean extraction
              if (outputFile.exists()) {
                outputFile.delete()
              }
              
              try {
                // Single FileOutputStream per entry
                var fos: FileOutputStream? = null
                
                val extractResult = item.extractSlow { data ->
                  try {
                    // Open stream on first chunk
                    if (fos == null) {
                      fos = FileOutputStream(outputFile, false)
                    }
                    
                    fos?.write(data)
                    data.size
                  } catch (e: Exception) {
                    Log.e(TAG, "Error writing chunk for $itemPath: ${e.message}", e)
                    fos?.close()
                    fos = null
                    if (outputFile.exists()) {
                      outputFile.delete()
                    }
                    0
                  }
                }
                
                // Close stream after all chunks
                try {
                  fos?.flush()
                  fos?.close()
                } catch (e: Exception) {
                  Log.e(TAG, "Error closing stream for $itemPath: ${e.message}", e)
                }
                
                // Verify extraction was successful
                if (extractResult == ExtractOperationResult.OK && outputFile.exists() && outputFile.length() > 0) {
                  // Collect as POJO
                  val relativePath = tempDir.toPath().relativize(outputFile.toPath()).toString()
                  extractedFilesList.add(
                    ExtractedFileInfo(
                      path = outputFile.absolutePath,
                      name = outputFile.name,
                      relativePath = relativePath,
                      size = outputFile.length()
                    )
                  )
                  debugLog("Successfully extracted: $itemPath (${outputFile.length()} bytes)")
                } else {
                  Log.w(TAG, "Extraction failed or file is empty: $itemPath, result: $extractResult")
                  // Clean up empty or failed files
                  if (outputFile.exists() && outputFile.length() == 0L) {
                    outputFile.delete()
                  }
                }
              } catch (e: Exception) {
                Log.e(TAG, "Exception during extraction of $itemPath: ${e.message}", e)
                // Clean up partial files
                if (outputFile.exists()) {
                  outputFile.delete()
                }
              }
            }
          }

          // Check for cancellation before final move
          if (!isActive) {
            rejectOnce("UNARCHIVE_CANCELLED", "Unarchive operation cancelled by user")
            return@launch
          }

          // Atomic move from temp to final destination
          if (outputDir.exists()) {
            outputDir.deleteRecursively()
          }
          
          val moveSuccess = atomicMoveOrFallback(tempDir, outputDir)
          
          if (!moveSuccess) {
            val errorInfo = WritableNativeMap()
            errorInfo.putInt("partialFilesCount", extractedFilesList.size)
            errorInfo.putString("tempPath", tempDir.absolutePath)
            
            // Debug diagnostics
            if (BuildConfig.DEBUG) {
              val partialFiles = WritableNativeArray()
              extractedFilesList.forEach { fileInfo ->
                partialFiles.pushString(fileInfo.relativePath)
              }
              errorInfo.putArray("partialFilesList", partialFiles)
            }
            
            rejectOnce("ATOMIC_MOVE_FAILED", "Failed to move extracted files to final destination", null, errorInfo)
            return@launch
          }
          
          debugLog("Atomic move completed successfully")
          
          // After atomic move, files are now in outputDir with the same relative structure
          // We need to enumerate the actual files in the final location to get correct paths
          val finalFilesList = mutableListOf<ExtractedFileInfo>()
          
          // Recursively enumerate all files in the output directory
          fun enumerateFiles(dir: File, baseDir: File) {
            dir.listFiles()?.forEach { file ->
              if (file.isDirectory) {
                enumerateFiles(file, baseDir)
              } else {
                val relativePath = baseDir.toPath().relativize(file.toPath()).toString()
                finalFilesList.add(
                  ExtractedFileInfo(
                    path = file.absolutePath,
                    name = file.name,
                    relativePath = relativePath,
                    size = file.length()
                  )
                )
                debugLog("Final file: ${file.absolutePath} (${file.length()} bytes)")
              }
            }
          }
          
          enumerateFiles(outputDir, outputDir)
          debugLog("Enumerated ${finalFilesList.size} files in final location")

          // Convert to WritableMap on main thread
          withContext(Dispatchers.Main) {
            val extractedFiles = WritableNativeArray()
            finalFilesList.forEach { fileInfo ->
              val fileInfoMap = WritableNativeMap()
              fileInfoMap.putString("path", fileInfo.path)
              fileInfoMap.putString("name", fileInfo.name)
              fileInfoMap.putString("relativePath", fileInfo.relativePath)
              fileInfoMap.putDouble("size", fileInfo.size.toDouble())
              extractedFiles.pushMap(fileInfoMap)
            }

            val result = WritableNativeMap()
            result.putArray("files", extractedFiles)
            result.putString("outputPath", outputPath)
            
            resolveOnce(result)
          }
          
          debugLog("Unarchive completed successfully, extracted ${finalFilesList.size} files")

        } finally {
          inArchive?.close()
          inStream?.close()
          randomAccessFile?.close()
        }
        
      } catch (e: Exception) {
        Log.e(TAG, "Extraction error: ${e.message}", e)

        // Include partial extraction diagnostics
        val errorInfo = WritableNativeMap()
        errorInfo.putInt("partialFilesCount", extractedFilesList.size)
        if (tempDir != null) {
          errorInfo.putString("tempPath", tempDir.absolutePath)
        }
        
        if (BuildConfig.DEBUG) {
          val partialFiles = WritableNativeArray()
          extractedFilesList.forEach { fileInfo ->
            partialFiles.pushString(fileInfo.relativePath)
          }
          errorInfo.putArray("partialFilesList", partialFiles)
        }
        
        rejectOnce("EXTRACTION_ERROR", "Failed to extract archive: ${e.message}", e, errorInfo)
      } finally {
        // Cleanup temp directory if it still exists
        try {
          tempDir?.let {
            if (it.exists()) {
              debugLog("Cleaning up temp directory: ${it.absolutePath}")
              it.deleteRecursively()
            }
          }
        } catch (e: Exception) {
          Log.e(TAG, "Failed to cleanup temp directory: ${e.message}", e)
        }

        // Release busy lock
        activeExtraction.set(false)
        // Clear job reference
        currentJobRef.set(null)
      }
    }

    // Store job for cancellation
    currentJobRef.set(job)
  }

  // Cancellation API
  override fun cancelUnarchive(promise: Promise) {
    CoroutineScope(Dispatchers.IO).launch {
      try {
        val job = currentJobRef.get()
        if (job == null) {
          withContext(Dispatchers.Main) {
            val result = WritableNativeMap()
            result.putBoolean("cancelled", false)
            promise.resolve(result)
          }
          return@launch
        }

        debugLog("Cancelling active unarchive operation")
        
        // Cancel the job
        job.cancel()
        
        // Wait for cleanup to complete
        job.join()
        
        debugLog("Cancellation completed")
        
        withContext(Dispatchers.Main) {
          val result = WritableNativeMap()
          result.putBoolean("cancelled", true)
          promise.resolve(result)
        }
      } catch (e: Exception) {
        withContext(Dispatchers.Main) {
          promise.reject("CANCELLATION_ERROR", "Failed to cancel unarchive: ${e.message}", e)
        }
      }
    }
  }

  // Debug logging helper
  private fun debugLog(message: String) {
    if (BuildConfig.DEBUG) {
      Log.d(TAG, message)
    }
  }

  companion object {
    const val NAME = "Unarchive"
    private const val TAG = "UnarchiveModule"
  }
}
