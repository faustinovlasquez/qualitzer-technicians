const { spawnSync } = require("node:child_process");
const { readdirSync, existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const localNode = resolve(root, process.platform === "win32" ? "node_modules/node/bin/node.exe" : "node_modules/node/bin/node");
const tests = ["server/tests", "tests", "src/offline/tests", "src/screens/offline/tests"].flatMap((folder) => readdirSync(resolve(root, folder)).filter((file) => file.endsWith(".test.ts")).map((file) => `${folder}/${file}`));
const result = spawnSync(existsSync(localNode) ? localNode : process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "server/tsconfig.json", "--test", "--test-reporter=spec", ...tests], { cwd: root, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;