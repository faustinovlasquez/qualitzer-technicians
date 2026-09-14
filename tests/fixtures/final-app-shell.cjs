const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { build } = require("esbuild");
const root = path.resolve(__dirname, "../..");
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-final-app-shell-"));
const report = { output, scope: "Actual App, Dashboard, Profile and Brand with demo data and a controlled app-state fixture; no real auth, offline engine or native implementation", results: [], pageErrors: [], requests: [] };
const hook = `
import { useState } from "react";
import { makeDemoData, demoUser } from "./src/infrastructure/demoData";
import { dateKey } from "./src/domain/format";
const data = makeDemoData();
export function useTechnicianApp() {
  const [tab, setTab] = useState("today");
  const [tenant, setTenant] = useState({ id: "shell-fixture", name: "Empresa ficticia", portalOrigin: "https://company.example", environment: "production" });
  window.setFixtureTenant = setTenant;
  window.fixtureCalls ??= { refresh: 0, logout: 0 };
  return { tab, setTab, session: { token: "demo", mode: "demo", tenant, user: demoUser, branchId: 1 },
    restoring: false, finalizingSession: false, forcePassword: false, busy: false, loading: false,
    selected: null, selectedOrder: null, selectedCreationKind: null, selectedOffline: false,
    data, range: { startDate: dateKey(), endDate: dateKey() }, notifications: { state: null },
    gatewayUrl: "https://shell.example/mobile", storageKey: "isolated-shell-fixture", error: null,
    refresh: async () => { window.fixtureCalls.refresh++; }, logout: async () => { window.fixtureCalls.logout++; },
    openOffline: () => { throw new Error("OFFLINE_NOT_IN_SHELL_SCOPE"); },
    openCreate: () => { throw new Error("CREATION_NOT_IN_SHELL_SCOPE"); }
  };
}`;
const omitted = {
  "./src/screens/WorkDetailScreen": ["WorkDetailScreen"],
  "./src/screens/OrderDetailScreen": ["OrderDetailScreen"],
  "./src/screens/LoginScreen": ["LoginScreen"],
  "./src/screens/TenantSelectionScreen": ["TenantSelectionScreen"],
  "./src/screens/ForcedPasswordScreen": ["ForcedPasswordScreen"],
  "./src/screens/SessionSetupScreen": ["SessionSetupScreen"],
  "./src/screens/creation": ["CreationScreen", "CreationQuickMenu"],
  "./src/notifications": ["NotificationCenterScreen"],
  "./src/screens/offline/OfflineCenterScreen": ["OfflineCenterScreen"],
  "./src/ui/DevelopmentQrPanel": ["DevelopmentQrPanel"],
};
async function main() {
  const bundle = await build({
    stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import App from "./App"; createRoot(document.getElementById("root")).render(<App />);', loader: "tsx", resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl" },
    plugins: [{ name: "explicit-shell-test-boundaries", setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === "./src/application/useTechnicianApp") return { path: "hook", namespace: "fixture" };
        if (omitted[args.path]) return { path: args.path, namespace: "fixture" };
        if (["@expo/vector-icons", "expo-status-bar", "expo-crypto", "expo-modules-core"].includes(args.path)) return { path: args.path, namespace: "fixture" };
      });
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
        let contents;
        if (args.path === "hook") contents = hook;
        else if (args.path === "@expo/vector-icons") contents = "export const Ionicons = () => null;";
        else if (args.path === "expo-status-bar") contents = "export const StatusBar = () => null;";
        else if (args.path === "expo-modules-core") contents = 'export const requireOptionalNativeModule = () => { throw new Error("NATIVE_MODULE_UNEXPECTED_ON_WEB"); };';
        else if (args.path === "expo-crypto") contents = 'export const CryptoDigestAlgorithm = { SHA256: "SHA-256" }; export const digestStringAsync = () => { throw new Error("NATIVE_DIGEST_OUT_OF_SCOPE"); };';
        else contents = omitted[args.path].map((name) => name === "CreationQuickMenu" ? `export const ${name} = () => null;` : `export const ${name} = () => { throw new Error("${name}_NOT_IN_SHELL_SCOPE"); };`).join("\n");
        return { contents, loader: "tsx", resolveDir: root };
      });
    } }],
  });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", (route) => { report.requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const width of [320, 360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const company = "Empresa ficticia de servicios técnicos con un nombre muy largo";
      await page.evaluate((name) => window.setFixtureTenant((tenant) => ({ ...tenant, name })), company);
      await page.getByRole("heading", { name: "Mi jornada", exact: true }).waitFor();
      const label = page.getByText(company, { exact: true });
      assert.equal(await label.count(), 1);
      const labelBox = await label.boundingBox();
      const boxes = [];
      for (const name of ["Actualizar asignaciones", "Ver mi perfil y sucursal", "Cerrar sesión"]) {
        const box = await page.getByRole("button", { name, exact: true }).boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44 && box.x + box.width <= width);
        boxes.push(box);
      }
      assert.ok(labelBox.x + labelBox.width <= boxes[0].x);
      for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i - 1].x + boxes[i - 1].width <= boxes[i].x);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.doesNotMatch(await page.locator("body").innerText(), /\bFIELD\b/);
      await page.getByTestId("brand-base-logo").waitFor();
      await page.getByRole("button", { name: "Actualizar asignaciones", exact: true }).click();
      await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
      await page.getByRole("button", { name: "Seguir trabajando", exact: true }).click();
      await page.getByRole("button", { name: "Seguir trabajando", exact: true }).waitFor({ state: "detached" });
      assert.equal(await page.evaluate(() => window.fixtureCalls.logout), 0);
      await page.screenshot({ path: path.join(output, `${width}-header.png`) });
      await page.getByRole("button", { name: "Ver mi perfil y sucursal", exact: true }).click();
      const pin = page.getByRole("button", { name: "Añadir empresa a pantalla de inicio", exact: true });
      await pin.scrollIntoViewIfNeeded();
      assert.equal(await pin.isDisabled(), true);
      await page.getByText("Los accesos de empresa están disponibles en la app Android.", { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `${width}-profile.png`) });
      await page.getByRole("tab", { name: "Mi jornada", exact: true }).click();
      report.results.push({ width, passed: true, targets44: true, logoutCancelled: true, webShortcutDisabled: true });
    }
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.requests, []);
    report.passed = true;
    await context.close();
  } finally { await browser.close(); }
}
main().catch((error) => { report.error = error.stack; process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
});