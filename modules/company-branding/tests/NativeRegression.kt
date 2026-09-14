package expo.modules.companybranding

import java.io.ByteArrayInputStream
import java.io.IOException
import java.nio.file.Files
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Timeout

private fun ipv4(a: Int, b: Int, c: Int, d: Int): InetAddress = InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
private val png = byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10)
private const val url = "https://logos.example.com/company.png?X-Amz-Signature=synthetic"

private class FakeCall(private val request: Request, private val body: ByteArray, private val mime: String, private val code: Int, private val failure: Boolean, private val hang: Boolean) : Call {
  var cancelled = false
  override fun request() = request
  override fun execute(): Response = error("SYNCHRONOUS_EXECUTION_NOT_ALLOWED")
  override fun enqueue(responseCallback: Callback) {
    check(request.method == "GET")
    check(request.header("Authorization") == null && request.header("Cookie") == null)
    check(request.header("Accept-Encoding") == "identity")
    if (hang) return
    if (failure) responseCallback.onFailure(this, IOException("SYNTHETIC_TRANSPORT_FAILURE"))
    else responseCallback.onResponse(this, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
      .body(body.toResponseBody(mime.toMediaType())).build())
  }
  override fun cancel() { cancelled = true }
  override fun isExecuted() = true
  override fun isCanceled() = cancelled
  override fun timeout() = Timeout()
  override fun clone(): Call = FakeCall(request, body, mime, code, failure, hang)
}

