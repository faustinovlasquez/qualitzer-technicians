"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, createPrivateKey } = require("node:crypto");
const root = path.resolve(__dirname, "../..");
const projectId = "be200e44-9d60-4881-9050-1c67afaeb650";
const projectName = "qualitzer-tecnicos";
const accountName = "fv24715s-team";
const firebaseProject = "qualitzer-7612f";
const applicationIdentifier = "com.qualitzer.field";
const [mode, cliRoot, keyPath] = process.argv.slice(2);
const output = path.join(root, "artifacts/logs/expo-fcm-setup");
const report = { at: new Date().toISOString(), mode, projectId, firebaseProject, applicationIdentifier, keyUploaded: false, fcmAssigned: false, signingCredentialsChanged: false, deliveryTested: false };
let phase = "INPUT";

function requireCondition(condition, code) { if (!condition) throw new Error(code); }
function fingerprint(value) { return createHash("sha256").update(value).digest("hex"); }
function signingReferences(credentials) {
  return (credentials?.androidAppBuildCredentialsList ?? []).map(item => ({ id: item.id, keystoreId: item.androidKeystore?.id ?? null })).sort((a, b) => a.id.localeCompare(b.id));
}
function credentialMatches(credential, key) {
  return credential?.projectIdentifier === firebaseProject && credential.privateKeyIdentifier === key.private_key_id && credential.clientEmail === key.client_email;
}

