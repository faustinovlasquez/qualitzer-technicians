import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

test("every native RefreshControl supplies a nonempty Android color array", () => {
  const root = resolve(__dirname, "../src");
  let controls = 0;
  function inspect(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file); continue; }
      if (!file.endsWith(".tsx")) continue;
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node): void {
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === "RefreshControl") {
          controls++;
          const colors = node.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === "colors");
          assert.ok(colors?.initializer && ts.isJsxExpression(colors.initializer), `${file}: explicit colors required for Android`);
          const expression = colors.initializer.expression;
          assert.ok(expression && ts.isArrayLiteralExpression(expression) && expression.elements.length > 0, `${file}: empty/missing colors crash CircularProgressDrawable`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspect(root);
  assert.ok(controls >= 4);
});