fun main() = runBlocking {
  var passed = 0
  suspend fun verify(name: String, block: suspend () -> Unit) { block(); passed++; println("PASS $name") }

  verify("asked marker persists cancellation and process recreation, stores only hash with empty bytes") {
    val directory = Files.createTempDirectory("company-pin-fixture").toFile()
    try {
      val id = "qz-company-" + "a".repeat(64)
      check(CompanyPinRequests(directory).claim(id, true))
      check(!CompanyPinRequests(directory).claim(id, true))
      check(CompanyPinRequests(directory).claim(id, false))
      check(!CompanyPinRequests(directory).claim(id, true))
      check(directory.listFiles()!!.single().name == id && directory.listFiles()!!.single().length() == 0L)
      check(CompanyPinRequests(directory).claim("qz-company-" + "b".repeat(64), true))
    } finally { directory.deleteRecursively() }
  }
  verify("concurrent requests atomically claim company once, manual marks asked, new install is eligible") {
    val directory = Files.createTempDirectory("company-pin-fixture").toFile()
    try {
      val id = "qz-company-" + "c".repeat(64)
      val claims = AtomicInteger()
      val jobs = (1..20).map { launch(Dispatchers.IO) { if (CompanyPinRequests(directory).claim(id, true)) claims.incrementAndGet() } }
      jobs.forEach { it.join() }
      check(claims.get() == 1)
      val other = "qz-company-" + "d".repeat(64)
      check(CompanyPinRequests(directory).claim(other, false))
      check(!CompanyPinRequests(directory).claim(other, true))
      directory.deleteRecursively()
      check(CompanyPinRequests(directory).claim(id, true))
    } finally { directory.deleteRecursively() }
  }
  verify("invalid marker identity or unavailable storage fails closed before requesting launcher") {
    val directory = Files.createTempDirectory("company-pin-fixture").toFile()
    try {
      check(brandingAttempt { CompanyPinRequests(directory).claim("../escape", true) } == null)
      val notDirectory = directory.resolve("file").also { it.writeText("fixture") }
      check(brandingAttempt { CompanyPinRequests(notDirectory).claim("qz-company-" + "e".repeat(64), true) } == null)
    } finally { directory.deleteRecursively() }
  }

  verify("old receiver finally RuntimeException escapes; new owned launch contains it and releases mutex") {
    val escaped = CopyOnWriteArrayList<Throwable>()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + CoroutineExceptionHandler { _, error -> escaped.add(error) })
    val lock = Mutex()
    scope.launch {
      try { runCatching { lock.withLock { throw SecurityException("OEM_SHORTCUT_DENIED") } } }
      finally { throw IllegalStateException("RECEIVER_ALREADY_FINISHED") }
    }.join()
    check(escaped.single() is IllegalStateException)
    escaped.clear()
    val finishes = AtomicInteger()
    scope.launchBranding(finish = { finishes.incrementAndGet(); throw IllegalStateException("RECEIVER_ALREADY_FINISHED") }) {
      lock.withLock { throw SecurityException("OEM_SHORTCUT_DENIED") }
    }.join()
    check(escaped.isEmpty() && finishes.get() == 1 && !lock.isLocked)
    var nextWorked = false
    scope.launchBranding { lock.withLock { nextWorked = true } }.join()
    check(nextWorked)
    scope.cancel()
  }
  verify("cancellation propagates through containment and always finishes receiver") {
    var finishes = 0
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val started = CompletableDeferred<Unit>()
    val job = scope.launchBranding(finish = { finishes++ }) { started.complete(Unit); awaitCancellation() }
    started.await(); job.cancel(); job.join()
    check(job.isCancelled && finishes == 1)
    var cancellationRethrown = false
    try { brandingAttempt<Unit> { throw CancellationException("cancel") } } catch (_: CancellationException) { cancellationRethrown = true }
    check(cancellationRethrown)
    scope.cancel()
  }
  verify("task-description-like RuntimeException contained; fatal Error is not swallowed") {
    check(brandingAttempt<Unit> { throw IllegalArgumentException("TASK_DESCRIPTION_REJECTED") } == null)
    var fatalRethrown = false
    try { brandingAttempt<Unit> { throw OutOfMemoryError("SYNTHETIC_NO_ALLOCATION") } } catch (_: OutOfMemoryError) { fatalRethrown = true }
    check(fatalRethrown)
  }
  verify("HTTPS URL policy keeps signed public host, rejects credentials local literals controls redirects targets") {
    check(CompanyLogoPolicy.validUrl(url))
    for (candidate in listOf("http://logos.example.com/a", "https://u:p@logos.example.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://host.local/a", "https://host.internal/a", "https://host/a", "https://logos.example.com:444/a", "https://logos.example.com/a#x", "https://logos.example.com./a", "https://logos.example.com/\na", "https://logos.example.com\\@localhost/a")) check(!CompanyLogoPolicy.validUrl(candidate))
  }
  verify("DNS validates every resolved IPv4 before connect, including mixed public-private answers") {
    val public = ipv4(8, 8, 8, 8)
    check(CompanyLogoDns { listOf(public) }.lookup("logos.example.com").single() == public)
    for (private in listOf(ipv4(0, 1, 1, 1), ipv4(10, 1, 2, 3), ipv4(127, 0, 0, 1), ipv4(100, 64, 0, 1), ipv4(169, 254, 169, 254), ipv4(172, 16, 0, 1), ipv4(192, 168, 1, 1), ipv4(192, 0, 2, 1), ipv4(198, 18, 0, 1), ipv4(198, 51, 100, 1), ipv4(203, 0, 113, 1), ipv4(224, 0, 0, 1), ipv4(255, 255, 255, 255))) {
      check(!CompanyLogoPolicy.publicAddress(private))
      var blocked = false
      try { CompanyLogoDns { listOf(public, private) }.lookup("logos.example.com") } catch (_: UnknownHostException) { blocked = true }
      check(blocked)
    }
  }
  verify("DNS rejects IPv6 loopback ULA linklocal transition/documentation; permits global unicast") {
    fun address(vararg prefix: Int): InetAddress = InetAddress.getByAddress(ByteArray(16).also { bytes -> prefix.forEachIndexed { index, value -> bytes[index] = value.toByte() } })
    for (private in listOf(address(), address(0xfc), address(0xfe, 0x80), address(0xff), address(0x20, 0x01, 0x0d, 0xb8), address(0x20, 0x01, 0, 0), address(0x20, 0x02), address(0x3f, 0xff))) check(!CompanyLogoPolicy.publicAddress(private))
    check(CompanyLogoPolicy.publicAddress(address(0x26, 0x06, 0x47, 0x00)))
  }
  verify("bounded stream accepts exact cap unknown length; rejects overflow lying length empty without draining") {
    val bytes = ByteArray(CompanyLogoPolicy.MAX_BYTES)
    check(CompanyLogoPolicy.readBounded(ByteArrayInputStream(bytes), -1)?.size == bytes.size)
    val overflow = ByteArrayInputStream(ByteArray(bytes.size * 3))
    check(CompanyLogoPolicy.readBounded(overflow, -1) == null)
    check(overflow.available() == bytes.size * 2 - 1)
    check(CompanyLogoPolicy.readBounded(ByteArrayInputStream(bytes), bytes.size.toLong() + 1) == null)
    check(CompanyLogoPolicy.readBounded(ByteArrayInputStream(png), 1) == null)
    check(CompanyLogoPolicy.readBounded(ByteArrayInputStream(byteArrayOf()), -1) == null)
  }
  verify("MIME and file signature must agree; cache replaces single bounded entry and hashes bytes") {
    check(CompanyLogoPolicy.matchesSignature("image/png", png))
    check(!CompanyLogoPolicy.matchesSignature("image/jpeg", png))
    check(!CompanyLogoPolicy.matchesSignature("image/svg+xml", png))
    val cache = CompanyLogoCache()
    val first = CompanyLogoBytes("image/png", png.copyOf())
    cache.put("url-hash-1", first)
    check(cache.get("url-hash-1") != null)
    first.bytes[0] = 0
    check(cache.get("url-hash-1") == null)
    cache.put("url-hash-2", CompanyLogoBytes("image/png", png))
    check(cache.get("url-hash-1") == null && cache.get("url-hash-2") != null)
    cache.put("oversized", CompanyLogoBytes("image/png", ByteArray(CompanyLogoPolicy.MAX_BYTES + 1)))
    check(cache.get("oversized") == null)
  }
  verify("actual downloader accepts valid bytes and returns null on redirects HTTP MIME signature oversized transport failures") {
    suspend fun download(body: ByteArray = png, mime: String = "image/png", code: Int = 200, failure: Boolean = false) =
      CompanyLogoDownloader.download(url, Call.Factory { request -> FakeCall(request, body, mime, code, failure, false) })
    check(download()?.bytes?.contentEquals(png) == true)
    for (code in listOf(301, 302, 307, 308, 401, 403, 404, 500)) check(download(code = code) == null)
    check(download(mime = "image/jpeg") == null)
    check(download(mime = "text/html") == null)
    check(download(body = byteArrayOf(1, 2, 3)) == null)
    check(download(body = ByteArray(CompanyLogoPolicy.MAX_BYTES + 1)) == null)
    check(download(failure = true) == null)
  }
  verify("actual downloader cancellation cancels call and does not swallow parent cancellation") {
    lateinit var call: FakeCall
    val started = CompletableDeferred<Unit>()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val job = scope.launchBranding {
      CompanyLogoDownloader.download(url, Call.Factory { request -> FakeCall(request, png, "image/png", 200, false, true).also { call = it; started.complete(Unit) } })
      error("CANCELLED_DOWNLOAD_RETURNED_SUCCESS")
    }
    started.await(); job.cancel(); job.join()
    check(call.cancelled && job.isCancelled)
    scope.cancel()
  }
  verify("actual dedicated client has safe DNS TLS defaults no cookies redirects retries proxy or auth and ten-second timeouts") {
    val client = CompanyLogoDownloader.client
    check(client.dns is CompanyLogoDns)
    check(!client.followRedirects && !client.followSslRedirects && !client.retryOnConnectionFailure)
    check(client.cookieJar === okhttp3.CookieJar.NO_COOKIES && client.authenticator === okhttp3.Authenticator.NONE)
    check(client.proxy == java.net.Proxy.NO_PROXY && client.cache == null && client.interceptors.isEmpty())
    check(client.callTimeoutMillis == 10_000 && client.connectTimeoutMillis == 10_000 && client.readTimeoutMillis == 10_000)
  }
  verify("actual ten-second deadline cancels hung call and returns null fallback") {
    lateinit var call: FakeCall
    val started = System.nanoTime()
    val result = CompanyLogoDownloader.download(url, Call.Factory { request -> FakeCall(request, png, "image/png", 200, false, true).also { call = it } })
    val elapsed = (System.nanoTime() - started) / 1_000_000
    check(result == null && call.cancelled && elapsed in 9_000..15_000)
  }
  println("NATIVE_REGRESSION_PASS=$passed; REAL_NETWORK_REQUESTS=0")
}