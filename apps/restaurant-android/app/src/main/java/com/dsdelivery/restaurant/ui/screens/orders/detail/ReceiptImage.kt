package com.dsdelivery.restaurant.ui.screens.orders.detail

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayOutputStream
import kotlin.math.max

/**
 * Turns a photo picked from the gallery/camera into the receipt upload: decoded with a sample size (a 12 MP photo never sits fully in memory),
 * rotated by its EXIF orientation, scaled so the longest side is at most [MAX_SIDE] px and re-encoded as JPEG under the server limit (5 MB).
 * Returns null when the file is not a readable image. Blocking: call it off the main thread.
 */
object ReceiptImage {
    private const val MAX_SIDE = 1800
    private const val TARGET_BYTES = 3 * 1024 * 1024
    private const val MIN_BYTES = 1024

    fun compressToJpeg(context: Context, uri: Uri): ByteArray? = try {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val longest = max(bounds.outWidth, bounds.outHeight)
        if (longest <= 0) null else {
            var sample = 1
            while (longest / (sample * 2) >= MAX_SIDE) sample *= 2
            val decoded = resolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            }
            if (decoded == null) null else {
                val rotation = resolver.openInputStream(uri)?.use { exifRotation(ExifInterface(it)) } ?: 0
                val scale = MAX_SIDE.toFloat() / max(decoded.width, decoded.height)
                val matrix = Matrix().apply {
                    if (scale < 1f) postScale(scale, scale)
                    if (rotation != 0) postRotate(rotation.toFloat())
                }
                val bitmap = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
                var quality = 88
                var bytes: ByteArray
                do {
                    val out = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
                    bytes = out.toByteArray()
                    quality -= 12
                } while (bytes.size > TARGET_BYTES && quality > 30)
                if (bytes.size < MIN_BYTES || bytes.size > 5 * 1024 * 1024) null else bytes
            }
        }
    } catch (e: Exception) {
        null
    }

    private fun exifRotation(exif: ExifInterface): Int = when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
    }
}
