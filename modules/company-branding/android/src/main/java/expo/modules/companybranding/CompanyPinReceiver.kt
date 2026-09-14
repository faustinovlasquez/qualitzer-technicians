package expo.modules.companybranding

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.sync.withLock

class CompanyPinReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    brandingAttempt {
      if (intent.action != CompanyBrandingState.CONFIRMED_ACTION) return
      val id = intent.getStringExtra(CompanyBrandingState.ID_EXTRA) ?: return
      if (!CompanyBrandingState.validId(id)) return
      val revision = intent.getIntExtra(CompanyBrandingState.REVISION_EXTRA, -1)
      val result = goAsync()
      CompanyBrandingState.scope.launchBranding(finish = { result.finish() }) {
        CompanyBrandingState.mutex.withLock {
          if (!CompanyBrandingState.matches(id)) {
            CompanyBrandingState.disablePin(context, id)
          } else {
            CompanyBrandingState.confirmations.forEach { listener -> brandingAttempt { listener(id, revision) } }
          }
        }
      }
    }
  }
}