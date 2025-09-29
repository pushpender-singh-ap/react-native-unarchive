package com.unarchive

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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@ReactModule(name = UnarchiveModule.NAME)
class UnarchiveModule(reactContext: ReactApplicationContext) :
  NativeUnarchiveSpec(reactContext) {

  override fun getName(): String {
    return NAME
  }

  // Example method
  // See https://reactnative.dev/docs/native-modules-android
  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  override fun unarchive(archivePath: String, outputPath: String, promise: Promise) {
    CoroutineScope(Dispatchers.IO).launch {
      try {
        val archiveFile = File(archivePath)
        if (!archiveFile.exists()) {
          promise.reject("FILE_NOT_FOUND", "Archive file does not exist: $archivePath")
          return@launch
        }

        val outputDir = File(outputPath)
        if (!outputDir.exists()) {
          outputDir.mkdirs()
        }

        val randomAccessFile = RandomAccessFile(archiveFile, "r")
        val inStream = RandomAccessFileInStream(randomAccessFile)
        val inArchive: IInArchive = SevenZip.openInArchive(null, inStream)

        val extractedFiles = WritableNativeArray()
        
        try {
          val simpleInArchive = inArchive.simpleInterface
          val items = simpleInArchive.archiveItems

          for (item in items) {
            if (!item.isFolder) {
              val itemPath = item.path ?: "unknown_file"
              val outputFile = File(outputDir, itemPath)
              
              // Create parent directories if they don't exist
              outputFile.parentFile?.mkdirs()
              
              // Delete existing file if it exists to ensure clean extraction
              if (outputFile.exists()) {
                outputFile.delete()
              }
              
              try {
                // Extract the entire file content at once
                val extractResult = item.extractSlow { data ->
                  try {
                    // Append mode to handle multiple data chunks
                    FileOutputStream(outputFile, true).use { fos ->
                      fos.write(data)
                      fos.flush()
                    }
                    data.size
                  } catch (e: Exception) {
                    android.util.Log.e("UnarchiveModule", "Error writing chunk for $itemPath: ${e.message}", e)
                    0
                  }
                }
                
                // Verify extraction was successful
                if (extractResult == ExtractOperationResult.OK && outputFile.exists() && outputFile.length() > 0) {
                  val fileInfo = WritableNativeMap()
                  fileInfo.putString("path", outputFile.absolutePath)
                  fileInfo.putString("name", outputFile.name)
                  fileInfo.putDouble("size", outputFile.length().toDouble())
                  extractedFiles.pushMap(fileInfo)
                  android.util.Log.d("UnarchiveModule", "Successfully extracted: $itemPath (${outputFile.length()} bytes)")
                } else {
                  android.util.Log.w("UnarchiveModule", "Extraction failed or file is empty: $itemPath, result: $extractResult")
                  // Clean up empty or failed files
                  if (outputFile.exists() && outputFile.length() == 0L) {
                    outputFile.delete()
                  }
                }
              } catch (e: Exception) {
                android.util.Log.e("UnarchiveModule", "Exception during extraction of $itemPath: ${e.message}", e)
                // Clean up partial files
                if (outputFile.exists()) {
                  outputFile.delete()
                }
              }
            }
          }

          val result = WritableNativeMap()
          result.putArray("files", extractedFiles)
          result.putString("outputPath", outputPath)
          
          withContext(Dispatchers.Main) {
            promise.resolve(result)
          }

        } finally {
          inArchive.close()
          inStream.close()
          randomAccessFile.close()
        }
        
      } catch (e: Exception) {
        withContext(Dispatchers.Main) {
          promise.reject("EXTRACTION_ERROR", "Failed to extract archive: ${e.message}", e)
        }
      }
    }
  }

  companion object {
    const val NAME = "Unarchive"
  }
}
