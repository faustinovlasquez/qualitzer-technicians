// Ofuscación y reducción de código (R8) en las compilaciones release, exigida por Google Play.
// Las reglas protegen los módulos de Expo (propios y de la librería, que se registran por nombre) y el mapa nativo (react-native-maps),
// y conservan número de línea para Crashlytics.
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withGradleProperties } = require("expo/config-plugins");

const START = "# >>> qualitzer: reglas de ofuscación";
const END = "# <<< qualitzer: reglas de ofuscación";
const RULES = [
  "-keep class expo.modules.** { *; }",
  "-keep class com.rnmaps.maps.** { *; }",
  "-keepattributes SourceFile,LineNumberTable",
  "-renamesourcefileattribute SourceFile",
  "-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod",
];
const PROPERTIES = { "android.enableMinifyInReleaseBuilds": "true", "android.enableShrinkResourcesInReleaseBuilds": "true" };

function applyRules(contents) {
  const block = [START, ...RULES, END].join("\n");
  const start = contents.indexOf(START);
  const end = contents.indexOf(END);
  if (start >= 0 && end > start) return `${contents.slice(0, start)}${block}${contents.slice(end + END.length)}`;
  return `${contents.replace(/\s*$/, "")}\n\n${block}\n`;
}

function withReleaseShrinking(config) {
  config = withGradleProperties(config, (gradle) => {
    const properties = gradle.modResults.filter((item) => !(item.type === "property" && item.key in PROPERTIES));
    for (const [key, value] of Object.entries(PROPERTIES)) properties.push({ type: "property", key, value });
    gradle.modResults = properties;
    return gradle;
  });
  return withDangerousMod(config, ["android", (current) => {
    const file = path.join(current.modRequest.platformProjectRoot, "app/proguard-rules.pro");
    const contents = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    fs.writeFileSync(file, applyRules(contents));
    return current;
  }]);
}

module.exports = withReleaseShrinking;
module.exports.applyRules = applyRules;
module.exports.RULES = RULES;
