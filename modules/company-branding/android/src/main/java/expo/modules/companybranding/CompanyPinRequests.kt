package expo.modules.companybranding

import java.io.File

internal class CompanyPinRequests(private val directory: File) {
  fun claim(shortcutId: String, automatic: Boolean): Boolean {
    require(Regex("^qz-company-[a-f0-9]{64}$").matches(shortcutId))
    check(directory.isDirectory || directory.mkdirs())
    val firstRequest = File(directory, shortcutId).createNewFile()
    return firstRequest || !automatic
  }
}