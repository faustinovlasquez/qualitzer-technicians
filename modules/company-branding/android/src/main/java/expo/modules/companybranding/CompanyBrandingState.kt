package expo.modules.companybranding

import android.app.Activity
import android.app.ActivityManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.os.Build
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicInteger
import java.util.UUID
import java.lang.ref.WeakReference
import java.io.File

class CompanyBrandingPayload : Record {
  @Field val shortcutId: String = ""
  @Field val displayName: String = ""
  @Field val branchName: String? = null
  @Field val logoDataUri: String? = null
  @Field val logoHttpsUrl: String? = null
}

internal data class CompanyBrandingLabel(val shortcutId: String, val displayName: String, val branchName: String?)
internal data class PreparedCompany(val revision: Int, val payload: CompanyBrandingLabel, val icon: Bitmap, val companyLogo: Boolean)

class CompanyBrandingStatus(
  @Field val ready: Boolean = false,
  @Field val pinSupported: Boolean = false,
  @Field val logoUsed: String = "qualitzer"
) : Record

internal object CompanyBrandingState {
  const val OPEN_ACTION = "com.qualitzer.field.OPEN_COMPANY_SHORTCUT"
  const val CONFIRMED_ACTION = "com.qualitzer.field.COMPANY_SHORTCUT_CONFIRMED"
  const val ID_EXTRA = "companyShortcutIdentity"
  const val REVISION_EXTRA = "companyBrandingRevision"
  const val DISABLED_MESSAGE = "Abre Qualitzer e inicia sesión en esta empresa para volver a usar este acceso."
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  val mutex = Mutex()
  private val imageMutex = Mutex()
  val confirmations = CopyOnWriteArraySet<(String, Int) -> Unit>()
  private val generation = AtomicInteger(0)
  @Volatile private var prepared: PreparedCompany? = null
  private var appliedShortcutId: String? = null

  fun validId(id: String): Boolean = Regex("^qz-company-[a-f0-9]{64}$").matches(id)
  fun invalidate(): Int {
    val revision = generation.incrementAndGet()
    prepared = null
    return revision
  }

  fun current(revision: Int): PreparedCompany? = prepared?.takeIf { it.revision == revision && generation.get() == revision }
  fun matches(id: String): Boolean = prepared?.let { it.payload.shortcutId == id && current(it.revision) != null } == true

  private fun status(ready: Boolean = false, pinSupported: Boolean = false, companyLogo: Boolean = false) =
    CompanyBrandingStatus(ready, pinSupported, if (companyLogo) "company" else "qualitzer")

  suspend fun synchronize(context: Context, activity: Activity?, revision: Int, payload: CompanyBrandingPayload?): CompanyBrandingStatus = withContext(Dispatchers.IO) {
    if (generation.get() != revision) return@withContext status()
    val next = if (payload != null) imageMutex.withLock {
      if (generation.get() != revision) return@withLock null
      require(validId(payload.shortcutId) && payload.displayName.isNotBlank() && payload.displayName.length <= 120)
      require(payload.displayName.none { it.isISOControl() } && (payload.branchName?.length ?: 0) <= 120)
      val companyIcon = CompanyBrandingImages.resolve(payload.logoDataUri, payload.logoHttpsUrl)
      if (generation.get() != revision) {
        companyIcon?.recycle()
        return@withLock null
      }
      val label = CompanyBrandingLabel(payload.shortcutId, payload.displayName, payload.branchName)
      PreparedCompany(revision, label, companyIcon ?: CompanyBrandingImages.applicationIcon(context), companyIcon != null)
    } else null
    mutex.withLock {
      if (generation.get() != revision) return@withLock status()
      if (payload == null) {
        prepared = null
        appliedShortcutId = null
        try {
          disableOtherPins(context, null)
        } finally {
          scheduleTask(context, activity, revision, null)
        }
        return@withLock status()
      }
      if (next == null || generation.get() != revision) return@withLock status()
      if (appliedShortcutId != payload.shortcutId) disableOtherPins(context, payload.shortcutId)
      var supported = false
      if (Build.VERSION.SDK_INT >= 26) {
        val manager = context.getSystemService(ShortcutManager::class.java)
        supported = manager?.isRequestPinShortcutSupported == true
        if (manager != null && manager.pinnedShortcuts.any { it.id == payload.shortcutId }) {
          if (!manager.updateShortcuts(listOf(shortcut(context, next)))) return@withLock status()
          if (generation.get() == revision) manager.enableShortcuts(listOf(payload.shortcutId))
        }
      }
      if (generation.get() != revision) {
        disableOtherPins(context, null)
        return@withLock status()
      }
      prepared = next
      appliedShortcutId = payload.shortcutId
      scheduleTask(context, activity, revision, next)
      status(true, supported, next.companyLogo)
    }
  }

