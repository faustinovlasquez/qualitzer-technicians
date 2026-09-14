package expo.modules.companybranding

internal object CompanyBrandingState {
  const val OPEN_ACTION = "com.qualitzer.field.OPEN_COMPANY_SHORTCUT"
  const val ID_EXTRA = "companyShortcutIdentity"
  fun validId(id: String) = Regex("^qz-company-[a-f0-9]{64}$").matches(id)
}