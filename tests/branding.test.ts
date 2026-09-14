import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { brandName, QUALITZER_APP_NAME, safeBrandLogo } from "../src/domain/branding";
import type { Tenant } from "../src/domain/models";
import type { BrandProps } from "../src/ui/components";

const tenant: Tenant = { id: "company-a", name: "Empresa A", portalOrigin: "https://company.example", environment: "production" };

test("base name and company display name never invent a company", () => {
  assert.equal(QUALITZER_APP_NAME, "Qualitzer técnicos");
  assert.equal(brandName(), QUALITZER_APP_NAME);
  assert.equal(brandName({ ...tenant, name: "  " }), QUALITZER_APP_NAME);
  assert.equal(brandName({ ...tenant, name: "  Empresa verificada  " }), "Empresa verificada");
  assert.equal(brandName(tenant), "Empresa A");
});

test("logo presentation preserves accepted URLs and rejects unsafe sources", () => {
  for (const logo of [undefined, null, "", "javascript:alert(1)", "file:///logo.png", "//example.com/logo.png", "https://user:pass@example.com/logo.png", "https://example.com/lo\ngo.png", " https://example.com/logo.png", "https://example.com\\logo.png", "data:image/svg+xml;base64,PHN2Zz4="]) {
    assert.equal(safeBrandLogo(logo), null);
  }
  for (const logo of ["https://example.com/logo.png", "http://localhost:8081/logo.png", "data:image/png;base64,AQID", "data:image/jpeg;base64,AQID", "data:image/webp;base64,AQID"]) {
    assert.equal(safeBrandLogo(logo), logo);
  }
});

interface ElementProps {
  children?: ElementNode | ElementNode[] | string;
  logo?: string | null;
  source?: { uri: string } | string;
  onError?: () => void;
  accessibilityLabel?: string;
  numberOfLines?: number;
  ellipsizeMode?: string;
  testID?: string;
}
interface ElementNode { type: string | ((props: ElementProps) => ElementNode); key?: string; props: ElementProps; }

function componentHarness() {
  let failed = false;
  const exported: { Brand?: (props?: BrandProps) => ElementNode } = {};
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/ui/components.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type: ElementNode["type"], props: ElementProps, key?: string): ElementNode => ({ type, props, key });
  runInNewContext(code, { exports: exported, require(name: string): unknown {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return { useState: () => [failed, (value: boolean) => { failed = value; }] };
    if (name === "react-native") return { View: "View", Text: "Text", Image: "Image", StyleSheet: { create: (styles: unknown) => styles } };
    if (name === "@expo/vector-icons") return { Ionicons: "Ionicons" };
    if (name === "../domain/branding") return { brandName, safeBrandLogo };
    if (name === "./theme") return { palette: {}, radius: {}, theme: {}, typography: {} };
    if (name === "../../assets/qualitzer-logo.png") return "bundled-qualitzer-logo";
    throw new Error(`Unexpected branding dependency: ${name}`);
  } });
  if (!exported.Brand) throw new Error("Brand export missing");
  const Brand = exported.Brand;
  let previousKey: string | undefined;
  return (props?: BrandProps) => {
    const tree = Brand(props);
    const children = tree.props.children;
    assert.ok(Array.isArray(children));
    assert.equal(children.length, 2, "only logo and one name, never a FIELD tag");
    const [mark, text] = children;
    assert.equal(typeof mark.type, "function");
    if (previousKey !== mark.key) { failed = false; previousKey = mark.key; }
    if (typeof mark.type !== "function") throw new Error("Logo component missing");
    const image = mark.type(mark.props).props.children;
    assert.ok(image && typeof image === "object" && !Array.isArray(image));
    return { tree, text, image };
  };
}

test("Brand shows the bundled Q before login, one accessible name and one ellipsized line", () => {
  const render = componentHarness();
  for (const props of [undefined, { showTag: true, singleLine: false }, { compact: true }]) {
    const { tree, text, image } = render(props);
    assert.equal(tree.props.accessibilityLabel, QUALITZER_APP_NAME);
    assert.equal(text.props.children, QUALITZER_APP_NAME);
    assert.equal(text.props.numberOfLines, 1);
    assert.equal(text.props.ellipsizeMode, "tail");
    assert.equal(image.props.source, "bundled-qualitzer-logo");
    assert.equal(image.props.onError, undefined);
  }
});

test("company name survives missing, invalid and broken logos without duplicate branding", () => {
  const render = componentHarness();
  for (const logo of [null, "javascript:invalid", "https://example.com/broken.png"]) {
    const company = { ...tenant, logo };
    const first = render({ tenant: company, compact: true });
    first.image.props.onError?.();
    const next = render({ tenant: company, compact: true });
    assert.equal(next.tree.props.accessibilityLabel, tenant.name);
    assert.equal(next.text.props.children, tenant.name);
    assert.equal(next.image.props.source, "bundled-qualitzer-logo");
    assert.equal(next.image.props.onError, undefined, "fallback cannot enter an image retry loop");
  }
});

test("new URI, company switch and returning to an old URI remount the logo failure state", () => {
  const render = componentHarness();
  const first = { ...tenant, logo: "https://example.com/a.png" };
  render({ tenant: first }).image.props.onError?.();
  assert.equal(render({ tenant: first }).image.props.source, "bundled-qualitzer-logo");
  const second = { ...first, logo: "https://example.com/b.png" };
  assert.equal(render({ tenant: second }).image.props.testID, "brand-company-logo");
  const returned = render({ tenant: first }).image.props.source;
  assert.ok(returned && typeof returned === "object");
  assert.equal(returned.uri, first.logo);
  render({ tenant: first }).image.props.onError?.();
  const other = render({ tenant: { ...first, id: "company-b", name: "Empresa B" } });
  assert.equal(other.image.props.testID, "brand-company-logo");
  assert.equal(other.text.props.children, "Empresa B");
  assert.equal(render().image.props.source, "bundled-qualitzer-logo");
});