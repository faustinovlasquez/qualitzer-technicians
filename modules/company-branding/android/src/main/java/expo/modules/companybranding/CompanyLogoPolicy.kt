package expo.modules.companybranding

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.URI
import java.security.MessageDigest

internal data class CompanyLogoBytes(val mime: String, val bytes: ByteArray)

internal object CompanyLogoPolicy {
  const val MAX_BYTES = 512 * 1024
  const val TIMEOUT_MS = 10_000L

  fun validUrl(value: String): Boolean = brandingAttempt {
    if (value.length > 8192 || value.any { it.isWhitespace() || it.isISOControl() || it == '\\' }) return@brandingAttempt false
    val uri = URI(value)
    val host = uri.host?.lowercase() ?: return@brandingAttempt false
    uri.scheme == "https" && uri.rawUserInfo == null && uri.rawFragment == null && uri.port in listOf(-1, 443) &&
      host.contains('.') && !host.endsWith('.') && !Regex("^[0-9.]+$").matches(host) &&
      host.split('.').all { Regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$").matches(it) } &&
      !Regex("(^|\\.)(localhost|local|internal|lan|home|test|invalid|example)$").containsMatchIn(host)
  } == true

  fun publicAddress(address: InetAddress): Boolean {
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
    val bytes = address.address.map { it.toInt() and 255 }
    if (bytes.size == 4) {
      val a = bytes[0]; val b = bytes[1]; val c = bytes[2]
      return a !in listOf(0, 10, 127) && a < 224 &&
        !(a == 100 && b in 64..127) && !(a == 169 && b == 254) && !(a == 172 && b in 16..31) &&
        !(a == 192 && (b == 168 || (b == 0 && c in listOf(0, 2)) || (b == 88 && c == 99))) &&
        !(a == 198 && (b in 18..19 || (b == 51 && c == 100))) && !(a == 203 && b == 0 && c == 113)
    }
    if (bytes.size != 16 || bytes[0] and 0xe0 != 0x20) return false
    return !(bytes[0] == 0x20 && bytes[1] == 0x01 && (bytes[2] < 2 || (bytes[2] == 0x0d && bytes[3] == 0xb8))) &&
      !(bytes[0] == 0x20 && bytes[1] == 0x02) && !(bytes[0] == 0x3f && bytes[1] == 0xff)
  }

  fun readBounded(stream: InputStream, contentLength: Long): ByteArray? {
    if (contentLength > MAX_BYTES || contentLength < -1) return null
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val count = stream.read(buffer, 0, minOf(buffer.size, MAX_BYTES - output.size() + 1))
      if (count < 0) break
      if (count == 0 || output.size() + count > MAX_BYTES) return null
      output.write(buffer, 0, count)
    }
    if (output.size() == 0 || (contentLength >= 0 && contentLength != output.size().toLong())) return null
    return output.toByteArray()
  }

  fun matchesSignature(mime: String, bytes: ByteArray): Boolean {
    fun matches(offset: Int, vararg signature: Int): Boolean = bytes.size >= offset + signature.size &&
      signature.indices.all { (bytes[offset + it].toInt() and 255) == signature[it] }
    return when (mime) {
      "image/png" -> matches(0, 137, 80, 78, 71, 13, 10, 26, 10)
      "image/jpeg" -> matches(0, 255, 216, 255)
      "image/webp" -> matches(0, 82, 73, 70, 70) && matches(8, 87, 69, 66, 80)
      else -> false
    }
  }

  fun hash(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

internal class CompanyLogoCache {
  private data class Entry(val urlHash: String, val contentHash: String, val logo: CompanyLogoBytes)
  private var entry: Entry? = null

  @Synchronized fun get(urlHash: String): CompanyLogoBytes? = entry?.takeIf {
    it.urlHash == urlHash && it.contentHash == CompanyLogoPolicy.hash(it.logo.bytes)
  }?.logo

  @Synchronized fun put(urlHash: String, logo: CompanyLogoBytes) {
    if (logo.bytes.size !in 1..CompanyLogoPolicy.MAX_BYTES) return
    entry = Entry(urlHash, CompanyLogoPolicy.hash(logo.bytes), logo)
  }
}