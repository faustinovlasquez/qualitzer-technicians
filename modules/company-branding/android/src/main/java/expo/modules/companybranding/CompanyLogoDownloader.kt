package expo.modules.companybranding

import java.io.IOException
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

internal class CompanyLogoDns(private val resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }) : Dns {
  override fun lookup(hostname: String): List<InetAddress> {
    val addresses = resolve(hostname)
    if (addresses.isEmpty() || addresses.any { !CompanyLogoPolicy.publicAddress(it) }) throw UnknownHostException("COMPANY_LOGO_NON_PUBLIC_DNS")
    return addresses
  }
}

internal object CompanyLogoDownloader {
  internal val client = OkHttpClient.Builder()
    .dns(CompanyLogoDns())
    .proxy(Proxy.NO_PROXY)
    .cookieJar(CookieJar.NO_COOKIES)
    .authenticator(Authenticator.NONE)
    .proxyAuthenticator(Authenticator.NONE)
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    .cache(null)
    .callTimeout(CompanyLogoPolicy.TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .connectTimeout(CompanyLogoPolicy.TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .readTimeout(CompanyLogoPolicy.TIMEOUT_MS, TimeUnit.MILLISECONDS)
    .build()

  suspend fun download(url: String, calls: Call.Factory = client): CompanyLogoBytes? {
    if (!CompanyLogoPolicy.validUrl(url)) return null
    return withTimeoutOrNull(CompanyLogoPolicy.TIMEOUT_MS) {
      suspendCancellableCoroutine { continuation ->
        val call = calls.newCall(Request.Builder().url(url).header("Accept-Encoding", "identity").get().build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
          override fun onFailure(call: Call, error: IOException) { brandingAttempt { continuation.resume(null) } }
          override fun onResponse(call: Call, response: Response) {
            val logo = brandingAttempt {
              response.use {
                if (it.code != 200 || it.header("Content-Encoding")?.let { encoding -> encoding != "identity" } == true) return@use null
                val body = it.body ?: return@use null
                val length = it.header("Content-Length")
                if (length != null && (length.toLongOrNull()?.let { size -> size !in 0..CompanyLogoPolicy.MAX_BYTES.toLong() } != false)) return@use null
                val mime = body.contentType()?.let { type -> "${type.type}/${type.subtype}" } ?: return@use null
                if (mime !in listOf("image/png", "image/jpeg", "image/webp")) return@use null
                val bytes = body.byteStream().use { stream -> CompanyLogoPolicy.readBounded(stream, body.contentLength()) } ?: return@use null
                if (!CompanyLogoPolicy.matchesSignature(mime, bytes)) return@use null
                CompanyLogoBytes(mime, bytes)
              }
            }
            brandingAttempt { continuation.resume(logo) }
          }
        })
      }
    }
  }
}