package expo.modules.qualitzerplaces

import android.content.pm.PackageManager
import android.os.Build
import android.location.Geocoder
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.libraries.places.api.Places
import com.google.android.libraries.places.api.model.AutocompleteSessionToken
import com.google.android.libraries.places.api.model.Place
import com.google.android.libraries.places.api.net.FindAutocompletePredictionsRequest
import com.google.android.libraries.places.api.net.FetchPlaceRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale
import java.security.MessageDigest
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

class QualitzerPlacesModule : Module() {
  private var sessionToken: AutocompleteSessionToken? = null
  private fun context() = requireNotNull(appContext.reactContext).applicationContext
  private fun apiKey(): String = context().packageManager.getApplicationInfo(context().packageName, PackageManager.GET_META_DATA)
    .metaData?.getString("com.google.android.geo.API_KEY") ?: ""
  private fun client() = context().let { context ->
    val key = apiKey()
    require(key.startsWith("AIza")) { "GOOGLE_MAPS_CONFIGURATION_REQUIRED" }
    if (!Places.isInitialized()) Places.initializeWithNewPlacesApiEnabled(context, key, Locale("es", "CL"))
    Places.createClient(context)
  }
  private fun reject(promise: Promise, error: Exception) {
    val code = if (error is ApiException) "GOOGLE_PLACES_${error.statusCode}" else "GOOGLE_PLACES_UNAVAILABLE"
    promise.reject(code, "No se pudo consultar Google Places. Revisa conexion, APIs habilitadas y restricciones Android de la clave.", null)
  }
  override fun definition() = ModuleDefinition {
    Name("QualitzerPlaces")
    Function("configured") { apiKey().startsWith("AIza") }
    Function("configuration") {
      val context = context()
      @Suppress("DEPRECATION")
      val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
      } else context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures
      val fingerprints = signatures?.map { signature ->
        MessageDigest.getInstance("SHA-1").digest(signature.toByteArray()).joinToString(":") { byte -> "%02X".format(byte.toInt() and 0xff) }
      } ?: emptyList()
      mapOf("packageName" to context.packageName, "keyConfigured" to apiKey().startsWith("AIza"), "certificateSha1" to fingerprints,
        "playServicesStatus" to GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context))
    }
    Function("endSession") { sessionToken = null }
    AsyncFunction("diagnose") Coroutine { ->
      withContext(Dispatchers.IO) {
        val connection = URL("https://places.googleapis.com/v1/places:autocomplete").openConnection() as HttpURLConnection
        try {
          connection.requestMethod = "POST"
          connection.connectTimeout = 10000
          connection.readTimeout = 10000
          connection.instanceFollowRedirects = false
          connection.doOutput = true
          connection.setRequestProperty("Content-Type", "application/json")
          connection.setRequestProperty("X-Goog-Api-Key", apiKey())
          connection.setRequestProperty("X-Android-Package", context().packageName)
          @Suppress("DEPRECATION")
          val signatures = context().packageManager.getPackageInfo(context().packageName, PackageManager.GET_SIGNATURES).signatures
          signatures?.firstOrNull()?.let { signature ->
            connection.setRequestProperty("X-Android-Cert", MessageDigest.getInstance("SHA-1").digest(signature.toByteArray()).joinToString("") { byte -> "%02X".format(byte.toInt() and 0xff) })
          }
          connection.outputStream.use { it.write(JSONObject().put("input", "Santiago, Chile").put("languageCode", "es").toString().toByteArray(Charsets.UTF_8)) }
          val status = connection.responseCode
          val stream = if (status in 200..299) connection.inputStream else connection.errorStream
          val text = stream?.bufferedReader()?.use { reader ->
            val content = StringBuilder()
            val buffer = CharArray(1024)
            var count = reader.read(buffer)
            while (count >= 0 && content.length + count <= 65536) { content.append(buffer, 0, count); count = reader.read(buffer) }
            content.toString()
          } ?: "{}"
          val details = JSONObject(text).optJSONObject("error")?.optJSONArray("details")
          val reasons = mutableListOf<String>()
          if (details != null) for (index in 0 until details.length()) {
            val reason = details.optJSONObject(index)?.optString("reason") ?: ""
            if (reason.matches(Regex("[A-Z_]{1,80}"))) reasons.add(reason)
          }
          mapOf("status" to status, "accepted" to (status in 200..299), "reasons" to reasons.distinct())
        } catch (_: Exception) {
          mapOf("status" to 0, "accepted" to false, "reasons" to listOf("NETWORK_OR_RESPONSE_ERROR"))
        } finally { connection.disconnect() }
      }
    }
    AsyncFunction("search") { query: String, promise: Promise ->
      try {
        require(query.trim().length in 3..200)
        val token = sessionToken ?: AutocompleteSessionToken.newInstance().also { sessionToken = it }
        val request = FindAutocompletePredictionsRequest.builder().setQuery(query.trim()).setSessionToken(token).build()
        client().findAutocompletePredictions(request).addOnSuccessListener { response ->
          promise.resolve(response.autocompletePredictions.take(5).map { prediction ->
            mapOf("id" to prediction.placeId, "label" to prediction.getFullText(null).toString())
          })
        }.addOnFailureListener { reject(promise, it) }
      } catch (error: Exception) { reject(promise, error) }
    }
    AsyncFunction("details") { placeId: String, promise: Promise ->
      try {
        require(placeId.isNotBlank() && placeId.length <= 500)
        val builder = FetchPlaceRequest.builder(placeId, listOf(Place.Field.LAT_LNG, Place.Field.ADDRESS, Place.Field.ADDRESS_COMPONENTS))
        sessionToken?.let { builder.setSessionToken(it) }
        client().fetchPlace(builder.build()).addOnSuccessListener { response ->
          sessionToken = null
          val place = response.place
          val point = place.latLng
          if (point == null) promise.reject("GOOGLE_PLACE_LOCATION_MISSING", "Google no devolvio coordenadas para esa direccion.", null)
          else {
            fun part(vararg types: String) = place.addressComponents?.asList()?.firstOrNull { component -> component.types.any { it in types } }?.name ?: ""
            promise.resolve(mapOf("address" to (place.address ?: ""), "country" to part("country"), "region" to part("administrative_area_level_1"),
              "county" to part("administrative_area_level_3", "locality"), "city" to part("administrative_area_level_2"), "postalCode" to part("postal_code"),
              "lat" to point.latitude.toString(), "lon" to point.longitude.toString()))
          }
        }.addOnFailureListener { reject(promise, it) }
      } catch (error: Exception) { reject(promise, error) }
    }
    AsyncFunction("reverse") Coroutine { latitude: Double, longitude: Double ->
      require(latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0)
      withContext(Dispatchers.IO) {
        @Suppress("DEPRECATION")
        val address = if (Geocoder.isPresent()) Geocoder(context(), Locale("es", "CL")).getFromLocation(latitude, longitude, 1)?.firstOrNull() else null
        mapOf("address" to (address?.getAddressLine(0) ?: ""), "country" to (address?.countryName ?: ""), "region" to (address?.adminArea ?: ""),
          "county" to (address?.locality ?: ""), "city" to (address?.subAdminArea ?: ""), "postalCode" to (address?.postalCode ?: ""),
          "lat" to latitude.toString(), "lon" to longitude.toString())
      }
    }
  }
}