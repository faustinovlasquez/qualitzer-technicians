// Memoria de Gradle para la compilación release: expo-updates (KSP) y Firebase Crashlytics agotan el Metaspace de 512 MB
// que trae la plantilla de Expo (OutOfMemoryError: Metaspace en :expo-updates:kspReleaseKotlin).
const { withGradleProperties } = require("expo/config-plugins");

const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1536m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8";

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (gradle) => {
    const properties = gradle.modResults.filter((item) => !(item.type === "property" && (item.key === "org.gradle.jvmargs" || item.key === "kotlin.daemon.jvmargs")));
    properties.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    properties.push({ type: "property", key: "kotlin.daemon.jvmargs", value: "-Xmx3072m -XX:MaxMetaspaceSize=1024m" });
    gradle.modResults = properties;
    return gradle;
  });
};
