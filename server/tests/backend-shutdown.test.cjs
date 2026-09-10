const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork, spawnSync } = require("node:child_process");
const { EventEmitter, once } = require("node:events");
const { get } = require("node:http");
const { connect } = require("node:net");
const { test } = require("node:test");
const { backend, loadShutdown } = require("./backend-shutdown-source.cjs");

function fixture() {
  const events = [];
  const signals = new EventEmitter();
  const server = new EventEmitter();
  let drain;
  let deadline;
  server.close = (callback) => { events.push("close"); drain = callback; };
  server.closeIdleConnections = () => events.push("idle");
  const runtime = {
    onSignal: (signal, listener) => signals.on(signal, listener),
    exit: (code) => events.push(`exit:${code}`),
    schedule: (callback, milliseconds) => {
      assert.equal(milliseconds, 30000);
      events.push("timer");
      deadline = callback;
      return () => events.push("cancel");
    },
  };
  return { events, signals, server, runtime, drain: (error) => drain(error), timeout: () => deadline() };
}

test("disabled host adds no signal, socket or timer hooks; registration after server creation is explicit", () => {
  const f = fixture();
  loadShutdown()(f.server, false, f.runtime);
  assert.deepEqual(f.signals.eventNames(), []);
  assert.deepEqual(f.server.eventNames(), []);
  assert.deepEqual(f.events, []);
  const app = fs.readFileSync(path.join(backend, "src/app.ts"), "utf8");
  assert.ok(app.indexOf("registerMobileGatewayShutdown(server,") > app.indexOf("const server = http.createServer(app)"));
  assert.match(app, /registerMobileGatewayShutdown\(server, await environment.getSecretValue\("MOBILE_GATEWAY_ENABLED"\) === "true"\)/);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`${signal} drains once, preserves other handlers, closes idle/upgraded sockets and exits only after drain`, () => {
    const f = fixture();
    let previous = 0;
    f.signals.on(signal, () => previous++);
    const register = loadShutdown();
    register(f.server, true, f.runtime);
    register(f.server, true, f.runtime);
    const socket = new EventEmitter();
    socket.destroy = () => f.events.push("socket");
    f.server.emit("upgrade", {}, socket);
    f.signals.emit(signal);
    assert.equal(previous, 1);
    assert.deepEqual(f.events, ["timer", "close", "idle", "socket"]);
    f.signals.emit("SIGINT");
    f.signals.emit("SIGTERM");
    assert.equal(f.events.filter((event) => event === "close").length, 1);
    const late = new EventEmitter();
    late.destroy = () => f.events.push("late-socket");
    f.server.emit("upgrade", {}, late);
    assert.equal(f.events.at(-1), "late-socket");
    f.drain();
    assert.deepEqual(f.events.slice(-2), ["cancel", "exit:0"]);
    f.timeout();
    assert.equal(f.events.filter((event) => event.startsWith("exit:")).length, 1);
  });
}

test("closed upgraded sockets are untracked; timeout exits 1 without accepting a late successful drain", () => {
  const f = fixture();
  loadShutdown()(f.server, true, f.runtime);
  const socket = new EventEmitter();
  socket.destroy = () => assert.fail("Already closed socket must be untracked");
  f.server.emit("upgrade", {}, socket);
  socket.emit("close");
  f.signals.emit("SIGTERM");
  f.timeout();
  f.drain();
  assert.deepEqual(f.events, ["timer", "close", "idle", "cancel", "exit:1"]);
});

test("close errors and thrown shutdown failures exit 1", () => {
  for (const throws of [false, true]) {
    const f = fixture();
    if (throws) f.server.close = () => { throw new Error("fixture"); };
    loadShutdown()(f.server, true, f.runtime);
    f.signals.emit("SIGINT");
    if (!throws) f.drain(new Error("fixture"));
    assert.deepEqual(f.events.slice(-2), ["cancel", "exit:1"]);
  }
});

function waitForMessage(child, event) {
  return new Promise((resolve, reject) => {
    const message = (value) => {
      if (value.event !== event) return;
      cleanup();
      resolve(value);
    };
    const exit = (code, signal) => { cleanup(); reject(new Error(`Child exited before ${event}: ${code}/${signal}`)); };
    const cleanup = () => { child.off("message", message); child.off("exit", exit); };
    child.on("message", message);
    child.on("exit", exit);
  });
}

