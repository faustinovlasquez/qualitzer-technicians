// Google Play deduce funciones de hardware obligatorias a partir del manifiesto: la pantalla vertical por la orientación
// fija ("portrait") y el Wi-Fi por el permiso ACCESS_WIFI_STATE. Así obligatorias, Play las marca como problema y deja
// fuera dispositivos que no las informan. La app funciona sin ellas, así que se declaran opcionales.
const { withAndroidManifest } = require("expo/config-plugins");

const OPTIONAL_FEATURES = ["android.hardware.screen.portrait", "android.hardware.wifi"];

module.exports = function withOptionalHardwareFeatures(config) {
  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    const features = (manifest["uses-feature"] ?? []).filter((feature) => !OPTIONAL_FEATURES.includes(feature.$?.["android:name"]));
    for (const name of OPTIONAL_FEATURES) features.push({ $: { "android:name": name, "android:required": "false" } });
    manifest["uses-feature"] = features;
    return result;
  });
};
