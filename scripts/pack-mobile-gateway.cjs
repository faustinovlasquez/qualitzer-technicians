const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { builtinModules, createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const localRequire = createRequire(path.join(root, "package.json"));
const esbuild = localRequire("esbuild");
const ts = localRequire("typescript");
const name = "@qualitzer/mobile-gateway";
const version = "1.0.6";
const destination = path.resolve(root, "artifacts/mobile-gateway");
const hash = (content) => crypto.createHash("sha256").update(content).digest("hex");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const forbidden = /(?:^|\/)(?:expo(?:-[^/]*)?|@expo|react-native(?:-[^/]*)?|sharp|qrcode|tests|\.data|\.env(?:\.[^/]*)?)(?:\/|$)|^server\/(?:index|development|app)\.ts$/;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`PACK_COMMAND_FAILED: ${result.stderr ?? result.error?.message}`);
  return result.stdout;
}

function packageRoot(file) {
  let directory = path.dirname(file);
  while (directory !== root && directory !== path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) {
      const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (data.name && data.version) return { directory, data };
    }
    directory = path.dirname(directory);
  }
  throw new Error(`DEPENDENCY_MANIFEST_MISSING: ${relative(file)}`);
}

async function build(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const outfile = path.join(directory, "index.cjs");
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: ["server/embedded.ts"], outfile,
    bundle: true, platform: "node", format: "cjs", target: "node20.12.2",
    packages: "bundle", treeShaking: true, minify: false, sourcemap: false,
    legalComments: "inline", metafile: true, logLevel: "warning",
    plugins: [{ name: "exclude-private-inputs", setup(context) {
      context.onLoad({ filter: /(?:^|[\\/])\.(?:data(?:[\\/]|$)|env(?:\.[^\\/]*)?$)/i }, () => {
        throw new Error("PRIVATE_BUNDLE_INPUT_FORBIDDEN");
      });
    } }],
  });
  const builtins = new Set(builtinModules.map((item) => item.replace(/^node:/, "")));
  for (const output of Object.values(result.metafile.outputs)) {
    for (const item of output.imports) {
      if (item.external && !builtins.has(item.path.replace(/^node:/, ""))) throw new Error(`EXTERNAL_DEPENDENCY: ${item.path}`);
    }
  }
  const inputs = Object.keys(result.metafile.inputs).sort();
  for (const file of inputs) if (forbidden.test(file)) throw new Error(`FORBIDDEN_BUNDLE_INPUT: ${file}`);
  const dependencies = new Map();
  for (const file of inputs.filter((file) => file.includes("node_modules/"))) {
    const dependency = packageRoot(path.join(root, file));
    dependencies.set(relative(dependency.directory), dependency);
  }
  for (const [required, major] of [["express", "5"], ["multer", "2"]]) {
    if (![...dependencies.values()].some(({ data }) => data.name === required && data.version.split(".")[0] === major)) throw new Error(`BUNDLED_VERSION_REQUIRED: ${required}@${major}`);
  }
  const licenses = [];
  const thirdParty = [];
  for (const [location, { directory: dependencyDirectory, data }] of [...dependencies].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const licenseFiles = fs.readdirSync(dependencyDirectory).filter((file) => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(file) && fs.statSync(path.join(dependencyDirectory, file)).isFile()).sort();
    if (!licenseFiles.length) throw new Error(`DEPENDENCY_LICENSE_MISSING: ${data.name}`);
    thirdParty.push({ name: data.name, version: data.version, license: data.license, location, manifestSha256: hash(fs.readFileSync(path.join(dependencyDirectory, "package.json"))) });
    licenses.push(`## ${data.name}@${data.version} (${data.license ?? "see license"})\n\n${licenseFiles.map((file) => `### ${file}\n\n${fs.readFileSync(path.join(dependencyDirectory, file), "utf8")}`).join("\n\n")}`);
  }
  fs.writeFileSync(path.join(directory, "THIRD-PARTY-LICENSES.md"), `${licenses.join("\n\n---\n\n")}\n`);
  for (const [source, target] of [["embedded.ts", "index.d.ts"], ["embedded-contract.ts", "embedded-contract.d.ts"]]) {
    const declaration = ts.transpileDeclaration(fs.readFileSync(path.join(root, "server", source), "utf8"), {
      fileName: source, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    });
    if (declaration.diagnostics?.length) throw new Error(`DECLARATION_FAILED: ${source}`);
    if (/from ["'](?:express|zod)/.test(declaration.outputText)) throw new Error("EXTERNAL_TYPE_DEPENDENCY");
    fs.writeFileSync(path.join(directory, target), declaration.outputText);
  }
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(directory, "LICENSE"));
  fs.copyFileSync(path.join(root, "docs", "EMBEDDED-GATEWAY.md"), path.join(directory, "README.md"));
  fs.writeFileSync(path.join(directory, "package.json"), `${JSON.stringify({
    name, version, description: "Qualitzer mobile gateway embedded Node runtime (generated artifact)",
    main: "./index.cjs", types: "./index.d.ts", type: "commonjs",
    exports: { ".": { types: "./index.d.ts", require: "./index.cjs", default: "./index.cjs" } },
    engines: { node: ">=20.12.2" }, license: "MIT", files: ["*.cjs", "*.d.ts", "*.md", "*.json", "LICENSE"],
    dependencies: {},
  }, null, 2)}\n`);
  const sources = [...new Set([...inputs, "server/embedded-contract.ts", "scripts/pack-mobile-gateway.cjs", "docs/EMBEDDED-GATEWAY.md", "LICENSE"])].sort();
  fs.writeFileSync(path.join(directory, "SOURCE-MANIFEST.json"), `${JSON.stringify({
    name, version, target: "node20.12.2", tools: { esbuild: esbuild.version, typescript: ts.version },
    bundleSha256: hash(fs.readFileSync(outfile)), dependencies: thirdParty,
    sources: sources.map((file) => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
  }, null, 2)}\n`);
  return { dependencies: thirdParty.length, sources: inputs.length, bundleSha256: hash(fs.readFileSync(outfile)) };
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-mobile-gateway-pack-"));
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  try {
    const summary = await build(first);
    await build(second);
    for (const file of fs.readdirSync(first)) {
      if (!fs.readFileSync(path.join(first, file)).equals(fs.readFileSync(path.join(second, file)))) throw new Error(`NON_REPRODUCIBLE_BUILD: ${file}`);
    }
    const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    if (!fs.existsSync(npmCli)) throw new Error("NPM_CLI_NOT_FOUND_USE_SYSTEM_NODE_OR_npm_execpath");
    const pack = (directory) => {
      const output = run(process.execPath, [npmCli, "pack", "--ignore-scripts", "--json", "--cache", path.join(temporary, "npm-cache")], directory);
      const result = JSON.parse(output)[0];
      if (result.files.some(({ path: file }) => !/^(?:index\.cjs|(?:index|embedded-contract)\.d\.ts|(?:README|THIRD-PARTY-LICENSES)\.md|(?:package|SOURCE-MANIFEST)\.json|LICENSE)$/.test(file))) throw new Error("UNEXPECTED_PACKAGE_CONTENT");
      return path.join(directory, result.filename);
    };
    const archive = pack(first);
    const rebuilt = pack(second);
    const sha256 = hash(fs.readFileSync(archive));
    if (sha256 !== hash(fs.readFileSync(rebuilt))) throw new Error("NON_REPRODUCIBLE_TARBALL");
    fs.mkdirSync(destination, { recursive: true });
    const target = path.join(destination, `qualitzer-mobile-gateway-${version}.tgz`);
    if (fs.existsSync(target)) {
      if (hash(fs.readFileSync(target)) !== sha256) throw new Error("VERSIONED_GATEWAY_ARCHIVE_ALREADY_EXISTS");
    } else fs.copyFileSync(archive, target, fs.constants.COPYFILE_EXCL);
    process.stdout.write(`${JSON.stringify({ name, version, archive: target, sha256, reproducible: true, ...summary }, null, 2)}\n`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { build };