async function lifecycle(t, signal, actualSignal, forced = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qzm-host-shutdown-"));
  const options = { backendUrl: "https://backend.invalid/api", sessionFile: path.join(directory, "private/sessions.enc"), trustedProxyIps: ["127.0.0.1"] };
  const child = fork(path.join(__dirname, "backend-shutdown-worker.cjs"), [JSON.stringify(options), forced ? "force" : "drain"], { silent: true });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const ready = await waitForMessage(child, "ready");
  const keyFile = path.join(directory, "private/session.key");
  const lockFile = path.join(directory, "private/.writer.lock");
  const key = fs.readFileSync(keyFile);
  const sessions = fs.readFileSync(options.sessionFile);
  const upgraded = connect(ready.port, "127.0.0.1");
  t.after(() => upgraded.destroy());
  const upgradedClosed = once(upgraded, "close");
  upgraded.write("GET /socket HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  assert.match(String((await once(upgraded, "data"))[0]), /101 Switching Protocols/);
  const holding = waitForMessage(child, "holding");
  const request = get(`http://127.0.0.1:${ready.port}/hold`);
  const response = new Promise((resolve) => {
    request.on("response", (res) => { res.resume(); res.on("end", () => resolve("drained")); });
    request.on("error", () => resolve("disconnected"));
  });
  t.after(() => request.destroy());
  await holding;
  const draining = waitForMessage(child, "draining");
  if (actualSignal) assert.equal(child.kill(signal), true);
  else child.send({ signal });
  assert.equal((await draining).listening, false);
  await upgradedClosed;
  const refused = await new Promise((resolve) => {
    const connection = connect(ready.port, "127.0.0.1");
    connection.on("error", (error) => resolve(error.code));
    connection.on("connect", () => { connection.destroy(); resolve("accepted"); });
  });
  assert.equal(refused, "ECONNREFUSED");
  assert.ok(fs.existsSync(lockFile), "Writer must remain locked while old requests drain");
  const probe = (action, token) => spawnSync(process.execPath, [path.join(__dirname, "embedded-worker.cjs"), path.join(backend, "node_modules/@qualitzer/mobile-gateway"), JSON.stringify(options), action, ...(token ? [token] : [])], { encoding: "utf8", timeout: 30000, windowsHide: true });
  const competing = probe("probe");
  assert.equal(competing.status, 1, competing.stderr);
  assert.equal(JSON.parse(competing.stdout).error, "SESSION_PERSISTENCE_WRITER_EXISTS");
  assert.deepEqual(fs.readFileSync(keyFile), key);
  assert.deepEqual(fs.readFileSync(options.sessionFile), sessions);
  child.send({ action: forced ? "timeout" : "release" });
  assert.deepEqual(await exited, [forced ? 1 : 0, null], stderr);
  assert.equal(await response, forced ? "disconnected" : "drained");
  assert.equal(stderr, "");
  assert.equal(fs.existsSync(lockFile), false, "process.exit must trigger the unchanged package exit cleanup");
  assert.deepEqual(fs.readFileSync(keyFile), key);
  assert.deepEqual(fs.readFileSync(options.sessionFile), sessions);
  const restart = probe("me", ready.token);
  assert.equal(restart.status, 0, restart.stderr);
  assert.equal(JSON.parse(restart.stdout).status, 200, "Restart must accept the persisted session");
  assert.deepEqual(fs.readFileSync(keyFile), key);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`child IPC ${signal}: real installed storage keeps lock during drain, releases it on exit and restores session`, { timeout: 60000 }, (t) => lifecycle(t, signal, false));
  test(`POSIX child actual ${signal}: drain and persistent session survive restart`, { skip: process.platform === "win32" ? "Windows kill is abrupt OS termination, not POSIX signal delivery" : false, timeout: 60000 }, (t) => lifecycle(t, signal, true));
}

test("child forced deadline exits 1, releases only lock and preserves key plus persisted session", { timeout: 60000 }, (t) => lifecycle(t, "SIGTERM", false, true));