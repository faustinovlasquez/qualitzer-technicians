package expo.modules.companybranding

import android.content.Intent

fun main() {
  var passed = 0
  fun verify(name: String, block: () -> Unit) { block(); passed++; println("PASS $name") }
  fun activity(id: String = "qz-company-" + "a".repeat(64)) = CompanyShortcutActivity().also {
    it.intent.action = CompanyBrandingState.OPEN_ACTION
    it.intent.extras[CompanyBrandingState.ID_EXTRA] = id
  }
  verify("cold start legacy pin launches main without any in-memory session identity or dialog") {
    val activity = activity()
    activity.onCreate(null)
    check(activity.launches.size == 1 && activity.finishes == 1)
    val launch = activity.launches.single()
    check(launch.action == Intent.ACTION_MAIN && launch.component == "com.qualitzer.field/com.qualitzer.field.MainActivity")
    check(launch.categories == listOf(Intent.CATEGORY_LAUNCHER))
    check(launch.flags == Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }
  verify("same pin or other-company old pin launches identically; injected token tenant and deeplink discarded") {
    for (hash in listOf("a", "b")) {
      val activity = activity("qz-company-" + hash.repeat(64))
      activity.intent.extras["token"] = "synthetic-token"
      activity.intent.extras["tenant"] = "synthetic-tenant"
      activity.intent.data = "qualitzer://login?token=synthetic"
      activity.onCreate(null)
      check(activity.launches.single().extras.isEmpty() && activity.launches.single().data == null)
    }
  }
  verify("invalid action or identity never launches, including malformed extras") {
    val badAction = activity().also { it.intent.action = "other" }
    val badRead = activity().also { it.intent.failRead = true }
    for (activity in listOf(activity(""), activity("../bad"), badAction, badRead)) {
      activity.onCreate(null)
      check(activity.launches.isEmpty() && activity.finishes > 0)
    }
  }
  verify("OEM launch and finish exceptions are contained") {
    val activity = activity().also { it.failStart = true; it.failFinish = true }
    activity.onCreate(null)
    check(activity.launches.isEmpty() && activity.finishes > 0)
  }
  println("SHORTCUT_ACTIVITY_REGRESSION_PASS=$passed; ANDROID_FRAMEWORK=TEST_DOUBLES")
}