  fun disableOtherPins(context: Context, keepId: String?) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return
    val ids = manager.pinnedShortcuts.filter { validId(it.id) && it.id != keepId }.map { it.id }
    if (ids.isNotEmpty()) manager.disableShortcuts(ids, DISABLED_MESSAGE)
  }

  fun disablePin(context: Context, id: String) {
    if (Build.VERSION.SDK_INT >= 26 && validId(id)) {
      context.getSystemService(ShortcutManager::class.java)?.disableShortcuts(listOf(id), DISABLED_MESSAGE)
    }
  }

  @android.annotation.TargetApi(26)
  private fun shortcut(context: Context, company: PreparedCompany): ShortcutInfo {
    val payload = company.payload
    val intent = Intent(context, CompanyShortcutActivity::class.java).apply {
      action = OPEN_ACTION
      putExtra(ID_EXTRA, payload.shortcutId)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK
    }
    return ShortcutInfo.Builder(context, payload.shortcutId)
      .setActivity(ComponentName(context.packageName, "${context.packageName}.MainActivity"))
      .setShortLabel(payload.displayName)
      .setLongLabel(payload.displayName)
      .setIcon(Icon.createWithBitmap(company.icon))
      .setIntent(intent)
      .build()
  }

  suspend fun requestPin(context: Context, activity: Activity?, revision: Int, automatic: Boolean = false): String = withContext(Dispatchers.IO) {
    mutex.withLock {
      if (Build.VERSION.SDK_INT < 26) return@withLock "unsupported"
      val company = current(revision) ?: return@withLock "stale"
      val foreground = withContext(Dispatchers.Main) { activity != null && !activity.isFinishing && activity.hasWindowFocus() }
      if (!foreground) return@withLock "unavailable"
      val manager = context.getSystemService(ShortcutManager::class.java) ?: return@withLock "unsupported"
      if (!manager.isRequestPinShortcutSupported) return@withLock "unsupported"
      if (current(revision) == null) return@withLock "stale"
      val requests = CompanyPinRequests(File(context.noBackupFilesDir, "company-shortcut-requests"))
      if (manager.pinnedShortcuts.any { it.id == company.payload.shortcutId }) {
        requests.claim(company.payload.shortcutId, false)
        if (!manager.updateShortcuts(listOf(shortcut(context, company)))) return@withLock "unavailable"
        if (current(revision) == null) return@withLock "stale"
        manager.enableShortcuts(listOf(company.payload.shortcutId))
        return@withLock "updated"
      }
      if (!requests.claim(company.payload.shortcutId, automatic)) return@withLock "skipped"
      if (current(revision) == null) return@withLock "stale"
      val callback = Intent(context, CompanyPinReceiver::class.java).apply {
        action = CONFIRMED_ACTION
        addCategory("com.qualitzer.field.PIN.${UUID.randomUUID()}")
        putExtra(ID_EXTRA, company.payload.shortcutId)
        putExtra(REVISION_EXTRA, revision)
      }
      val pending = PendingIntent.getBroadcast(context, revision, callback, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)
      val accepted = manager.requestPinShortcut(shortcut(context, company), pending.intentSender)
      if (!accepted) pending.cancel()
      if (current(revision) == null) {
        disableOtherPins(context, null)
        return@withLock "stale"
      }
      if (accepted) "pending" else "unsupported"
    }
  }

  @Suppress("DEPRECATION")
  suspend fun updateTask(context: Context, activity: Activity?, revision: Int, company: PreparedCompany?) {
    brandingAttempt {
      if (generation.get() != revision || activity == null) return@brandingAttempt
      val name = company?.let { listOfNotNull(it.payload.displayName, it.payload.branchName).joinToString(" · ") }
        ?: context.applicationInfo.loadLabel(context.packageManager).toString()
      val description = if (company != null) {
        // API 33's builder only accepts resource IDs; bitmap icons require this supported legacy constructor through API 36.
        ActivityManager.TaskDescription(name, company.icon)
      } else if (Build.VERSION.SDK_INT >= 33) {
        ActivityManager.TaskDescription.Builder().setLabel(name).setIcon(context.applicationInfo.icon).build()
      } else if (Build.VERSION.SDK_INT >= 28) {
        ActivityManager.TaskDescription(name, context.applicationInfo.icon)
      } else {
        ActivityManager.TaskDescription(name, CompanyBrandingImages.applicationIcon(context))
      }
      withContext(Dispatchers.Main) {
        if (generation.get() == revision && current(revision) === company && !activity.isFinishing && !activity.isDestroyed) activity.setTaskDescription(description)
      }
    }
  }

  private fun scheduleTask(context: Context, activity: Activity?, revision: Int, company: PreparedCompany?) {
    val reference = WeakReference(activity)
    scope.launchBranding { updateTask(context, reference.get(), revision, company) }
  }
}