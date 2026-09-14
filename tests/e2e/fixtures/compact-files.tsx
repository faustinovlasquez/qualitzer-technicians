import { useRef, useState, type ReactNode } from "react";
import { FileWorkspace } from "../../../src/screens/workDetail/FileWorkspace";
import type { Attachment, LocalPhoto } from "../../../src/domain/models";
import { OfflineQueuedError, type OfflineSnapshot } from "../../../src/domain/offline";
import type { PendingDocument } from "../../../src/screens/offline/offlineUi";

type Scenario = "partial" | "queue" | "auth";
interface FixtureApi { render: (scenario: Scenario) => void; retry: () => void; calls: string[]; }
declare global { interface Window { compactFiles: FixtureApi; } }
const initial: OfflineSnapshot = { online: true, authBlocked: false, preparing: false, syncing: false, pending: 0, conflicts: 0, lastSyncedAt: null, lastError: null, coverage: [], operations: [] };
const api: FixtureApi = { render: () => {}, retry: () => {}, calls: [] };
window.compactFiles = api;

function Fixture({ scenario, identity }: { scenario: Scenario; identity: string }) {
  const saved = useRef<Attachment[]>([]);
  const queuedFiles = useRef(new Map<string, LocalPhoto>());
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const fail = useRef(scenario === "partial");
  api.retry = () => { fail.current = false; };
  return <FileWorkspace compact scopeKey={identity} mode="live" readOnly={false} title="Archivos de inspección" requirement="Evidencia obligatoria · debe estar confirmada"
    offline={{ ...initial, online: scenario !== "auth" && scenario !== "queue", authBlocked: scenario === "auth", pending: pending.length, operations: pending }} pending={pending}
    onLoad={async () => [...saved.current]}
    onDelete={async () => { throw new Error("NO_DELETE_IN_FIXTURE"); }}
    readLocalFile={async (id) => { const file = queuedFiles.current.get(id); if (!file) throw new Error("MISSING_FIXTURE_FILE"); return file; }}
    onUpload={async (files) => {
      if (files.length !== 1) throw new Error("ONE_FILE_PER_CALL_REQUIRED");
      const file = files[0];
      api.calls.push(file.id);
      if (fail.current && api.calls.length === 2) throw new Error("Fallo simulado del segundo archivo");
      if (scenario === "auth") throw new Error("Sesión no verificada");
      if (scenario === "queue") {
        const id = `11111111-1111-4111-8111-${String(api.calls.length).padStart(12, "0")}`;
        queuedFiles.current.set(id, file);
        setPending((current) => [...current, { id, kind: "document", createdAt: Date.now(), status: "pending", attempts: 0, nextAttemptAt: 0,
          scope: { groupId: "direct-11", workId: "11", startDate: "2026-09-11", endDate: "2026-09-11", companyBranchId: 1 }, stepId: "1001",
          file: { id, namespace: identity, name: file.name, mimeType: file.mimeType, size: file.size ?? 1, sha256: "0".repeat(64) } }]);
        throw new OfflineQueuedError({ operationId: id, operationIds: [id], kind: "document", date: "2026-09-11", ownsFiles: true });
      }
      saved.current.push({ id: api.calls.length, name: file.name, type: "application/pdf", url: `https://files.example.invalid/${file.name}` });
    }}
  />;
}

export function mountCompactFiles(render: (node: ReactNode) => void): void {
  let sequence = 0;
  api.render = (scenario) => {
    api.calls = [];
    const identity = `files-only-fixture-${++sequence}`;
    render(<Fixture key={identity} identity={identity} scenario={scenario} />);
  };
}