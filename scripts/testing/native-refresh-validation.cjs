const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "artifacts/logs/native-refresh-closure");
const ts = require(path.join(root, "node_modules/typescript"));
async function main() {
  const report = { at: new Date().toISOString() };
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href, "--test", path.join(root, "tests/refresh-control-native.test.ts")], { cwd: root, encoding: "utf8", timeout: 120000 });
  fs.writeFileSync(path.join(output, "ast-test.log"), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  report.astExitCode = result.status;
  const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const program = ts.createProgram([...config.fileNames, path.join(root, "tests/refresh-control-native.test.ts")], { ...config.options, noEmit: true, incremental: false });
  const diagnostics = [configFile.error, ...config.errors, ...ts.getPreEmitDiagnostics(program)].filter(Boolean);
  report.mobileTypeErrors = diagnostics.map(item => ({ file: item.file?.fileName, code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, "\n") }));
  const mapFile = path.join(root, "android/app/build/generated/sourcemaps/react/release/index.android.bundle.map");
  const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  report.refreshSources = ["src/screens/DashboardScreen.tsx", "src/screens/WorkDetailScreen.tsx"].map(file => {
    const index = map.sources.findIndex(source => source.replaceAll("\\", "/").endsWith(file));
    if (index < 0) throw new Error(`SOURCE_MAP_MISSING ${file}`);
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const embedded = map.sourcesContent[index];
    return { file, matches: text === embedded, sha256: createHash("sha256").update(text).digest("hex"), colorsExplicit: embedded.includes("colors={[palette.primary]}"), backgroundExplicit: embedded.includes("progressBackgroundColor={palette.surface}") };
  });
  const cyclesFile = fs.readdirSync(output).find(file => file.endsWith("-navigation-10.json"));
  const cycles = JSON.parse(fs.readFileSync(path.join(output, cyclesFile), "utf8"));
  const sharp = require(path.join(root, "node_modules/sharp"));
  for (let page = 0; page < 2; page++) {
    const frames = cycles.cycles.filter(item => item.cycle > page * 5 && item.cycle <= (page + 1) * 5);
    const layers = await Promise.all(frames.map(async (item, index) => ({ input: await sharp(path.join(root, item.screen)).resize(270, 600).toBuffer(), left: (index % 3) * 270, top: Math.floor(index / 3) * 600 })));
    await sharp({ create: { width: 810, height: 3000, channels: 3, background: "white" } }).composite(layers).png().toFile(path.join(output, `navigation-contact-sheet-${page + 1}.png`));
  }
  report.navigationTransitions = cycles.cycles.length;
  report.navigationStable = cycles.cycles.every(item => item.stable) && !cycles.error;
  report.passed = report.astExitCode === 0 && report.mobileTypeErrors.length === 0 && report.refreshSources.every(item => item.matches && item.colorsExplicit && item.backgroundExplicit) && report.navigationTransitions === 30 && report.navigationStable;
  fs.writeFileSync(path.join(output, "validation.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });