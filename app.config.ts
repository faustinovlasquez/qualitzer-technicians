/// <reference types="node" />
import type { ConfigContext, ExpoConfig } from "expo/config";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { standaloneGatewayUrl } from "./config/gatewayPolicy";

const brandSchema = z.object({
  tenantId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
  name: z.string().min(1).max(120).refine((value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)),
  androidPackage: z.string().max(255).regex(/^[a-z][A-Za-z0-9_]*(?:\.[a-z][A-Za-z0-9_]*)+$/),
  iosBundleIdentifier: z.string().max(255).regex(/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/),
  iconPath: z.string().min(1).max(300),
  adaptiveIconPath: z.string().min(1).max(300).optional(),
}).strict();

function requireBaseConfig(config: ConfigContext["config"]): asserts config is ExpoConfig {
  if (typeof config.name !== "string" || typeof config.slug !== "string") {
    throw new Error("BRANDING_BASE_CONFIG_REQUIRES_NAME_AND_SLUG");
  }
}

function readBrand(projectRoot: string, file: string): z.infer<typeof brandSchema> {
  if (!file || file.trim() !== file || /[\u0000-\u001f\u007f]/.test(file) ||
      /^(?:[a-z][a-z\d+.-]*:\/\/|file:|[\\/]{2})/i.test(file) || !file.endsWith(".json")) {
    throw new Error("QUALITZER_BRAND_FILE_MUST_BE_LOCAL_JSON");
  }
  const filename = isAbsolute(file) ? file : resolve(projectRoot, file);
  let input: unknown;
  try {
    const info = statSync(filename);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error();
    const bytes = readFileSync(filename);
    if (bytes.length > 64 * 1024) throw new Error();
    input = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("QUALITZER_BRAND_FILE_UNREADABLE_OR_INVALID_JSON");
  }
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "schema"))];
    throw new Error(`QUALITZER_BRAND_FILE_INVALID: ${fields.join(", ")}`);
  }
  return parsed.data;
}

function resolveBrandIcon(projectRoot: string, value: string, genericPath: string): string {
  const path = value.replace(/^\.\//, "");
  const brandedPath = /^assets\/branding\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.png$/;
  if (path !== genericPath && !brandedPath.test(path)) {
    throw new Error("BRANDING_ICON_MUST_BE_PNG_INSIDE_ASSETS_BRANDING_OR_GENERIC_ICON");
  }
  try {
    const expected = resolve(realpathSync(projectRoot), path);
    const actual = realpathSync(expected);
    if (relative(expected, actual) !== "" || !statSync(actual).isFile()) throw new Error();
  } catch {
    throw new Error("BRANDING_ICON_MISSING_OR_UNSAFE_PATH");
  }
  return `./${path}`;
}

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  requireBaseConfig(config);
  const standaloneFlag = process.env.EXPO_PUBLIC_STANDALONE;
  if (standaloneFlag !== undefined && !["true", "false"].includes(standaloneFlag)) throw new Error("EXPO_PUBLIC_STANDALONE_MUST_BE_BOOLEAN_STRING");
  const releaseProfile = ["standalone-apk", "preview", "production"].includes(process.env.EAS_BUILD_PROFILE ?? "");
  if (releaseProfile && standaloneFlag !== "true") throw new Error("STANDALONE_BUILD_REQUIRES_EXPO_PUBLIC_STANDALONE_TRUE");
  const standalone = standaloneFlag === "true";
  const gatewayUrl = standalone ? standaloneGatewayUrl(process.env.EXPO_PUBLIC_GATEWAY_URL ?? "") : process.env.EXPO_PUBLIC_GATEWAY_URL;
  config = {
    ...config,
    extra: { ...config.extra, gateway: { standalone, url: gatewayUrl } },
    ...(standalone ? { updates: { ...config.updates, enabled: false, useEmbeddedUpdate: true } } : {}),
  };
  const projectId = process.env.EXPO_PROJECT_ID;
  if (projectId !== undefined) {
    const parsed = z.uuid().safeParse(projectId);
    if (!parsed.success) throw new Error("EXPO_PROJECT_ID_MUST_BE_UUID");
    config = { ...config, extra: { ...config.extra, eas: { ...config.extra?.eas, projectId: parsed.data } } };
  }
  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE;
  if (googleServicesFile) {
    const filename = isAbsolute(googleServicesFile) ? googleServicesFile : resolve(projectRoot, googleServicesFile);
    if (!statSync(filename).isFile()) throw new Error("GOOGLE_SERVICES_FILE_NOT_FOUND");
    config = { ...config, android: { ...config.android, googleServicesFile: filename } };
  }
  requireBaseConfig(config);
  const brandFile = process.env.QUALITZER_BRAND_FILE;
  if (brandFile === undefined) return config;

  const brand = readBrand(projectRoot, brandFile);
  const icon = resolveBrandIcon(projectRoot, brand.iconPath, "assets/field-icon.png");
  const adaptiveIcon = brand.adaptiveIconPath === undefined
    ? icon
    : resolveBrandIcon(projectRoot, brand.adaptiveIconPath, "assets/field-adaptive.png");
  const tenantSlug = brand.tenantId.replace(/[_-]+/g, "-").replace(/-+$/, "");

  return {
    ...config,
    name: brand.name,
    slug: `qualitzer-field-${tenantSlug}`,
    icon,
    ios: { ...config.ios, bundleIdentifier: brand.iosBundleIdentifier, icon },
    android: {
      ...config.android,
      package: brand.androidPackage,
      icon,
      adaptiveIcon: { foregroundImage: adaptiveIcon, backgroundColor: "#FFFFFF" },
    },
    extra: { ...config.extra, distributionTenantId: brand.tenantId },
  };
};