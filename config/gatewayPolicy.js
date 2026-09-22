function privateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (/^(fc|fd)[\da-f]{2}:/i.test(host) || /^fe[89ab][\da-f]:/i.test(host)) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31);
}

function loopbackHost(hostname) {
  return hostname === "localhost" || hostname === "localhost." || hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function canonicalGatewayUrl(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\\?#%]/.test(value)) throw new Error("GATEWAY_URL_INVALID");
  const input = value.trim();
  const match = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(input);
  if (!match || /\s|@/.test(input)) throw new Error("GATEWAY_URL_INVALID");
  const path = (match[2] ?? "").replace(/\/$/, "");
  if (path && (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path) || path.split("/").some((part) => part === "." || part === ".."))) throw new Error("GATEWAY_URL_INVALID");
  const url = new URL(input);
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw new Error("GATEWAY_URL_INVALID");
  if (url.protocol === "http:" && !loopbackHost(url.hostname) && !privateHost(url.hostname)) throw new Error("GATEWAY_PUBLIC_HTTPS_REQUIRED");
  return `${url.origin}${path}`;
}

function standaloneGatewayUrl(value) {
  if (typeof value !== "string" || value.trim() !== value) throw new Error("STANDALONE_GATEWAY_PUBLIC_HTTPS_REQUIRED");
  const base = canonicalGatewayUrl(value);
  const url = new URL(base);
  const hostname = url.hostname;
  const labels = hostname.split(".");
  if (url.protocol !== "https:" || labels.length < 2 || hostname.length > 253 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
      !/^[a-z]{2,63}$/i.test(labels[labels.length - 1]) ||
      /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|test|invalid|onion)$|\.home\.arpa$/i.test(hostname) ||
      privateHost(hostname) || loopbackHost(hostname)) throw new Error("STANDALONE_GATEWAY_PUBLIC_HTTPS_REQUIRED");
  return base;
}

module.exports = { canonicalGatewayUrl, standaloneGatewayUrl, privateHost, loopbackHost };