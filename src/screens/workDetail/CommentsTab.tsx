import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import type { CommentPage, WorkComment } from "../../domain/models";
import { isOfflineQueuedError } from "../../domain/offline";
import { operationStatusLabels, type PendingComment } from "../offline/offlineUi";
import { syncUserError, userErrorText } from "../offline/syncUserPresentation";
import { Badge, BodyText, Button, Card, Field, SectionTitle } from "../../ui/components";
import { palette } from "../../ui/theme";
import { AttachmentList, Notice } from "./DetailUi";
import { errorMessage } from "./detailRules";
import { styles } from "./detailStyles";
import { commentDate, MAX_COMMENT_LENGTH, presentAttachment, safeFileUrl, sortedAttachments, type WorkspaceMode } from "./files/fileRules";
import { useWorkspaceDraft } from "./files/WorkspaceDraftStore";
import { workspaceStyles } from "./files/workspaceStyles";

export interface CommentsTabProps {
  scopeKey: string;
  resourceKey?: string;
  mode: "live" | "demo";
  busy: boolean;
  onLoad: (page: number) => Promise<CommentPage>;
  onSubmit: (text: string) => Promise<void>;
  pending?: PendingComment[];
  offlineReady?: boolean;
  appliedRevision?: string | number;
}

interface CommentsMessage { text: string; tone: "error" | "success" | "warning" | "info"; }
interface CommentsResult { data: WorkComment[]; page: number; totalPages: number; totalRows: number; }

function CommentItem({ comment, mode }: { comment: WorkComment; mode: WorkspaceMode }) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const author = comment.author.name.trim() || "Autor no informado";
  const avatar = safeFileUrl(comment.author.avatarUrl);
  const initials = author.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
  return <View style={workspaceStyles.comment}>
    <View style={styles.row}>
      <View style={workspaceStyles.avatar}>{avatar && avatar !== failedAvatar ? <Image source={{ uri: avatar }} style={workspaceStyles.avatarImage} onError={() => setFailedAvatar(avatar)} accessible={false} /> : <Text style={workspaceStyles.initials} accessible={false}>{initials}</Text>}</View>
      <View style={styles.grow}><Text style={styles.label}>{author}</Text><Text style={styles.caption}>{commentDate(comment.createdAt)}</Text></View>
    </View>
    {comment.text ? <Text selectable style={workspaceStyles.commentText}>{comment.text}</Text> : null}
    {comment.files.length > 0 ? <AttachmentList files={sortedAttachments(comment.files).map((file) => presentAttachment(file, mode))} /> : null}
  </View>;
}

export function CommentsTab(props: CommentsTabProps) {
  return <CommentsContent key={JSON.stringify([props.mode, props.scopeKey])} {...props} />;
}

