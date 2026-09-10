"use strict";

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createRequire } = require("node:module");

const operationId = "3ab9443d-053c-4e4d-9633-fffa1b00fc57";
const clientRequestId = "94ff88bb-f916-4755-a7d9-a76614509792";
const portalOrigin = "http://localhost:3000";
const mobileRoot = resolve(__dirname, "../..");
const backendRoot = resolve(mobileRoot, "../Qualitzer2.0-Backend");
const backendRequire = createRequire(resolve(backendRoot, "package.json"));
const connections = [];

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function localEnvironment(root) {
  const dotenv = backendRequire("dotenv");
  return dotenv.parse(readFileSync(resolve(root, ".env")));
}

function positiveId(value) {
  if (value === null || value === undefined || value === "null") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : "INVALID_ID_REDACTED";
}

function enumValue(value, allowed) {
  if (value === null || value === undefined || value === "null") return null;
  return allowed.includes(value) ? value : "UNEXPECTED_VALUE_REDACTED";
}

function groupId(value) {
  if (value === null || value === undefined || value === "null") return null;
  return typeof value === "string" && /^(?:direct(?:-np)?|maintenance|external)-[1-9]\d{0,14}$/.test(value)
    ? value : "INVALID_GROUP_REDACTED";
}

function timestamp(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
    ? value : "INVALID_TIMESTAMP_REDACTED";
}

function errorCode(value) {
  if (value === null || value === undefined || value === "null") return null;
  return typeof value === "string" && /^(?:MOBILE_SYNC|MOBILE_CREATION|OFFLINE)_[A-Z0-9_]{1,100}$/.test(value)
    ? value : "ERROR_REDACTED";
}

async function select(connection, sql, values) {
  requireCondition(/^SELECT\s/i.test(sql.trim()) && !sql.includes(";"), "SELECT_ONLY_GUARD");
  const [rows] = await connection.query({ sql, values, timeout: 10000 });
  return rows;
}

async function connect(mysql, options) {
  const connection = await mysql.createConnection(options);
  connections.push(connection);
  requireCondition(connection.connection.stream.remoteAddress === "127.0.0.1", "DB_SOCKET_NOT_LOCAL");
  return connection;
}

async function lookup(connection, sql, id, project) {
  try {
    const rows = await select(connection, sql, [id]);
    return {
      status: rows.length === 0 ? "absent" : "present",
      exactUuidMatchesReturned: rows.length,
      uniqueMatch: rows.length === 1,
      additionalMatchesPossible: rows.length === 2,
      rows: rows.map(project),
    };
  } catch (error) {
    return {
      status: "unverified",
      error: enumValue(error?.code, ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "PROTOCOL_SEQUENCE_TIMEOUT"])
        ?? "LOOKUP_FAILED_REDACTED",
    };
  }
}

