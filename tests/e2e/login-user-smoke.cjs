const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");
const root = path.resolve(__dirname, "../..");
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = fs.mkdtempSync(path.join(os.tmpdir(), "qualitzer-login-user-"));
const report = { output, passed: false, scope: "Real LoginScreen and RN Web controls; fake callbacks/config/native boundaries; all network blocked, no credentials or API writes", tests: [], errors: [], requests: [] };
const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { SafeAreaProvider } from "react-native-safe-area-context";
  import { LoginScreen } from "./src/screens/LoginScreen";
  import { gatewayConfiguration } from "./src/infrastructure/gatewayConfig";
  import { apiMessage, NetworkError } from "./src/infrastructure/errors";
  import { loginConnectionError, storedGatewayMismatch } from "./src/infrastructure/gatewayConnection";
  const root = createRoot(document.getElementById("root"));
  let revision = 0;
  const fixture = window.loginFixture = {
    calls: 0, demos: 0, health: 0, changes: 0, matched: false, mode: "success", release: () => {},
    render({ locked = true, busy = false, error = null, code = null, network = false, mismatch = false, invalid = false } = {}) {
      Object.assign(gatewayConfiguration, { locked, error: invalid ? "Invalid HTTPS config with fixture details" : null });
      fixture.calls = 0; fixture.demos = 0; fixture.health = 0; fixture.changes = 0; fixture.matched = false; fixture.mode = "success";
      const message = invalid ? gatewayConfiguration.error : mismatch ? storedGatewayMismatch(gatewayConfiguration, "https://previous.example.com/mobile") : network ? loginConnectionError(new NetworkError("network"), gatewayConfiguration.url) : code ? apiMessage(code) : error;
      root.render(<SafeAreaProvider key={++revision} initialMetrics={{frame:{x:0,y:0,width:390,height:844},insets:{top:0,left:0,right:0,bottom:0}}}>
        <LoginScreen gatewayUrl={gatewayConfiguration.url} error={message} busy={busy}
          onGatewayChange={() => { fixture.changes++; }} onDemo={() => { fixture.demos++; }}
          onLogin={async (username, password) => {
            fixture.calls++; fixture.matched = username === "fixture-user" && password === "synthetic-only";
            if (fixture.mode === "hold") await new Promise((resolve) => { fixture.release = resolve; });
            if (fixture.mode === "network") throw new NetworkError("network");
            if (fixture.mode === "unexpected") throw new Error('raw response {"token":"fixture-token"}');
          }} />
      </SafeAreaProvider>);
    }
  };
  fixture.render();
