const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "../..");
const { chromium } = require(require.resolve("playwright", { paths: [root, path.resolve(root, "../Qualitzer2.0-Frontend")] }));
const output = mkdtempSync(path.join(tmpdir(), "qualitzer-brand-ui-"));

async function main() {
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { View } from "react-native";
      import { Brand, IconButton } from "./src/ui/components";
      const root = createRoot(document.getElementById("root"));
      window.showBrand = (tenant, compact = false, actions = false) => root.render(
        <View style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Brand tenant={tenant} compact={compact} /></View>
          {actions && <View style={{ flexDirection: "row" }}>
            <IconButton name="refresh-outline" label="Actualizar" onPress={() => {}} />
            <IconButton name="person-outline" label="Perfil" onPress={() => {}} />
            <IconButton name="log-out-outline" label="Salir" onPress={() => {}} />
          </View>}
        </View>
      );
      window.showBrand();
    `, loader: "tsx", resolveDir: root },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    alias: { "react-native": "react-native-web" }, loader: { ".png": "dataurl" },
    plugins: [{ name: "decorative-icons-only", setup(builder) {
      builder.onResolve({ filter: /^@expo\/vector-icons$/ }, () => ({ path: "icons", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const Ionicons = () => null;", loader: "js" }));
    } }],
  });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const results = [];
  try {
    const context = await browser.newContext();
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;background:#fff}#root{width:100%}</style></head><body><div id="root"></div></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    for (const width of [320, 360, 390, 1280]) {
      await page.setViewportSize({ width, height: 220 });
      await page.evaluate(() => window.showBrand());
      await page.getByText("Qualitzer técnicos", { exact: true }).waitFor();
      await page.getByTestId("brand-base-logo").waitFor();
      assert.equal(await page.getByText("Qualitzer técnicos", { exact: true }).count(), 1);
      assert.doesNotMatch(await page.locator("body").innerText(), /FIELD/);
      await page.screenshot({ path: path.join(output, `base-${width}.png`) });
      const company = { id: "brand-test", name: "Empresa de servicios técnicos con un nombre corporativo muy largo", portalOrigin: "https://example.invalid", environment: "production" };
      await page.evaluate((tenant) => window.showBrand(tenant, true, true), company);
      const text = page.getByText(company.name, { exact: true });
      await text.waitFor();
      assert.equal(await text.count(), 1);
      const style = await text.evaluate((element) => ({ whiteSpace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).textOverflow, clipped: element.scrollWidth > element.clientWidth }));
      assert.equal(style.whiteSpace, "nowrap");
      assert.equal(style.overflow, "ellipsis");
      if (width < 400) assert.equal(style.clipped, true);
      for (const label of ["Actualizar", "Perfil", "Salir"]) {
        const box = await page.getByRole("button", { name: label, exact: true }).boundingBox();
        assert.ok(box && box.width >= 44 && box.height >= 44 && box.x + box.width <= width);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `company-${width}.png`) });
      results.push({ width, base: true, company: true, targets44: true, ellipsis: true });
    }
    const company = { id: "brand-test", name: "Empresa verificada", portalOrigin: "https://example.invalid", environment: "production", logo: "https://logo.invalid/broken.png" };
    await page.evaluate((tenant) => window.showBrand(tenant), company);
    await page.getByTestId("brand-base-logo").waitFor();
    const validLogo = await page.getByTestId("brand-base-logo").locator("img").getAttribute("src");
    assert.ok(validLogo?.startsWith("data:image/png;base64,"));
    await page.evaluate((tenant) => window.showBrand(tenant), { ...company, logo: validLogo });
    await page.getByTestId("brand-company-logo").waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="brand-company-logo"] img')?.naturalWidth > 0);
    await page.evaluate((tenant) => window.showBrand(tenant), company);
    await page.getByTestId("brand-base-logo").waitFor();
    await page.evaluate((tenant) => window.showBrand(tenant), { ...company, logo: validLogo });
    await page.getByTestId("brand-company-logo").waitFor();
    assert.equal(await page.getByText(company.name, { exact: true }).count(), 1);
    await context.close();
    writeFileSync(path.join(output, "results.json"), JSON.stringify({ pass: true, results, logoRecovery: true, scope: "isolated Brand and IconButton with decorative icons stubbed; not full App/LoginScreen" }, null, 2));
    console.log(`BRANDING_UI_PASS ${output}`);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });