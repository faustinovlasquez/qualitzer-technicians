package android.content

class Intent(var action: String? = null) {
  companion object {
    const val ACTION_MAIN = "android.intent.action.MAIN"
    const val CATEGORY_LAUNCHER = "android.intent.category.LAUNCHER"
    const val FLAG_ACTIVITY_NEW_TASK = 0x10000000
    const val FLAG_ACTIVITY_CLEAR_TOP = 0x04000000
    const val FLAG_ACTIVITY_SINGLE_TOP = 0x20000000
  }
  var flags = 0
  var component: String? = null
  var data: String? = null
  var failRead = false
  val extras = mutableMapOf<String, String>()
  val categories = mutableListOf<String>()
  fun getStringExtra(key: String): String? {
    if (failRead) throw IllegalArgumentException("MALFORMED_INTENT")
    return extras[key]
  }
  fun setClassName(packageName: String, className: String) { component = "$packageName/$className" }
  fun addCategory(category: String) { categories.add(category) }
}