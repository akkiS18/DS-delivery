package com.dsdelivery.admin.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayOutputStream
import kotlin.math.max

/**
 * Shrinks a gallery photo before it is uploaded as the restaurant's picture: longest side 1280 px, JPEG, well under the server's 3 MB limit,
 * so it also goes through on a weak mobile connection. The server still decides the real type from the bytes.
 */
object ImagePrep {
    const val MAX_SIDE = 1280
    const val MAX_BYTES = 900_000

    /** Power-of-two decode step: keeps the decoded bitmap at most about twice the target size (saves memory on 12 MP photos). */
    fun sampleSizeFor(width: Int, height: Int, maxSide: Int = MAX_SIDE): Int {
        var sample = 1
        while (max(width, height) / (sample * 2) >= maxSide) sample *= 2
        return sample
    }

    /** 1.0 when the picture already fits, otherwise the factor that brings its longest side to [maxSide]. */
    fun scaleFor(width: Int, height: Int, maxSide: Int = MAX_SIDE): Float {
        val longest = max(width, height)
        return if (longest <= maxSide || longest <= 0) 1f else maxSide.toFloat() / longest
    }

    /** Null when the file cannot be read as a picture. Blocking: call from a background dispatcher. */
    fun prepare(context: Context, uri: Uri): ByteArray? = try {
        shrink(context, uri)
    } catch (e: Exception) {
        null
    } catch (e: OutOfMemoryError) {
        null
    }

    private fun shrink(context: Context, uri: Uri): ByteArray? {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val opts = BitmapFactory.Options().apply { inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight) }
        val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
        val orientation = resolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            ?: ExifInterface.ORIENTATION_NORMAL
        val rotation = rotationOf(orientation)
        val scale = scaleFor(decoded.width, decoded.height)
        val matrix = Matrix().apply {
            if (scale < 1f) postScale(scale, scale)
            if (rotation != 0f) postRotate(rotation)
        }
        val bitmap = if (matrix.isIdentity) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        var quality = 88
        var bytes = compress(bitmap, quality)
        while (bytes.size > MAX_BYTES && quality > 50) {
            quality -= 10
            bytes = compress(bitmap, quality)
        }
        return bytes
    }

    private fun compress(bitmap: Bitmap, quality: Int): ByteArray {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        return out.toByteArray()
    }

    private fun rotationOf(orientation: Int): Float = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
}
