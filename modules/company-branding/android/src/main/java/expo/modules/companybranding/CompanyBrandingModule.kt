package expo.modules.companybranding

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class CompanyBrandingModule : Module() {
  private val confirmation: (String, Int) -> Unit = { shortcutId, revision ->
    sendEvent("onPinConfirmed", mapOf("shortcutId" to shortcutId, "revision" to revision))
  }

  override fun definition() = ModuleDefinition {
    Name("CompanyBranding")
    Events("onPinConfirmed")

    Function("invalidate") { CompanyBrandingState.invalidate() }

    AsyncFunction("synchronize") Coroutine { revision: Int, payload: CompanyBrandingPayload? ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      CompanyBrandingState.synchronize(context, appContext.currentActivity, revision, payload)
    }

    AsyncFunction("requestPin") Coroutine { revision: Int ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      CompanyBrandingState.requestPin(context, appContext.currentActivity, revision)
    }

    AsyncFunction("requestAutomaticPin") Coroutine { revision: Int ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      CompanyBrandingState.requestPin(context, appContext.currentActivity, revision, automatic = true)
    }

    OnStartObserving("onPinConfirmed") { CompanyBrandingState.confirmations.add(confirmation) }
    OnStopObserving("onPinConfirmed") { CompanyBrandingState.confirmations.remove(confirmation) }
    OnDestroy {
      brandingAttempt {
        CompanyBrandingState.confirmations.remove(confirmation)
        val revision = CompanyBrandingState.invalidate()
        val context = appContext.reactContext?.applicationContext
        val activity = WeakReference(appContext.currentActivity)
        if (context != null) CompanyBrandingState.scope.launchBranding {
          CompanyBrandingState.synchronize(context, activity.get(), revision, null)
        }
      }
    }
  }
}