package expo.modules.companybranding

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

internal inline fun <T> brandingAttempt(block: () -> T): T? = try {
  block()
} catch (cancelled: CancellationException) {
  throw cancelled
} catch (_: Exception) {
  null
}

internal fun CoroutineScope.launchBranding(finish: () -> Unit = {}, block: suspend () -> Unit): Job = launch {
  try {
    brandingAttempt { block() }
  } finally {
    brandingAttempt { finish() }
  }
}