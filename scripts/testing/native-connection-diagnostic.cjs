const origin = "http://127.0.0.1:8081";

if (!process.argv.includes("--connected-phone")) throw new Error("Use --connected-phone with the Expo development device connected.");

const expression = `(async () => {
  const requireModule = globalThis.__r;
  if (typeof requireModule !== "function" || !requireModule.getModules) return { available: false };
  const modules = Array.from(requireModule.getModules().entries());
  const constantsEntry = modules.find(([id, module]) => /expo-constants.*Constants\\.(?:js|ts)$/.test(module.verboseName || "") && module.isInitialized);
  const storageEntry = modules.find(([id, module]) => /infrastructure.*sessionStorage\\.ts$/.test(module.verboseName || "") && module.isInitialized);
  const constants = constantsEntry ? requireModule(constantsEntry[0]).default : null;
  const storedValue = storageEntry ? await requireModule(storageEntry[0]).loadGateway() : null;
  let storedGateway = null;
  try {
    if (storedValue) {
      const url = new URL(storedValue);
      storedGateway = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : 'INVALID_STORED_GATEWAY';
    }
  } catch { storedGateway = 'INVALID_STORED_GATEWAY'; }
  const hostUri = constants?.expoConfig?.hostUri;
  const host = hostUri ? new URL('http://' + hostUri).hostname : null;
  const privateHost = host && (/^192\\.168\\.\\d{1,3}\\.\\d{1,3}$/.test(host) || /^10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$/.test(host) || /^172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}$/.test(host));
  let probe = null;
  if (privateHost) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('http://' + host + ':8787/health', { credentials: 'omit', signal: controller.signal });
      const data = await response.json();
      probe = { status: response.status, ok: data.ok === true, backendReachable: data.backendReachable === true };
    } catch (error) { probe = { error: String(error.message).slice(0, 240) }; }
    finally { clearTimeout(timer); }
  }
  return { available: true, hostUri, storedGateway, probe,
    modules: modules.filter(([id, module]) => /sessionStorage|expo-constants|infrastructure.photos|useTechnicianApp/.test(module.verboseName || ""))
      .map(([id, module]) => ({ id, name: module.verboseName, loaded: module.isInitialized })) };
})()`;

async function inspect(target) {
  const address = new URL(target.webSocketDebuggerUrl);
  if (address.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(address.hostname) || address.port !== "8081") throw new Error("Unexpected inspector address");
  return new Promise((resolve) => {
    const socket = new WebSocket(address);
    let finished = false;
    const complete = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    const timer = setTimeout(() => complete({ error: "DIAGNOSTIC_TIMEOUT" }), 12000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } })));
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(event.data);
      if (response.id === 1) complete(response.error ? { error: response.error.message } : response.result?.exceptionDetails ? { error: response.result.exceptionDetails.text } : response.result?.result?.value);
    });
    socket.addEventListener("error", () => complete({ error: "INSPECTOR_CONNECTION_FAILED" }));
  });
}

async function main() {
  const response = await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(5000) });
  const targets = await response.json();
  if (!targets.some((target) => target.appId === "host.exp.exponent")) console.log("NO_CONNECTED_EXPO_PHONE");
  for (const target of targets) {
    if (target.appId !== "host.exp.exponent") continue;
    console.log(JSON.stringify({ target: target.id, diagnostic: await inspect(target) }));
  }
}

main().catch((error) => { console.error(error.name, error.message); process.exitCode = 1; });