function CommentsContent(props: CommentsTabProps) {
  const draft = useWorkspaceDraft(props.scopeKey, props.mode);
  const callbacks = useRef(props);
  callbacks.current = props;
  const active = useRef(false);
  const generation = useRef(0);
  const loadingPage = useRef<number | null>(null);
  const [result, setResult] = useState<CommentsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ page: number; text: string } | null>(null);
  const [message, setMessage] = useState<CommentsMessage | null>(null);
  const [localQueued, setLocalQueued] = useState<{ id: string; text: string; createdAt: number }[]>([]);
  const localQueuedRef = useRef(localQueued);
  const pending = (props.pending ?? []).filter((operation) => operation.status !== "applied");
  const pendingText = pending.some((operation) => operation.text === draft.text.trim()) || localQueued.some((operation) => operation.text === draft.text.trim());
  const textAlreadySent = draft.text.length > 0 && draft.text === draft.confirmedText;

  useEffect(() => {
    if (!props.pending) return;
    const known = new Set(props.pending.map((operation) => operation.id));
    localQueuedRef.current = localQueuedRef.current.filter((operation) => !known.has(operation.id));
    setLocalQueued(localQueuedRef.current);
  }, [props.pending]);

  const load = useCallback(async (page: number): Promise<boolean> => {
    if (page > 0 && loadingPage.current !== null) return false;
    const request = ++generation.current;
    loadingPage.current = page;
    if (active.current) { setLoading(true); setLoadError(null); }
    try {
      const response = await callbacks.current.onLoad(page);
      if (!Array.isArray(response.data) || !Number.isSafeInteger(response.totalPages) || response.totalPages < 0 || !Number.isSafeInteger(response.totalRows) || response.totalRows < 0) throw new Error("La respuesta del historial no tiene un formato válido.");
      if (active.current && request === generation.current) {
        setResult((previous) => {
          const data = new Map<string, WorkComment>();
          if (page > 0 && previous) for (const comment of previous.data) data.set(comment.id, comment);
          for (const comment of response.data) data.set(comment.id, comment);
          return { data: [...data.values()], page, totalRows: response.totalRows, totalPages: response.totalPages };
        });
        return true;
      }
    } catch (error) {
      if (active.current && request === generation.current) setLoadError({ page, text: `No se pudieron cargar los comentarios: ${errorMessage(error)}` });
    } finally {
      if (request === generation.current) loadingPage.current = null;
      if (active.current && request === generation.current) setLoading(false);
    }
    return false;
  }, []);

  useEffect(() => {
    active.current = true;
    void load(0);
    return () => { active.current = false; generation.current += 1; };
  }, [load]);

  const previousResource = useRef(props.resourceKey);
  useEffect(() => {
    if (previousResource.current === props.resourceKey) return;
    previousResource.current = props.resourceKey;
    void load(0);
  }, [load, props.resourceKey]);

  const appliedRevision = props.appliedRevision ?? props.pending?.filter((operation) => operation.status === "applied").map((operation) => operation.id).join("|") ?? "";
  const previousAppliedRevision = useRef(appliedRevision);
  useEffect(() => {
    if (previousAppliedRevision.current === appliedRevision) return;
    previousAppliedRevision.current = appliedRevision;
    void load(0);
  }, [appliedRevision, load]);

  async function changeText(text: string): Promise<void> {
    try { await draft.store.setText(text); }
    catch (error) { if (active.current) setMessage({ text: `El texto sigue en pantalla, pero su borrador no está protegido: ${errorMessage(error)}`, tone: "error" }); }
  }

  async function retryDraft(): Promise<void> {
    try { await draft.store.retry(); }
    catch (error) { if (active.current) setMessage({ text: errorMessage(error), tone: "error" }); }
  }

  function canSubmit(): boolean {
    return active.current && callbacks.current.offlineReady !== false && !draft.store.getSnapshot().closed;
  }

  async function submit(): Promise<void> {
    const current = draft.store.getSnapshot();
    const snapshot = current.text;
    const duplicate = (callbacks.current.pending ?? []).some((operation) => operation.status !== "applied" && operation.text === snapshot.trim()) || localQueuedRef.current.some((operation) => operation.text === snapshot.trim());
    if (!active.current || callbacks.current.busy || callbacks.current.offlineReady === false || duplicate || !snapshot.trim() || snapshot.length > MAX_COMMENT_LENGTH || snapshot === current.confirmedText || !draft.store.beginComment()) return;
    const onSubmit = callbacks.current.onSubmit;
    setMessage(null);
    let confirmed = false;
    let cleanupError: string | null = null;
    try {
      await draft.store.flush();
      if (!canSubmit()) return;
      await onSubmit(snapshot.trim());
      confirmed = true;
      try { await draft.store.confirmComment(snapshot); }
      catch (error) { cleanupError = errorMessage(error); }
      if (active.current) void load(0);
      if (active.current) setMessage({
        text: `${props.mode === "demo" ? "Comentario guardado en demostración." : "Comentario publicado."}${cleanupError ? ` Falta limpiar el borrador local: ${cleanupError} Reintenta el borrador, no el envío.` : ""}${draft.store.getSnapshot().text && draft.store.getSnapshot().text !== snapshot ? " El nuevo texto que escribiste se conserva como borrador." : ""}`,
        tone: cleanupError ? "warning" : "success",
      });
    } catch (error) {
      if (isOfflineQueuedError(error) && error.kind === "comment") {
        localQueuedRef.current = [...localQueuedRef.current.filter((item) => item.id !== error.operationId), { id: error.operationId, text: snapshot.trim(), createdAt: Date.now() }];
        if (active.current) setLocalQueued(localQueuedRef.current);
        try { await draft.store.confirmComment(snapshot); }
        catch { cleanupError = "Falta limpiar el borrador local. No reenvíes este texto; reintenta el almacenamiento."; }
        if (active.current) setMessage({ text: `Guardado en el teléfono${cleanupError ? `. ${cleanupError}` : ""}`, tone: cleanupError ? "warning" : "info" });
      } else if (active.current) setMessage({ text: confirmed ? `El comentario se publicó, pero no se pudo actualizar la pantalla. No lo reenvíes. ${errorMessage(error)}` : `No se confirmó el envío. Tu borrador se conserva. ${errorMessage(error)}`, tone: confirmed ? "warning" : "error" });
    } finally { draft.store.endComment(); }
  }

  const canLoadMore = result !== null && result.page + 1 < result.totalPages;
  return <View style={styles.stack}>
    <Card style={styles.stack}>
      <View style={styles.between}><SectionTitle title="Nuevo comentario" subtitle="Añade un mensaje al historial de este destino" />{props.mode === "demo" ? <Badge label="Demostración" tone="info" /> : null}</View>
      <BodyText>Se envía solo este mensaje, sin reemplazar comentarios anteriores. Es un comentario, no un reporte ni un archivo TXT. Una vez enviado, no se puede editar ni eliminar desde aquí.</BodyText>
      {props.pending !== undefined ? <BodyText>Si la app se cerró durante un envío, revisa el historial y el centro offline antes de reenviar el borrador. Un texto ya confirmado puede publicarse otra vez como un comentario nuevo.</BodyText> : null}
      {draft.error ? <View style={styles.tight}><Notice message={userErrorText(draft.error)} tone="error" />{!draft.closed ? <Button title="Reintentar borrador" variant="secondary" disabled={draft.saving || draft.commentBusy || props.busy} onPress={() => { void retryDraft(); }} /> : null}</View> : null}
      {!draft.hydrated && !draft.error ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>Recuperando el borrador del comentario…</BodyText></View> : null}
      <Field label="Comentario" placeholder="Escribe una observación para el equipo…" value={draft.text} onChangeText={(text) => { void changeText(text); }} multiline style={styles.multiline} maxLength={MAX_COMMENT_LENGTH} editable={draft.hydrated && !draft.closed} accessibilityHint="Texto de un nuevo comentario. Máximo diez mil caracteres. El envío requiere pulsar Publicar comentario." />
      <Text style={workspaceStyles.counter}>{draft.text.length.toLocaleString("es-CL")} / 10.000 caracteres</Text>
      {draft.text.length === MAX_COMMENT_LENGTH ? <Notice message="Has alcanzado el máximo de 10.000 caracteres." tone="warning" /> : null}
      {draft.saving && draft.hydrated ? <BodyText>Guardando borrador…</BodyText> : draft.text && !draft.error && !textAlreadySent ? <Badge label="Borrador guardado · aún no enviado" tone="warning" /> : null}
      {textAlreadySent || pendingText ? <View style={styles.tight}><Notice message={pendingText ? "Este texto ya está en la cola local. No se volverá a encolar mientras esté pendiente; no está confirmado en el servidor." : "El envío de este texto ya se gestionó. Solo falta limpiar el borrador; consulta su estado en el historial o en el centro offline."} tone="warning" /><Button title="Reintentar limpieza del borrador" variant="secondary" disabled={draft.saving || draft.commentBusy || props.busy} onPress={() => { void retryDraft(); }} /></View> : null}
      {props.offlineReady === false ? <Notice message="Recuperando la cola local antes de habilitar el envío." /> : null}
      {message?.tone === "info" ? <Text accessibilityLiveRegion="polite" style={styles.caption}>{message.text}</Text> : message ? <Notice message={userErrorText(message.text)} tone={message.tone} onDismiss={() => setMessage(null)} /> : null}
      <Button title={props.pending !== undefined ? "Guardar comentario · sincronizar" : props.mode === "demo" ? "Guardar comentario en demo" : "Publicar comentario"} icon="send-outline" loading={draft.commentBusy} disabled={props.busy || props.offlineReady === false || draft.closed || !draft.hydrated || draft.saving || !!draft.error || !draft.text.trim() || textAlreadySent || pendingText} onPress={() => { void submit(); }} />
    </Card>
    {pending.length + localQueued.length > 0 ? <Card style={styles.stack}>
      <SectionTitle title="Comentarios locales · pendientes" subtitle="No forman parte del historial confirmado del servidor." />
      {pending.map((operation) => <View key={operation.id} style={styles.tight}><Badge label={operationStatusLabels[operation.status]} tone="warning" /><Text style={styles.caption}>{new Date(operation.createdAt).toLocaleString("es-CL")}</Text><Text selectable style={workspaceStyles.commentText}>{operation.text}</Text>{operation.lastError ? <Notice message={syncUserError(operation.lastError)} tone="warning" /> : null}</View>)}
      {localQueued.filter((operation) => !pending.some((item) => item.id === operation.id)).map((operation) => <View key={operation.id} style={styles.tight}><Badge label="Guardado local · pendiente de sincronizar" tone="warning" /><Text style={styles.caption}>{new Date(operation.createdAt).toLocaleString("es-CL")}</Text><Text selectable style={workspaceStyles.commentText}>{operation.text}</Text></View>)}
    </Card> : null}
    <Card style={styles.stack}>
      <View style={styles.between}><SectionTitle title="Historial de comentarios" subtitle={result === null ? "Pendiente de consulta" : `${result.totalRows} comentario(s)`} /><Button title="Actualizar comentarios" icon="refresh-outline" variant="secondary" loading={loading && loadingPage.current === 0} disabled={loading || props.busy || draft.commentBusy || draft.closed} onPress={() => { void load(0); }} /></View>
      {loading ? <View style={styles.row}><ActivityIndicator color={palette.primary} /><BodyText>{loadingPage.current === 0 ? "Consultando comentarios…" : "Cargando más comentarios…"}</BodyText></View> : null}
      {loadError ? <View style={styles.tight}><Notice message={`${userErrorText(loadError.text)}${result !== null ? " Se mantiene la última consulta correcta." : " No se ha verificado si hay comentarios."}`} tone="error" /><Button title={loadError.page > 0 ? "Reintentar página de comentarios" : "Reintentar comentarios"} variant="secondary" disabled={loading || props.busy || draft.commentBusy || draft.closed} onPress={() => { void load(loadError.page); }} /></View> : null}
      {result?.data.map((comment) => <CommentItem key={comment.id} comment={comment} mode={props.mode} />)}
      {result !== null && result.data.length === 0 && !loadError && !loading ? <BodyText>Aún no hay comentarios en este destino.</BodyText> : null}
      {canLoadMore && result ? <Button title="Cargar más comentarios" icon="chevron-down-outline" variant="secondary" loading={loading && loadingPage.current !== 0} disabled={loading || props.busy || draft.commentBusy || draft.closed || loadError !== null} onPress={() => { void load(result.page + 1); }} /> : null}
    </Card>
  </View>;
}