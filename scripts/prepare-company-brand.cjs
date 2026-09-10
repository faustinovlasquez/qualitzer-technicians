const { createHash, randomUUID } = require("node:crypto");
const { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } = require("node:fs");
const { extname, relative, resolve } = require("node:path");
const { parseArgs } = require("node:util");
const { z } = require("zod");

const root = realpathSync(resolve(__dirname, ".."));
const maxJsonBytes = 1024 * 1024;
const maxLogoBytes = 1024 * 1024;
const maxImagePixels = 16 * 1024 * 1024;
const tenantIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/);
const displayNameSchema = z.string().trim().min(1).max(120).refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const httpUrlSchema = z.string().refine((value) => {
  if (!/^https?:\/\//i.test(value) || /[\s\u0000-\u001f\u007f\\?#*]/.test(value) || /^https?:\/\/[^/]*@/i.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
});
const tenantsSchema = z.array(z.object({
  id: tenantIdSchema,
  name: displayNameSchema,
  tenantOrigin: httpUrlSchema.refine((value) => {
    try { return new URL(value).origin === value; } catch { return false; }
  }),
  backendUrl: httpUrlSchema,
  environment: z.enum(["development", "production"]),
  enabled: z.boolean(),
}).strict()).superRefine((tenants, context) => {
  const ids = new Set();
  const routes = new Set();
  for (const tenant of tenants) {
    const route = JSON.stringify([new URL(tenant.backendUrl).href.replace(/\/+$/, ""), tenant.tenantOrigin]);
    if (ids.has(tenant.id) || routes.has(route)) context.addIssue({ code: "custom", message: "DUPLICATE_TENANT_ID_OR_ROUTE" });
    if (tenant.environment === "production" &&
        (!tenant.backendUrl.startsWith("https://") || !tenant.tenantOrigin.startsWith("https://"))) {
      context.addIssue({ code: "custom", message: "PRODUCTION_TENANT_REQUIRES_HTTPS" });
    }
    ids.add(tenant.id);
    routes.add(route);
  }
});
const brandingSchema = z.object({ name: displayNameSchema, logo: z.unknown().optional() });

function readLimitedFile(file, limit, errorKey) {
  const info = statSync(file);
  if (!info.isFile() || info.size > limit) throw new Error(errorKey);
  const bytes = readFileSync(file);
  if (bytes.length > limit) throw new Error(errorKey);
  return bytes;
}

function selectTenant(id) {
  if (!tenantIdSchema.safeParse(id).success || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) {
    throw new Error("BRANDING_TENANT_ID_INVALID");
  }
  let tenants;
  try {
    const input = JSON.parse(readLimitedFile(resolve(root, "config/tenants.json"), maxJsonBytes, "TENANT_ALLOWLIST_TOO_LARGE").toString("utf8"));
    tenants = tenantsSchema.parse(input);
  } catch { throw new Error("TENANT_ALLOWLIST_UNREADABLE_OR_INVALID"); }
  const tenant = tenants.find((entry) => entry.id === id && entry.enabled);
  if (!tenant) throw new Error("BRANDING_TENANT_NOT_ALLOWLISTED_OR_DISABLED");
  return tenant;
}

async function readResponseJson(response) {
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!mime || !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mime)) throw new Error("BRANDING_RESPONSE_NOT_JSON");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxJsonBytes)) {
    throw new Error("BRANDING_JSON_TOO_LARGE");
  }
  if (!response.body) throw new Error("BRANDING_RESPONSE_EMPTY");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxJsonBytes) throw new Error("BRANDING_JSON_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))); }
  catch { throw new Error("BRANDING_JSON_INVALID"); }
}

async function fetchBranding(tenant) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const endpoint = `${tenant.backendUrl.replace(/\/+$/, "")}/companies/branding`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json", Origin: tenant.tenantOrigin },
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) throw new Error("BRANDING_REDIRECT_REFUSED");
    if (response.status !== 200) throw new Error(`BRANDING_HTTP_${response.status}`);
    const parsed = brandingSchema.safeParse(await readResponseJson(response));
    if (!parsed.success) throw new Error("BRANDING_RESPONSE_INVALID_NAME");
    return parsed.data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("BRANDING_REQUEST_TIMEOUT_20_SECONDS");
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("BRANDING_LOGO_REQUIRES_PNG_JPEG_WEBP_SVG_REFUSED");
}

function readLocalLogo(file) {
  if (!file || /[\u0000-\u001f\u007f]/.test(file) || /^(?:[a-z][a-z\d+.-]*:\/\/|file:|data:|[\\/]{2})/i.test(file)) {
    throw new Error("BRANDING_LOGO_MUST_BE_EXPLICIT_LOCAL_FILE");
  }
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(file).toLowerCase()];
  if (!mime) throw new Error("BRANDING_LOGO_REQUIRES_PNG_JPEG_WEBP_SVG_REFUSED");
  const bytes = readLimitedFile(resolve(process.cwd(), file), maxLogoBytes, "BRANDING_LOGO_TOO_LARGE");
  if (imageMime(bytes) !== mime) throw new Error("BRANDING_LOGO_MIME_MISMATCH");
  return bytes;
}