async function diagnose() {
  requireCondition(process.argv.length === 4 && process.argv[2] === "--read-only-operation" && process.argv[3] === operationId,
    "EXACT_OPERATION_FLAG_REQUIRED");
  const backendEnv = localEnvironment(backendRoot);
  const mobileEnv = localEnvironment(mobileRoot);
  requireCondition(backendEnv.USE_ENV === "development", "LOCAL_ENV_NOT_VERIFIED");
  requireCondition(["localhost", "127.0.0.1"].includes(backendEnv.DB_HOST), "DB_HOST_NOT_LOOPBACK");
  requireCondition(backendEnv.DB_DIALECT === "mysql", "MYSQL_CONFIG_REQUIRED");
  requireCondition(Boolean(backendEnv.DB_DATABASE) && Boolean(backendEnv.DB_USERNAME), "DB_CONFIG_INCOMPLETE");
  const port = Number(backendEnv.DB_PORT ?? 3306);
  requireCondition(Number.isInteger(port) && port > 0 && port <= 65535, "DB_PORT_INVALID");
  const backendUrl = new URL(mobileEnv.BACKEND_URL);
  requireCondition(backendUrl.protocol === "http:" && ["127.0.0.1", "localhost"].includes(backendUrl.hostname)
    && backendUrl.port === "5001" && /^\/api\/?$/.test(backendUrl.pathname)
    && !backendUrl.username && !backendUrl.password && !backendUrl.search && !backendUrl.hash, "LOCAL_BACKEND_NOT_VERIFIED");
  const configUrl = "http://127.0.0.1:5001/api/auth/mobile/config";
  const response = await fetch(configUrl, {
    method: "GET", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  requireCondition(response.status === 200, "BACKEND_CONFIG_UNAVAILABLE");
  const catalog = await response.json();
  requireCondition(catalog.version === 1 && Array.isArray(catalog.tenants), "BACKEND_CATALOG_INVALID");
  const candidates = catalog.tenants.filter((tenant) => tenant.portalOrigin === portalOrigin);
  requireCondition(candidates.length === 1, "TENANT_ORIGIN_NOT_VERIFIED");
  const tenant = candidates[0];
  requireCondition(tenant.name === "jaras" && tenant.environment === "development" && /^tenant-[1-9]\d*$/.test(tenant.id),
    "TENANT_METADATA_MISMATCH");

  const mysql = backendRequire("mysql2/promise");
  const options = {
    host: "127.0.0.1", port, user: backendEnv.DB_USERNAME, password: backendEnv.DB_PASSWORD,
    database: backendEnv.DB_DATABASE, connectTimeout: 5000, multipleStatements: false,
    dateStrings: true, timezone: "Z", debug: false, trace: false,
  };
  const master = await connect(mysql, options);
  const tenants = await select(master,
    "SELECT id, name, hostname, databaseName FROM tenants WHERE hostname = ? AND id = ? AND status = 1 LIMIT 2",
    [portalOrigin, Number(tenant.id.slice(7))]);
  requireCondition(tenants.length === 1 && tenants[0].name === tenant.name && tenants[0].hostname === portalOrigin
    && typeof tenants[0].databaseName === "string" && tenants[0].databaseName.length > 0, "MASTER_MAPPING_NOT_VERIFIED");
  const database = await connect(mysql, { ...options, database: tenants[0].databaseName });
  const receipt = await lookup(database, `SELECT kind, state, userId, companyBranchId,
    JSON_UNQUOTE(JSON_EXTRACT(response, '$.state')) AS resultState,
    JSON_UNQUOTE(JSON_EXTRACT(response, '$.fileId')) AS fileId,
    JSON_UNQUOTE(JSON_EXTRACT(response, '$.error')) AS error,
    createdAt, updatedAt, leaseExpiresAt
    FROM mobile_sync_receipts WHERE operationId = ? LIMIT 2`, operationId, (row) => ({
    kind: enumValue(row.kind, ["document", "comment", "answer"]),
    state: enumValue(row.state, ["applying", "applied", "conflict", "rejected", "needs_review"]),
    userId: positiveId(row.userId), companyBranchId: positiveId(row.companyBranchId),
    resultState: enumValue(row.resultState, ["in_progress", "applied", "conflict", "rejected", "needs_review"]),
    fileId: positiveId(row.fileId), error: errorCode(row.error),
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt), leaseExpiresAt: timestamp(row.leaseExpiresAt),
  }));
  const parent = await lookup(database, `SELECT kind, userId, companyBranchId, workId, maintenanceId, maintenanceWorkId,
    JSON_UNQUOTE(JSON_EXTRACT(response, '$.kind')) AS resultKind,
    JSON_UNQUOTE(JSON_EXTRACT(response, '$.groupId')) AS resultGroupId,
    JSON_UNQUOTE(JSON_EXTRACT(response, '$.workId')) AS resultWorkId,
    JSON_UNQUOTE(JSON_EXTRACT(response, '$.companyBranchId')) AS resultBranchId,
    createdAt, updatedAt
    FROM mobile_creation_requests WHERE clientRequestId = ? LIMIT 2`, clientRequestId, (row) => ({
    kind: enumValue(row.kind, ["work", "maintenance", "non_productive"]),
    userId: positiveId(row.userId), companyBranchId: positiveId(row.companyBranchId),
    workId: positiveId(row.workId), maintenanceId: positiveId(row.maintenanceId), maintenanceWorkId: positiveId(row.maintenanceWorkId),
    result: {
      kind: enumValue(row.resultKind, ["work", "maintenance", "non_productive"]),
      groupId: groupId(row.resultGroupId), workId: positiveId(row.resultWorkId), companyBranchId: positiveId(row.resultBranchId),
    },
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt),
  }));
  return {
    checkedAt: new Date().toISOString(), operationId, clientRequestId, expectedBranchId: 1,
    localOriginVerified: true,
    verification: { configUrl, tenantId: tenant.id, masterName: "jaras", portalOrigin, environment: "development",
      masterMappingMatches: true, masterAndTenantSocketsLoopback: true, branding: "not_queried" },
    receipt, parent,
    documentScope: "not_stored_in_receipt_and_phone_not_inspected",
    sqlPolicy: "SELECT_ONLY_EXACT_IDS_NO_PAYLOAD_NO_APP_IMPORTS",
  };
}

async function main() {
  let report;
  try {
    report = await diagnose();
  } catch (error) {
    report = { status: "unverified", error: enumValue(error?.message, [
      "EXACT_OPERATION_FLAG_REQUIRED", "LOCAL_ENV_NOT_VERIFIED", "DB_HOST_NOT_LOOPBACK", "MYSQL_CONFIG_REQUIRED",
      "DB_CONFIG_INCOMPLETE", "DB_PORT_INVALID", "LOCAL_BACKEND_NOT_VERIFIED", "BACKEND_CONFIG_UNAVAILABLE",
      "BACKEND_CATALOG_INVALID", "TENANT_ORIGIN_NOT_VERIFIED", "TENANT_METADATA_MISMATCH",
      "DB_SOCKET_NOT_LOCAL", "MASTER_MAPPING_NOT_VERIFIED", "SELECT_ONLY_GUARD",
    ]) ?? "DIAGNOSTIC_FAILED_REDACTED" };
    process.exitCode = 1;
  } finally {
    for (const connection of connections.reverse()) {
      try { await connection.end(); }
      catch { connection.destroy(); }
    }
  }
  process.stdout.write(`${JSON.stringify({ ...report, connectionsClosed: true }, null, 2)}\n`);
}

main().catch(() => {
  process.stderr.write("DIAGNOSTIC_FAILED_REDACTED\n");
  process.exitCode = 1;
});