async function main() {
  requireCondition(["plan", "apply"].includes(mode) && path.isAbsolute(cliRoot ?? "") && path.isAbsolute(keyPath ?? ""), "INVALID_ARGUMENTS");
  requireCondition(path.basename(cliRoot) === "eas-cli", "OFFICIAL_CLI_REQUIRED");
  const cliPackage = JSON.parse(fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"));
  requireCondition(cliPackage.name === "eas-cli", "OFFICIAL_CLI_REQUIRED");
  report.cliVersion = cliPackage.version;
  for (const name of ["EXPO_LOCAL", "EXPO_STAGING", "DEBUG", "EXPO_DEBUG", "EXPO_TOKEN"]) delete process.env[name];
  process.env.EXPO_NO_DOTENV = "1";
  const load = relative => require(path.join(cliRoot, "build", relative));
  requireCondition(load("api.js").getExpoApiBaseUrl() === "https://api.expo.dev", "OFFICIAL_EXPO_ENDPOINT_REQUIRED");
  const configPath = path.join(root, "app.json");
  const configBytes = fs.readFileSync(configPath);
  const config = JSON.parse(configBytes).expo;
  requireCondition(config.extra?.eas?.projectId === projectId && config.slug === projectName && config.android?.package === applicationIdentifier, "LOCAL_PROJECT_MISMATCH");
  const release = JSON.parse(fs.readFileSync(path.join(root, "artifacts/release-verification.json"), "utf8"));
  const apkPath = path.join(root, release.apk);
  requireCondition(fingerprint(fs.readFileSync(apkPath)) === release.sha256, "PUBLISHED_APK_CHANGED");

  phase = "CREDENTIAL_VALIDATION";
  const info = fs.lstatSync(keyPath);
  requireCondition(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 64 * 1024, "SERVICE_ACCOUNT_FILE_INVALID");
  const key = load("credentials/android/utils/googleServiceAccountKey.js").readAndValidateServiceAccountKey(keyPath);
  requireCondition(key.type === "service_account" && key.project_id === firebaseProject && /^[a-f0-9]{40}$/.test(key.private_key_id ?? "") && key.client_email === `firebase-adminsdk-fbsvc@${firebaseProject}.iam.gserviceaccount.com`, "SERVICE_ACCOUNT_IDENTITY_MISMATCH");
  requireCondition(key.token_uri === "https://oauth2.googleapis.com/token" && key.auth_uri === "https://accounts.google.com/o/oauth2/auth", "SERVICE_ACCOUNT_ENDPOINT_MISMATCH");
  requireCondition(createPrivateKey(key.private_key).asymmetricKeyType === "rsa", "SERVICE_ACCOUNT_KEY_INVALID");
  report.serviceAccountValidated = true;

  phase = "EXPO_SESSION";
  const SessionManager = load("user/SessionManager.js").default;
  const manager = new SessionManager({ setActor() {} });
  const { authenticationInfo } = await manager.ensureLoggedInAsync({ nonInteractive: true });
  const { createGraphqlClient } = load("commandUtils/context/contextUtils/createGraphqlClient.js");
  const client = createGraphqlClient(authenticationInfo);
  const query = client.query.bind(client);
  const mutation = client.mutation.bind(client);
  client.query = (document, variables, context) => query(document, variables, { ...context, requestPolicy: "network-only", noRetry: true });
  client.mutation = (document, variables, context) => mutation(document, variables, { ...context, noRetry: true });
  const api = load("credentials/android/api/GraphqlClient.js");
  const { AppQuery } = load("graphql/queries/AppQuery.js");
  phase = "PROJECT_LOOKUP";
  const app = await AppQuery.byIdAsync(client, projectId);
  requireCondition(app.id === projectId && app.slug === projectName && app.ownerAccount?.name === accountName, "REMOTE_PROJECT_MISMATCH");
  report.project = app.fullName;
  const lookup = { account: app.ownerAccount, projectName, androidApplicationIdentifier: applicationIdentifier };
  phase = "EXISTING_CREDENTIALS";
  const before = await api.getAndroidAppCredentialsWithCommonFieldsAsync(client, lookup);
  const beforeSigning = signingReferences(before);
  const existing = before?.googleServiceAccountKeyForFcmV1;
  requireCondition(!existing || credentialMatches(existing, key), "DIFFERENT_FCM_CREDENTIAL_ALREADY_CONFIGURED");
  const keys = await api.getGoogleServiceAccountKeysForAccountAsync(client, app.ownerAccount);
  const matches = keys.filter(item => credentialMatches(item, key));
  requireCondition(matches.length <= 1, "AMBIGUOUS_EXISTING_FCM_CREDENTIAL");
  report.alreadyConfigured = Boolean(existing);
  report.existingKeyReusable = matches.length === 1;
  report.remoteBuildCredentialCount = beforeSigning.length;
  if (mode === "plan") {
    report.plannedAction = existing ? "VERIFY_EXISTING_FCM_ONLY" : matches.length ? "ASSIGN_EXISTING_FCM_ONLY" : "UPLOAD_AND_ASSIGN_FCM_ONLY";
    report.success = true;
    return;
  }
  if (!existing) {
    let selected = matches[0];
    if (!selected) {
      phase = "UPLOAD_FCM_KEY";
      selected = await api.createGoogleServiceAccountKeyAsync(client, app.ownerAccount, key);
      report.keyUploaded = true;
      requireCondition(credentialMatches(selected, key), "UPLOADED_FCM_IDENTITY_MISMATCH");
    }
    phase = "ASSIGN_FCM_KEY";
    const { AssignGoogleServiceAccountKeyForFcmV1 } = load("credentials/android/actions/AssignGoogleServiceAccountKeyForFcmV1.js");
    await new AssignGoogleServiceAccountKeyForFcmV1(lookup).runAsync({ android: api, graphqlClient: client }, selected);
  }
  phase = "VERIFY_REMOTE_ASSIGNMENT";
  const after = await api.getAndroidAppCredentialsWithCommonFieldsAsync(client, lookup);
  requireCondition(after?.applicationIdentifier === applicationIdentifier && after.app?.id === projectId && credentialMatches(after.googleServiceAccountKeyForFcmV1, key), "FCM_ASSIGNMENT_NOT_CONFIRMED");
  requireCondition(JSON.stringify(signingReferences(after)) === JSON.stringify(beforeSigning), "REMOTE_SIGNING_REFERENCES_CHANGED");
  requireCondition(fingerprint(fs.readFileSync(configPath)) === fingerprint(configBytes) && fingerprint(fs.readFileSync(apkPath)) === release.sha256, "LOCAL_RELEASE_CHANGED");
  report.fcmAssigned = true;
  report.signingReferencesUnchanged = true;
  report.localApkUnchanged = true;
  report.credentialsUrl = `https://expo.dev/accounts/${accountName}/projects/${projectName}/credentials`;
  report.success = true;
}

main().catch(() => {
  report.success = false;
  report.failedPhase = phase;
  report.error = "FCM_SETUP_NOT_CONFIRMED";
  process.exitCode = 1;
}).finally(() => {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${mode === "apply" ? "apply" : "plan"}-${report.at.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});