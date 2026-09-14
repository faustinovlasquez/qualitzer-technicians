package expo.modules.companybranding

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class CompanyBrandingPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(object : ReactActivityLifecycleListener {
      override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        brandingAttempt {
          val revision = CompanyBrandingState.invalidate()
          val context = activity.applicationContext
          val reference = WeakReference(activity)
          CompanyBrandingState.scope.launchBranding {
            CompanyBrandingState.synchronize(context, reference.get(), revision, null)
          }
        }
      }
    })
}