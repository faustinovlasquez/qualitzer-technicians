package android.app

import android.content.Intent
import android.os.Bundle

open class Activity {
  var intent = Intent()
  val packageName = "com.qualitzer.field"
  val launches = mutableListOf<Intent>()
  var finishes = 0
  var failStart = false
  var failFinish = false
  open fun onCreate(savedInstanceState: Bundle?) {}
  fun startActivity(launch: Intent) {
    if (failStart) throw IllegalStateException("OEM_START_FAILED")
    launches.add(launch)
  }
  fun finish() {
    finishes++
    if (failFinish) throw IllegalStateException("OEM_FINISH_FAILED")
  }
}