function readEmbeddedLogo(logo) {
  if (logo === undefined || logo === null || logo === "") {
    console.warn("BRANDING_LOGO_MISSING: se conserva el icono genérico de Qualitzer Field; no se ha generado un logo de empresa.");
    return undefined;
  }
  if (typeof logo !== "string") throw new Error("BRANDING_LOGO_INVALID");
  if (/^https?:\/\//i.test(logo)) {
    console.warn("BRANDING_REMOTE_LOGO_NOT_DOWNLOADED: se conserva el icono genérico. Use --logo con un archivo local revisado por el administrador.");
    return undefined;
  }
  if (logo.length > 4 * Math.ceil(maxLogoBytes / 3) + 32) throw new Error("BRANDING_LOGO_TOO_LARGE");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(logo);
  if (!match) throw new Error("BRANDING_LOGO_REQUIRES_BASE64_PNG_JPEG_WEBP_SVG_REFUSED");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > maxLogoBytes) throw new Error("BRANDING_LOGO_TOO_LARGE");
  if (bytes.toString("base64") !== match[2]) throw new Error("BRANDING_LOGO_BASE64_INVALID");
  if (imageMime(bytes) !== match[1]) throw new Error("BRANDING_LOGO_MIME_MISMATCH");
  return bytes;
}

async function generateIcons(bytes) {
  const sharp = require("sharp");
  const format = imageMime(bytes).slice("image/".length);
  try {
    const image = sharp(bytes, { limitInputPixels: maxImagePixels, failOn: "warning" }).timeout({ seconds: 20 });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Error();
    const decoded = await image.rotate().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const input = { raw: { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels } };
    const icon = await sharp(decoded.data, input)
      .resize(1024, 1024, { fit: "contain", background: "#FFFFFF" })
      .flatten({ background: "#FFFFFF" }).png().toBuffer();
    const adaptive = await sharp(decoded.data, input)
      .resize(640, 640, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extend({ top: 192, bottom: 192, left: 192, right: 192, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    return { icon, adaptive };
  } catch { throw new Error("BRANDING_LOGO_DECODE_FAILED_OR_ANIMATED_OR_TOO_MANY_PIXELS"); }
}

function outputDirectory(...segments) {
  let directory = root;
  for (const segment of segments) {
    directory = resolve(directory, segment);
    let info;
    try { info = lstatSync(directory); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      mkdirSync(directory);
      info = lstatSync(directory);
    }
    if (!info.isDirectory() || info.isSymbolicLink() || relative(directory, realpathSync(directory)) !== "") {
      throw new Error("BRANDING_OUTPUT_DIRECTORY_UNSAFE");
    }
  }
  return directory;
}

function writeGeneratedFile(file, bytes) {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("BRANDING_OUTPUT_FILE_UNSAFE");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function applicationIdentifier(id) {
  const label = `t${id.replace(/[^a-z0-9]/g, "").slice(0, 40)}${createHash("sha256").update(id).digest("hex").slice(0, 12)}`;
  return `com.qualitzer.field.${label}`;
}

async function main() {
  const { values } = parseArgs({
    options: { tenant: { type: "string" }, logo: { type: "string" }, help: { type: "boolean", short: "h" } },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log("Uso: node scripts/prepare-company-brand.cjs --tenant <id habilitado en config/tenants.json> [--logo <archivo local PNG/JPEG/WebP>]");
    console.log("Consulta sólo GET /companies/branding con el Origin configurado, sin credenciales. No sigue redirecciones ni descarga logos por URL.");
    console.log("Genera configuración e iconos locales para un build posterior. No compila, firma, sube ni instala aplicaciones.");
    return;
  }
  if (!values.tenant) throw new Error("BRANDING_TENANT_REQUIRED: use --tenant <id> o --help");
  const tenant = selectTenant(values.tenant);
  const localLogo = values.logo === undefined ? undefined : readLocalLogo(values.logo);
  const branding = await fetchBranding(tenant);
  const logo = localLogo ?? readEmbeddedLogo(branding.logo);
  const identifier = applicationIdentifier(tenant.id);
  const brand = {
    tenantId: tenant.id,
    name: branding.name,
    androidPackage: identifier,
    iosBundleIdentifier: identifier,
    iconPath: "./assets/field-icon.png",
    adaptiveIconPath: "./assets/field-adaptive.png",
  };
  if (logo !== undefined) {
    const icons = await generateIcons(logo);
    const directory = outputDirectory("assets", "branding", tenant.id);
    writeGeneratedFile(resolve(directory, "icon.png"), icons.icon);
    writeGeneratedFile(resolve(directory, "adaptive.png"), icons.adaptive);
    brand.iconPath = `./assets/branding/${tenant.id}/icon.png`;
    brand.adaptiveIconPath = `./assets/branding/${tenant.id}/adaptive.png`;
  } else {
    for (const path of [brand.iconPath, brand.adaptiveIconPath]) {
      const expected = resolve(root, path);
      if (relative(expected, realpathSync(expected)) !== "" || !statSync(expected).isFile()) {
        throw new Error("BRANDING_GENERIC_ICON_MISSING_OR_UNSAFE");
      }
    }
  }
  const directory = outputDirectory("config");
  const filename = `build-brand.${tenant.id}.json`;
  writeGeneratedFile(resolve(directory, filename), `${JSON.stringify(brand, null, 2)}\n`);
  console.log(`Configuración preparada: config/${filename}`);
  console.log(`Nombre del próximo build: ${brand.name}. Identificador: ${identifier}`);
  console.log(`Seleccione QUALITZER_BRAND_FILE=config/${filename} al resolver la configuración y construir la app.`);
  console.log("Esto no modifica ninguna app instalada ni el login multiempresa. El nombre y el icono nativos quedan fijados en cada build.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "BRANDING_PREPARATION_FAILED");
  process.exitCode = 1;
});