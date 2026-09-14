import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = resolve(__dirname, "../src/screens");
const source = (file: string): string => readFileSync(resolve(root, file), "utf8");

test("step navigation and save dock are siblings of the question scroll", () => {
  const text = source("workDetail/checklist/StepEditor.tsx");
  const ast = ts.createSourceFile("StepEditor.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let dock = 0;
  function visit(node: ts.Node, inScroll: boolean): void {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(ast);
      const isDock = node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "testID" && attribute.initializer?.getText(ast) === '"checklist-step-dock"');
      if (isDock) { dock++; assert.equal(inScroll, false); assert.match(node.getText(ast), /Guardar y seguir/); }
      ts.forEachChild(node, (child) => visit(child, inScroll || tag === "ScrollView"));
    } else ts.forEachChild(node, (child) => visit(child, inScroll));
  }
  visit(ast, false);
  assert.equal(dock, 1);
  assert.match(text, /scrollTo\(\{ y: 0, animated: false \}\)/);
  assert.match(source("workDetail/ChecklistTab.tsx"), /key=\{`\$\{checklist.checklistId\}:\$\{step.stepId\}`\}/);
});

test("checklist and evidence routes are separate from parent scroll and inside keyboard/safe-area host", () => {
  const text = source("WorkDetailScreen.tsx");
  const ast = ts.createSourceFile("WorkDetailScreen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const branches = new Map<string, ts.Expression>();
  let evidence: ts.Expression | undefined;
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "evidenceContent") evidence = node.initializer;
    if (ts.isConditionalExpression(node) && ts.isBinaryExpression(node.condition)
      && node.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      && ts.isIdentifier(node.condition.left) && node.condition.left.text === "tab"
      && ts.isStringLiteral(node.condition.right) && ["checklist", "evidence"].includes(node.condition.right.text)) {
      const branch = node.whenTrue;
      if (ts.isJsxSelfClosingElement(branch) && branch.tagName.getText(ast) === "ChecklistTab"
        || ts.isIdentifier(branch) && branch.text === "evidenceContent") {
        branches.set(node.condition.right.text, branch);
        const ancestors: string[] = [];
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isJsxElement(parent)) ancestors.push(parent.openingElement.tagName.getText(ast));
        }
        assert.equal(ancestors.includes("ScrollView"), false);
        assert.ok(ancestors.includes("KeyboardAvoidingView"));
        assert.ok(ancestors.indexOf("SafeAreaView") > ancestors.indexOf("KeyboardAvoidingView"));
        let fallback = node.whenFalse;
        while (ts.isConditionalExpression(fallback)) fallback = fallback.whenFalse;
        assert.ok(ts.isJsxElement(fallback) && fallback.openingElement.tagName.getText(ast) === "ScrollView");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const checklist = branches.get("checklist");
  const files = branches.get("evidence");
  assert.ok(checklist && ts.isJsxSelfClosingElement(checklist) && checklist.tagName.getText(ast) === "ChecklistTab");
  assert.ok(files && ts.isIdentifier(files) && files.text === "evidenceContent");
  assert.ok(evidence && ts.isJsxSelfClosingElement(evidence) && evidence.tagName.getText(ast) === "FileWorkspace");
  assert.ok(evidence.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "compact" && attribute.initializer === undefined));
  assert.match(text, /behavior=\{Platform.OS === "ios" \? "padding" : undefined\}/);
  assert.match(text, /keyboardVerticalOffset=\{insets.top\}/);
  assert.match(text, /colors=\{\[palette.primary\]\}/);
  assert.match(text, /progressBackgroundColor=\{palette.surface\}/);
});

test("wizard omits template code but retains canonical confirmed progress and checklist requirement", () => {
  const text = source("workDetail/ChecklistTab.tsx");
  assert.doesNotMatch(text, /plainText\(checklist.code\)|Complementario/);
  assert.match(text, /checklist.required === true/);
  assert.match(text, /<ChecklistProgress checklist=\{checklist\} compact/);
  assert.match(source("workDetail/checklist/ChecklistCatalog.tsx"), /checklistFillProgress\(checklist.steps\)/);
});

test("pending evidence stays visible beside requirements, separate from confirmed attachments", () => {
  const text = source("workDetail/checklist/StepEditor.tsx");
  assert.match(text, /context.pendingEvidenceCount\?\.\(id\)/);
  assert.match(text, /archivos sin confirmar/);
  assert.match(text, /step.isFilesRequired/);
  assert.match(text, /step.attachments.length/);
  assert.match(source("WorkDetailScreen.tsx"), /pendingEvidenceCount=\{\(id\) => allPendingDocuments.filter\(\(operation\) => operation.stepId === id\).length\}/);
});

test("compact layout preserves readable headings and minimum 44px action dimensions", () => {
  const text = source("workDetail/checklist/styles.ts");
  assert.match(text, /questionHeading:.*fontSize: 20, lineHeight: 27/);
  assert.match(text, /compactButton:.*minHeight: 44/);
  assert.match(text, /dockSave:.*minHeight: 44/);
  assert.match(source("workDetail/DetailUi.tsx"), /aria-checked=\{selected\} aria-disabled=\{disabled\}/);
});