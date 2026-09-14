package expo.modules.companybranding

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class CompanyShortcutActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    brandingAttempt {
      val id = intent.getStringExtra(CompanyBrandingState.ID_EXTRA)
      if (intent.action != CompanyBrandingState.OPEN_ACTION || id == null || !CompanyBrandingState.validId(id)) {
        finish()
        return
      }
      openApplication()
    } ?: brandingAttempt { finish() }
  }

  private fun openApplication() {
    brandingAttempt {
      val launch = Intent(Intent.ACTION_MAIN).apply {
        setClassName(packageName, "$packageName.MainActivity")
        addCategory(Intent.CATEGORY_LAUNCHER)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      try {
        startActivity(launch)
      } finally {
        brandingAttempt { finish() }
      }
    }
  }
}