`;

async function bundle(development) {
  const stubs = {
    "@expo/vector-icons": "export const Ionicons = () => null;",
    "expo-linear-gradient": "export { View as LinearGradient } from 'react-native';",
    "../infrastructure/gatewayConfig": "export const gatewayConfiguration = {locked:true,url:'https://login-fixture.example.com/mobile',error:null};",
    "./src/infrastructure/gatewayConfig": "export const gatewayConfiguration = {locked:true,url:'https://login-fixture.example.com/mobile',error:null};",
    "../infrastructure/photos": "export const uploadFetch = async () => { window.loginFixture.health++; return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({ok:true,backendReachable:true})}; };",
  };
  return build({ absWorkingDir: root, stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', __DEV__: String(development) }, alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl" },
    resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
    plugins: [{ name: "isolated-login-boundaries", setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => stubs[args.path] ? { path: args.path.endsWith("/gatewayConfig") ? "../infrastructure/gatewayConfig" : args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: stubs[args.path], loader: "tsx", resolveDir: root }));
    } }],
  });
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const development of [false, true]) {
      const compiled = await bundle(development);
      const context = await browser.newContext();
      await context.route("**/*", (route) => { report.requests.push(route.request().url()); return route.abort(); });
      const page = await context.newPage();
      page.on("pageerror", (error) => report.errors.push(error.message));
      page.setDefaultTimeout(8000);
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div></body></html>');
      await page.addScriptTag({ content: compiled.outputFiles[0].text });
      const button = (name) => page.getByRole("button", { name, exact: true });
      const user = () => page.getByRole("textbox", { name: "Correo o usuario", exact: true });
      const password = () => page.getByLabel("Contraseña", { exact: true });
      async function fresh(options = {}) {
        await page.evaluate((value) => window.loginFixture.render(value), options);
        await user().waitFor();
        await page.waitForFunction(() => document.querySelector('input[aria-label="Correo o usuario"]')?.value === "");
      }
      async function check(name, run) { await run(); report.tests.push({ name: `${development ? "dev" : "release"}: ${name}`, passed: true }); }
      async function noTechnical() {
        assert.doesNotMatch(await page.locator("body").innerText(), /pasarela|comprobar conexión|conexión avanzada|https?:\/\/|login-fixture|fixture-token|backend|CORS|HTTPS|URL base|raw response/i);
        assert.equal(await page.getByLabel("URL de la pasarela", { exact: true }).count(), 0);
        assert.equal(await button("Comprobar conexión").count(), 0);
      }
      for (const locked of development ? [true] : [true, false]) {
        for (const width of [320, 390, 1280]) {
          await check(`clean login locked=${locked} width=${width}`, async () => {
            await page.setViewportSize({ width, height: 844 });
            await fresh({ locked });
            await noTechnical();
            await password().waitFor();
            await page.getByText(/Tu sesión se recuerda en este dispositivo/).waitFor();
            await button("Iniciar sesión").scrollIntoViewIfNeeded();
            assert.equal(await button("Iniciar sesión").isEnabled(), true);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({ path: path.join(output, `${development ? "dev" : "release"}-${locked}-${width}.png`) });
            await button("Explorar demostración").click();
            assert.deepEqual(await page.evaluate(() => [window.loginFixture.calls, window.loginFixture.demos, window.loginFixture.health, window.loginFixture.changes]), [0, 1, 0, 0]);
          });
        }
      }
      await check("validation, password reveal, submit lock and clearing", async () => {
        await fresh();
        await button("Iniciar sesión").click();
        await page.getByRole("alert").filter({ hasText: "Ingresa tu correo o usuario." }).waitFor();
        assert.equal(await page.evaluate(() => window.loginFixture.calls), 0);
        await user().fill(" fixture-user ");
        await password().fill("synthetic-only");
        await button("Mostrar contraseña").click();
        assert.equal(await password().evaluate((element) => element.type), "text");
        await page.evaluate(() => { window.loginFixture.mode = "hold"; });
        await button("Iniciar sesión").click();
        assert.equal(await button("Iniciando sesión…").isDisabled(), true);
        assert.equal(await button("Explorar demostración").isDisabled(), true);
        assert.equal(await user().isEditable(), false);
        assert.equal(await password().isEditable(), false);
        assert.deepEqual(await page.evaluate(() => [window.loginFixture.calls, window.loginFixture.matched]), [1, true]);
        await page.evaluate(() => window.loginFixture.release());
        await button("Iniciar sesión").waitFor();
        assert.equal(await password().inputValue(), "");
        assert.equal(await password().evaluate((element) => element.type), "password");
        await noTechnical();
      });
      await check("keyboard submit still invokes login", async () => {
        await fresh();
        await user().fill("fixture-user");
        await user().press("Enter");
        assert.equal(await password().evaluate((element) => element === document.activeElement), true);
        await password().fill("synthetic-only");
        await password().press("Enter");
        await page.waitForFunction(() => window.loginFixture.calls === 1);
        assert.equal(await page.evaluate(() => window.loginFixture.matched), true);
      });
      await check("safe relevant errors, network failures and unknown bodies", async () => {
        const cases = [
          [{ code: "AUTH_INVALID_CREDENTIALS" }, "Revisa tu usuario y contraseña."],
          [{ code: "AUTH_RATE_LIMITED" }, "Demasiados intentos de acceso."],
          [{ code: "WORKER_REQUIRED" }, "colaborador asociado"],
          [{ code: "UPSTREAM_UNAVAILABLE" }, "No se pudo conectar con Qualitzer."],
          [{ code: "UPSTREAM_INVALID_RESPONSE" }, "El servicio no está disponible"],
          [{ code: "SESSION_PERSISTENCE_UNAVAILABLE" }, "No se pudo guardar tu sesión de forma segura."],
          [{ code: "LOGIN_DISCOVERY_UNAVAILABLE" }, "No se pudo verificar tu acceso"],
          [{ network: true }, "No se pudo conectar con Qualitzer."],
          [{ mismatch: true }, "Tus datos pendientes se conservan."],
          [{ invalid: true }, "Contacta a tu administrador"],
          [{ error: 'raw response {"token":"fixture-token"} https://login-fixture.example.com/mobile' }, "No se pudo iniciar sesión."],
        ];
        for (const [options, message] of cases) {
          await fresh(options);
          await page.getByRole("alert").filter({ hasText: message }).waitFor();
          await noTechnical();
          assert.equal(await page.evaluate(() => window.loginFixture.calls), 0);
        }
        for (const mode of ["network", "unexpected"]) {
          await fresh();
          await user().fill("fixture-user");
          await password().fill("synthetic-only");
          await page.evaluate((value) => { window.loginFixture.mode = value; }, mode);
          await button("Iniciar sesión").click();
          await page.getByRole("alert").waitFor();
          await noTechnical();
          assert.equal(await password().inputValue(), "");
        }
      });
      await check("external busy state prevents access and demo", async () => {
        await fresh({ busy: true });
        assert.equal(await button("Iniciando sesión…").isDisabled(), true);
        assert.equal(await button("Explorar demostración").isDisabled(), true);
        await noTechnical();
      });
      if (development) await check("unlocked development tools require disclosure and never autologin", async () => {
        await fresh({ locked: false });
        assert.equal(await button("Comprobar conexión").count(), 0);
        await button("Conexión avanzada. Configurar pasarela móvil").click();
        await page.getByLabel("URL de la pasarela", { exact: true }).waitFor();
        await button("Comprobar conexión").click();
        await page.getByText("Pasarela accesible y backend disponible. Esta comprobación no valida tu usuario ni contraseña.", { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => [window.loginFixture.calls, window.loginFixture.health]), [0, 1]);
        await page.getByLabel("URL de la pasarela", { exact: true }).fill("https://different.example.com/mobile");
        assert.equal(await page.evaluate(() => window.loginFixture.changes), 1);
      });
      await context.close();
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.requests, []);
    report.passed = true;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
    console.log(`LOGIN_USER_REPORT ${output} passed=${report.passed} tests=${report.tests.length}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });