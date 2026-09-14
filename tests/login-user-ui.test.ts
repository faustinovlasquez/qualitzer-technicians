import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = resolve(__dirname, "..");
const source = (name: string): string => readFileSync(resolve(root, name), "utf8");

test("login technical panel is mounted only inside the explicit development and unlocked gate", () => {
  const text = source("src/screens/LoginScreen.tsx");
  const ast = ts.createSourceFile("LoginScreen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.match(text, /const showDevelopmentTools = __DEV__ && !gatewayLocked;/);
  let panels = 0;
  function visit(node: ts.Node, gated: boolean): void {
    if (ts.isConditionalExpression(node) && node.condition.getText(ast) === "showDevelopmentTools") {
      visit(node.whenTrue, true);
      visit(node.whenFalse, gated);
      return;
    }
    if (ts.isJsxExpression(node) && node.expression?.getText(ast) === "connectionPanel") {
      panels++;
      assert.equal(gated, true);
    }
    ts.forEachChild(node, (child) => visit(child, gated));
  }
  visit(ast, false);
  assert.equal(panels, 1);
  assert.doesNotMatch(text, /Servidor fijado en esta versión|loginConnectionError/);
});

test("submit, keyboard submit, demo and automatic remember remain wired without auth changes", () => {
  const text = source("src/screens/LoginScreen.tsx");
  assert.match(text, /await onLogin\(username.trim\(\), password\)/);
  assert.match(text, /onSubmitEditing=\{\(\) => \{ void handleLogin\(\); \}\}/);
  assert.match(text, /onPress=\{\(\) => \{ void handleLogin\(\); \}\}/);
  assert.match(text, /title="Explorar demostración"[^\n]+onPress=\{onDemo\}/);
  assert.match(text, /Tu sesión se recuerda en este dispositivo/);
  assert.match(text, /setPassword\(""\)/);
  assert.match(source("App.tsx"), /<LoginScreen onLogin=\{app.login\} onDemo=\{\(\) => void app.demo\(\)\}/);
});

test("standalone also excludes development QR while preserving authenticated connection status", () => {
  const text = source("App.tsx");
  assert.match(text, /const showDevelopmentTools = __DEV__ && !gatewayConfiguration.locked;/);
  assert.match(text, /showDevelopmentTools && <DevelopmentQrPanel/);
  assert.match(text, /const reserveQrSpace = showDevelopmentTools &&/);
  assert.match(text, /<OfflineStatusBar/);
  assert.match(text, /onCheck=\{\(\) => void app.checkConnection\(\)\}/);
});