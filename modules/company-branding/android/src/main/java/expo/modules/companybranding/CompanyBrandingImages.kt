package expo.modules.companybranding

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.Base64

internal object CompanyBrandingImages {
  private const val MAX_BYTES = 512 * 1024
  private const val ICON_SIZE = 256
  private val cache = CompanyLogoCache()

  suspend fun resolve(dataUri: String?, httpsUrl: String?): Bitmap? {
    decode(dataUri)?.let { return it }
    if (httpsUrl == null || !CompanyLogoPolicy.validUrl(httpsUrl)) return null
    return brandingAttempt {
      val urlHash = CompanyLogoPolicy.hash(httpsUrl.toByteArray(Charsets.UTF_8))
      val logo = cache.get(urlHash) ?: CompanyLogoDownloader.download(httpsUrl) ?: return@brandingAttempt null
      val bitmap = decodeBytes(logo) ?: return@brandingAttempt null
      cache.put(urlHash, logo)
      bitmap
    }
  }

  fun decode(dataUri: String?): Bitmap? {
    if (dataUri == null || dataUri.length > ((MAX_BYTES + 2) / 3) * 4 + 32) return null
    val separator = dataUri.indexOf(',')
    if (separator < 0) return null
    val mime = when (dataUri.substring(0, separator)) {
      "data:image/png;base64" -> "image/png"
      "data:image/jpeg;base64" -> "image/jpeg"
      "data:image/webp;base64" -> "image/webp"
      else -> return null
    }
    val encoded = dataUri.substring(separator + 1)
    if (encoded.isEmpty() || encoded.length % 4 != 0 || !Regex("^[A-Za-z0-9+/]*={0,2}$").matches(encoded)) return null
    return brandingAttempt {
      val bytes = Base64.decode(encoded, Base64.NO_WRAP)
      if (bytes.size > MAX_BYTES || Base64.encodeToString(bytes, Base64.NO_WRAP) != encoded) return null
      decodeBytes(CompanyLogoBytes(mime, bytes))
    }
  }

  private fun decodeBytes(logo: CompanyLogoBytes): Bitmap? = brandingAttempt {
    val bytes = logo.bytes
    if (bytes.size !in 1..MAX_BYTES || !CompanyLogoPolicy.matchesSignature(logo.mime, bytes)) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outMimeType != logo.mime || bounds.outWidth !in 1..2048 || bounds.outHeight !in 1..2048) return null
    val options = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inSampleSize = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / inSampleSize > ICON_SIZE * 2) inSampleSize *= 2
    }
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
    try {
      val icon = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888)
      try {
        val scale = (ICON_SIZE * 0.8f) / maxOf(decoded.width, decoded.height)
        val width = decoded.width * scale
        val height = decoded.height * scale
        Canvas(icon).drawBitmap(decoded, null, RectF((ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, (ICON_SIZE + width) / 2, (ICON_SIZE + height) / 2), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        icon
      } catch (failure: Exception) {
        icon.recycle()
        throw failure
      }
    } finally {
      decoded.recycle()
    }
  }

  fun applicationIcon(context: Context): Bitmap {
    val drawable = context.applicationInfo.loadIcon(context.packageManager)
    val bitmap = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888)
    drawable.setBounds(0, 0, ICON_SIZE, ICON_SIZE)
    drawable.draw(Canvas(bitmap))
    return bitmap
  }
}