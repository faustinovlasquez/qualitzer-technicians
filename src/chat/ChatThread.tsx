import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { ActivityIndicator, AppState, BackHandler, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PrivateModal as Modal } from "../security/DeviceSecurityContext";
import { useTrustedNativePicker } from "../security/useTrustedNativePicker";
import { CameraPermissionError } from "../domain/cameraErrors";
import type { DriveUpload } from "../domain/fileDrive";
import { THREAD_ATTACHMENTS_MAX, THREAD_TAB_LABELS, THREAD_TEXT_MAX, threadDate, threadDayLabel, threadMentionQuery, type ThreadMention, type ThreadPerson, type ThreadApi, type ThreadAttachment, type ThreadMessage, type ThreadPage, type ThreadTab } from "../domain/threads";
import { pickWorkspaceFiles } from "../screens/workDetail/files/filePicker";
import type { FileSource } from "../screens/workDetail/files/fileRules";
import { httpUrl } from "../screens/workDetail/detailRules";
import { IconButton } from "../ui/components";
import { palette, radius, typography } from "../ui/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const POLL_MS = 20_000;
const failureText = (failure: unknown, fallback: string) => failure instanceof Error && failure.message ? failure.message : fallback;
const networkKind = (failure: unknown) => failure instanceof Error && failure.name === "NetworkError" ? (failure as Error & { kind?: string }).kind : undefined;
/** El borrador vive en el teléfono (se carga al usarlo: el chat también corre en pruebas sin almacenamiento). */
const draftStore = async () => (await import("@react-native-async-storage/async-storage")).default;
const DRAFT_PREFIX = "@qualitzer/chat-draft/v1:";
const chatDate = threadDate;
const dayLabel = threadDayLabel;
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const timeLabel = (date: Date | null, raw: string | null) => date ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : raw ?? "";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
const AVATAR_TONES = [palette.primary, palette.info, palette.violet, palette.orange, palette.success];
const tone = (name: string) => AVATAR_TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length]!;

function Avatar({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  const safe = httpUrl(url);
  if (safe && !failed) return <Image source={{ uri: safe }} style={styles.avatar} onError={() => setFailed(true)} accessibilityLabel={name} />;
  return <View style={[styles.avatar, { backgroundColor: tone(name) }]}><Text style={styles.avatarText}>{initials(name)}</Text></View>;
}

function AttachmentView({ file, mine, onPreview }: { file: ThreadAttachment; mine: boolean; onPreview: (file: ThreadAttachment) => void }) {
  const image = file.type?.startsWith("image/") === true;
  const thumb = httpUrl(file.thumbnailUrl) ?? (image ? httpUrl(file.url) : null);
  if (image && thumb) return <Pressable accessibilityRole="button" accessibilityLabel="Ver foto" onPress={() => onPreview(file)}>
    <Image source={{ uri: thumb }} style={styles.photo} />
  </Pressable>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${file.name}`} onPress={() => { const url = httpUrl(file.url); if (url) void Linking.openURL(url).catch(() => undefined); }}
    style={[styles.fileChip, mine && styles.fileChipMine]}>
    <Ionicons name={file.type?.includes("pdf") ? "document-text" : "document-attach"} size={18} color={mine ? palette.white : palette.primary} accessible={false} />
    <Text style={[styles.fileName, mine && styles.textMine]} numberOfLines={1}>{file.name}</Text>
  </Pressable>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.sheetHead}><Text style={styles.sheetTitle} accessibilityRole="header">{title}</Text><IconButton name="close-outline" label="Cerrar" onPress={onClose} /></View>
        {children}
      </View>
    </View>
  </Modal>;
}

function SheetAction({ icon, label, detail, onPress }: { icon: IconName; label: string; detail?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.sheetAction, pressed && styles.pressed]}>
    <View style={styles.sheetIcon}><Ionicons name={icon} size={20} color={palette.primary} accessible={false} /></View>
    <View style={styles.grow}><Text style={styles.sheetLabel}>{label}</Text>{detail ? <Text style={styles.hint}>{detail}</Text> : null}</View>
  </Pressable>;
}

/**
 * Chat genérico (como los comentarios de la web): burbujas propias a la derecha, separadores por día, fotos y archivos,
 * editar lo propio, pestañas Técnico/General y escribir con adjuntos. Sirve para ingresos, OT, trabajos y mantenimientos.
 */
export function ChatThread({ api, title, subtitle, onClose, embedded = false, readOnly = false, draftKey, onOfflineSend }: {
  api: ThreadApi; title: string; subtitle?: string; onClose?: () => void; embedded?: boolean; readOnly?: boolean;
  /** Clave para guardar en el teléfono lo que se está escribiendo (no se pierde si se corta la señal o se cierra la app). */
  draftKey?: string;
  /** Sin señal: guarda el texto en la cola sin conexión para enviarlo solo después (solo texto, sin adjuntos). */
  onOfflineSend?: (text: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<ThreadTab | null>(null);
  const [pages, setPages] = useState<ThreadPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<DriveUpload[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [editing, setEditing] = useState<ThreadMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [preview, setPreview] = useState<ThreadAttachment | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const [people, setPeople] = useState<ThreadPerson[] | null>(null);
  const [mentions, setMentions] = useState<ThreadMention[]>([]);
  const loadingPeople = useRef(false);
  const picker = useTrustedNativePicker();
  const scroll = useRef<ScrollView>(null);
  const stickToEnd = useRef(true);
  const apiRef = useRef(api);
  apiRef.current = api;
  const ticket = useRef(0);

  const first = pages[0] ?? null;
  const tabs = first?.tabs ?? [];
  // La sucursal puede dejar los comentarios solo para leer desde la app.
  const blocked = first?.capabilities.write === false;
  const canWrite = !readOnly && !blocked;
  const canAttach = canWrite && first?.capabilities.attachments !== false;
  const messages = [...pages.flatMap((page) => page.messages)].filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index)
    .sort((a, b) => (chatDate(a.createdAt)?.getTime() ?? 0) - (chatDate(b.createdAt)?.getTime() ?? 0) || Number(a.id) - Number(b.id));
  const last = pages[pages.length - 1];
  const hasOlder = last ? last.page + 1 < last.totalPages : false;

  async function loadLatest(quiet = false) {
    const current = ++ticket.current;
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const page = await apiRef.current.list(tab, 0);
      if (current !== ticket.current) return;
      setPages((existing) => quiet && existing.length > 0 ? [page, ...existing.slice(1)] : [page]);
      if (tab === null && page.tab) setTab(page.tab);
    } catch (failure) {
      if (current === ticket.current && !quiet) setError(failureText(failure, "No se pudieron cargar los comentarios. Revisa tu conexión."));
    } finally { if (current === ticket.current && !quiet) setLoading(false); }
  }
  useEffect(() => { stickToEnd.current = true; setPages([]); void loadLatest(); }, [tab]);
  // En vivo: espera a que el servidor avise un mensaje nuevo o que alguien escribe, y recarga solo eso. Si el servidor
  // no tiene conexión en vivo, pregunta cada 20 s. Al volver a la app también se actualiza.
  useEffect(() => {
    let active = true;
    const pause = (ms: number) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); if (!active) clearTimeout(timer); });
    void (async () => {
      let version = 0;
      let seen: string[] = [];
      while (active) {
        try {
          const state = await apiRef.current.live(tab, version, seen);
          if (!active) break;
          if (!state.live) { setTyping([]); await pause(POLL_MS); if (active) void loadLatest(true); continue; }
          if (state.version !== version) void loadLatest(true);
          version = state.version; seen = state.typing; setTyping(state.typing);
        } catch {
          await pause(POLL_MS);
          if (active) void loadLatest(true);
        }
      }
    })();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void loadLatest(true); });
    return () => { active = false; subscription.remove(); };
  }, [tab]);

  // Aviso de «está escribiendo» a los demás: al teclear, y se apaga a los 4 s sin escribir o al enviar.
  const typingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stopTyping() {
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
    if (typingSent.current > 0) { typingSent.current = 0; void apiRef.current.typing(tab, false).catch(() => undefined); }
  }
  function onDraft(value: string) {
    setDraft(value);
    if (!value.trim()) { stopTyping(); return; }
    if (Date.now() - typingSent.current > 3_000) { typingSent.current = Date.now(); void apiRef.current.typing(tab, true).catch(() => undefined); }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 4_000);
    // Personas para mencionar: se cargan la primera vez que se escribe «@».
    if (people === null && !loadingPeople.current && threadMentionQuery(value) !== null) {
      loadingPeople.current = true;
      void apiRef.current.people().then(setPeople, () => setPeople([])).finally(() => { loadingPeople.current = false; });
    }
  }
  useEffect(() => () => stopTyping(), [tab]);

  const mentionQuery = threadMentionQuery(draft);
  const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const suggestions = mentionQuery === null || !people ? [] : people.filter((person) => plain(person.name).includes(plain(mentionQuery))).slice(0, 6);
  function mention(person: ThreadPerson) {
    const query = threadMentionQuery(draft) ?? "";
    setDraft(`${draft.slice(0, draft.length - query.length - 1)}@${person.name} `);
    setMentions((current) => current.some((item) => item.id === person.id) ? current : [...current, { id: person.id, name: person.name }]);
  }

  async function loadOlder() {
    if (!last || !hasOlder || loadingOlder) return;
    setLoadingOlder(true); stickToEnd.current = false;
    try { const page = await api.list(tab, last.page + 1); setPages((existing) => [...existing, page]); }
    catch (failure) { setError(failureText(failure, "No se pudieron cargar los mensajes anteriores.")); }
    finally { setLoadingOlder(false); }
  }

  const back = useRef<() => boolean>(() => false);
  back.current = () => {
    if (preview) { setPreview(null); return true; }
    if (editing) { setEditing(null); return true; }
    if (attachOpen) { setAttachOpen(false); return true; }
    if (embedded || !onClose || sending) return Boolean(sending);
    onClose(); return true;
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => back.current());
    return () => subscription.remove();
  }, []);

  async function attach(source: FileSource) {
    setAttachOpen(false); setSendError("");
    const remaining = THREAD_ATTACHMENTS_MAX - files.length;
    if (remaining <= 0) { setSendError(`Puedes adjuntar hasta ${THREAD_ATTACHMENTS_MAX} archivos por mensaje.`); return; }
    try {
      const picked = await pickWorkspaceFiles(source, remaining, picker);
      const tooBig = picked.filter((file) => file.size !== undefined && file.size > MAX_UPLOAD_BYTES);
      if (tooBig.length > 0) setSendError(`${tooBig.map((file) => file.name).join(", ")} supera los 25 MB.`);
      setFiles((current) => [...current, ...picked.filter((file) => !tooBig.includes(file)).slice(0, remaining)
        .map((file) => ({ id: Crypto.randomUUID(), uri: file.uri, name: file.name, mimeType: file.mimeType ?? "application/octet-stream", size: file.size }))]);
    } catch (failure) {
      setSendError(failure instanceof CameraPermissionError ? "La app no tiene permiso para usar la cámara. Actívalo en los ajustes del teléfono." : failureText(failure, "No se pudo abrir el selector."));
    }
  }

  // Borrador: se recupera al abrir y se guarda mientras se escribe.
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (!draftKey) return;
    let active = true;
    void draftStore().then((store) => store.getItem(DRAFT_PREFIX + draftKey)).then((saved) => {
      if (active && saved) setDraft((current) => current || saved);
    }).catch(() => undefined).finally(() => { draftLoaded.current = true; });
    return () => { active = false; };
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey || !draftLoaded.current) return;
    const timer = setTimeout(() => {
      void draftStore().then((store) => draft.trim() ? store.setItem(DRAFT_PREFIX + draftKey, draft) : store.removeItem(DRAFT_PREFIX + draftKey)).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, draftKey]);
  const [notice, setNotice] = useState("");

  async function send() {
    const text = draft.trim();
    if (sending || (!text && files.length === 0)) return;
    setSending(true); setSendError(""); setNotice(""); stopTyping();
    const sent = () => { setDraft(""); setFiles([]); setMentions([]); stickToEnd.current = true; };
    try {
      await api.send(tab, text, files, mentions);
      sent();
      await loadLatest(true);
    } catch (failure) {
      const kind = networkKind(failure);
      // Se cortó a mitad de camino: puede que sí haya llegado. Se revisa antes de reintentar para no duplicarlo.
      if (kind === "timeout" && text) {
        try {
          const latest = await apiRef.current.list(tab, 0);
          if (latest.messages.some((message) => message.mine && message.text.trim() === text)) { sent(); await loadLatest(true); return; }
        } catch { /* Sin respuesta: queda el error para reintentar. */ }
      }
      // Sin señal antes de enviar: solo texto se guarda en la cola y se envía solo después.
      if (kind === "network" && onOfflineSend && text && files.length === 0) {
        try { await onOfflineSend(text); sent(); setNotice("Sin señal: tu mensaje quedó guardado en el teléfono y se enviará solo al volver la conexión."); return; }
        catch (queueFailure) { setSendError(failureText(queueFailure, "No se pudo guardar el mensaje en el teléfono.")); return; }
      }
      setSendError(failureText(failure, "No se pudo enviar. Tu mensaje sigue aquí para reintentar."));
    }
    finally { setSending(false); }
  }

  async function saveEdit() {
    if (!editing || !editText.trim() || sending) return;
    setSending(true); setSendError("");
    try { await api.edit(tab, editing.id, editText.trim(), mentions); setEditing(null); await loadLatest(true); }
    catch (failure) { setSendError(failureText(failure, "No se pudo editar el comentario.")); }
    finally { setSending(false); }
  }

  let lastDay = "";
  const content = <>
    {/* Dentro de una pestaña la pantalla ya dice dónde se está: sin encabezado; se actualiza deslizando hacia abajo. */}
    {!embedded ? <View style={styles.bar}>
      {!embedded && onClose ? <IconButton name="arrow-back" label="Cerrar comentarios" disabled={sending} onPress={onClose} />
        : <View style={styles.barIcon}><Ionicons name="chatbubbles" size={20} color={palette.primary} accessible={false} /></View>}
      <View style={styles.grow}>
        <Text style={styles.barTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.hint} numberOfLines={1}>{subtitle ? `${subtitle} · ` : ""}{first ? first.total === 1 ? "1 comentario" : `${first.total} comentarios` : "Cargando…"}</Text>
      </View>
      <IconButton name="refresh" label="Actualizar comentarios" disabled={loading} onPress={() => { stickToEnd.current = true; void loadLatest(); }} />
    </View> : null}
    {tabs.length > 1 ? <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)}
        style={[styles.tab, tab === item && styles.tabOn]}>
        <Ionicons name={item === "technical" ? "construct" : "people"} size={15} color={tab === item ? palette.primary : palette.textSecondary} accessible={false} />
        <Text style={[styles.tabText, tab === item && styles.tabTextOn]}>{THREAD_TAB_LABELS[item]}</Text>
      </Pressable>)}
    </View> : null}

    <ScrollView ref={scroll} style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => { if (stickToEnd.current) scroll.current?.scrollToEnd({ animated: false }); }}
      onScroll={(event) => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; stickToEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80; }}
      scrollEventThrottle={100}
      refreshControl={embedded ? <RefreshControl refreshing={loading && messages.length > 0} onRefresh={() => { stickToEnd.current = true; void loadLatest(); }} tintColor={palette.primary} colors={[palette.primary]} /> : undefined}>
      {hasOlder ? <Pressable accessibilityRole="button" onPress={() => void loadOlder()} style={styles.older} disabled={loadingOlder}>
        {loadingOlder ? <ActivityIndicator size="small" color={palette.primary} /> : <Ionicons name="arrow-up" size={14} color={palette.primary} accessible={false} />}
        <Text style={styles.olderText}>Ver mensajes anteriores</Text>
      </Pressable> : null}
      {loading && messages.length === 0 ? <View style={styles.center}><ActivityIndicator color={palette.primary} /><Text style={styles.hint}>Cargando comentarios…</Text></View>
        : error && messages.length === 0 ? <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={34} color={palette.textMuted} accessible={false} />
          <Text style={styles.emptyTitle}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void loadLatest()} style={styles.retry}><Text style={styles.retryText}>Reintentar</Text></Pressable>
        </View>
        : messages.length === 0 ? <View style={styles.center}>
          <View style={styles.emptyIcon}><Ionicons name="chatbubbles-outline" size={34} color={palette.primary} accessible={false} /></View>
          <Text style={styles.emptyTitle}>Aún no hay comentarios</Text>
          <Text style={styles.emptyText}>{!canWrite ? "Cuando alguien comente, aparecerá aquí." : "Escribe el primero: queda visible para todo el equipo en la web y en la app."}</Text>
        </View>
        : messages.map((message) => {
          const date = chatDate(message.createdAt);
          const key = date ? dayKey(date) : "";
          const separator = key && key !== lastDay ? <View key={`day-${key}`} style={styles.day}><Text style={styles.dayText}>{dayLabel(date!)}</Text></View> : null;
          if (key) lastDay = key;
          return <View key={message.id}>
            {separator}
            <View style={[styles.messageRow, message.mine && styles.messageRowMine]}>
              {!message.mine ? <Avatar name={message.authorName} url={message.authorAvatar} /> : null}
              <Pressable accessibilityRole={message.mine && canWrite ? "button" : undefined} accessibilityHint={message.mine && canWrite ? "Mantén presionado para editar" : undefined}
                onLongPress={message.mine && canWrite && first?.capabilities.edit ?() => { setEditing(message); setEditText(message.text); } : undefined}
                style={[styles.bubble, message.mine ? styles.bubbleMine : styles.bubbleOther]}>
                {!message.mine ? <Text style={[styles.author, { color: tone(message.authorName) }]} numberOfLines={1}>{message.authorName}</Text> : null}
                {message.attachments.length > 0 ? <View style={styles.attachments}>
                  {message.attachments.map((file, index) => <AttachmentView key={`${file.url}-${index}`} file={file} mine={message.mine} onPreview={setPreview} />)}
                </View> : null}
                {message.text ? <Text selectable style={[styles.messageText, message.mine && styles.textMine]}>{message.text}</Text> : null}
                <Text style={[styles.time, message.mine && styles.timeMine]}>{message.editedAt ? "editado · " : ""}{timeLabel(date, message.createdAt)}</Text>
              </Pressable>
            </View>
          </View>;
        })}
    </ScrollView>

    {typing.length > 0 ? <View style={styles.typing} accessibilityLiveRegion="polite">
      <View style={styles.typingDots}><View style={styles.dot} /><View style={[styles.dot, styles.dotMid]} /><View style={styles.dot} /></View>
      <Text style={styles.typingText} numberOfLines={1}>{typing.length === 1 ? `${typing[0]} está escribiendo…` : `${typing.slice(0, 2).join(" y ")} están escribiendo…`}</Text>
    </View> : null}
    {!readOnly && blocked ? <View style={styles.blocked} accessibilityRole="text">
      <Ionicons name="lock-closed" size={14} color={palette.textSecondary} accessible={false} />
      <Text style={styles.hint}>En esta sucursal los comentarios se escriben desde la web.</Text>
    </View> : null}
    {canWrite ? <View style={styles.composer}>
      {suggestions.length > 0 ? <View style={styles.suggestions} accessibilityLabel="Personas para mencionar">
        {suggestions.map((person) => <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Mencionar a ${person.name}`} onPress={() => mention(person)}
          style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
          <Avatar name={person.name} url={person.avatar} />
          <Text style={styles.suggestionName} numberOfLines={1}>{person.name}</Text>
        </Pressable>)}
      </View> : mentionQuery !== null && people === null ? <View style={styles.suggestions}><ActivityIndicator size="small" color={palette.primary} /></View> : null}
      {notice ? <View style={styles.sendError}><Ionicons name="cloud-upload-outline" size={16} color={palette.success} accessible={false} /><Text style={[styles.sendErrorText, { color: palette.success }]}>{notice}</Text></View> : null}
      {sendError ? <View style={styles.sendError}><Ionicons name="alert-circle" size={16} color={palette.danger} accessible={false} /><Text style={styles.sendErrorText}>{sendError}</Text></View> : null}
      {files.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pending}>
        {files.map((file) => <View key={file.id} style={styles.pendingItem}>
          {file.mimeType.startsWith("image/") ? <Image source={{ uri: file.uri }} style={styles.pendingImage} /> : <View style={styles.pendingDoc}><Ionicons name="document-attach" size={20} color={palette.primary} accessible={false} /></View>}
          <Text style={styles.pendingName} numberOfLines={1}>{file.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${file.name}`} disabled={sending} hitSlop={8} onPress={() => setFiles((list) => list.filter((item) => item.id !== file.id))} style={styles.pendingRemove}>
            <Ionicons name="close" size={12} color={palette.white} accessible={false} />
          </Pressable>
        </View>)}
      </ScrollView> : null}
      <View style={styles.inputRow}>
        {canAttach ? <Pressable accessibilityRole="button" accessibilityLabel="Adjuntar foto o archivo" disabled={sending || files.length >= THREAD_ATTACHMENTS_MAX} onPress={() => setAttachOpen(true)}
          style={({ pressed }) => [styles.attachButton, (sending || files.length >= THREAD_ATTACHMENTS_MAX) && styles.disabled, pressed && styles.pressed]}>
          <Ionicons name="attach" size={22} color={palette.primary} accessible={false} />
        </Pressable> : null}
        <TextInput value={draft} onChangeText={onDraft} placeholder="Escribe un comentario… (@ para mencionar)" placeholderTextColor={palette.textMuted} multiline maxLength={THREAD_TEXT_MAX}
          editable={!sending} style={styles.input} accessibilityLabel="Escribir comentario" />
        <Pressable accessibilityRole="button" accessibilityLabel="Enviar comentario" disabled={sending || (!draft.trim() && files.length === 0)} onPress={() => void send()}
          style={({ pressed }) => [styles.sendButton, (sending || (!draft.trim() && files.length === 0)) && styles.sendDisabled, pressed && styles.pressed]}>
          {sending ? <ActivityIndicator size="small" color={palette.white} /> : <Ionicons name="send" size={18} color={palette.white} accessible={false} />}
        </Pressable>
      </View>
    </View> : null}

    {attachOpen ? <Sheet title="Adjuntar" onClose={() => setAttachOpen(false)}>
      <SheetAction icon="camera" label="Tomar foto" onPress={() => void attach("camera")} />
      <SheetAction icon="images" label="Elegir de la galería" detail={`Hasta ${THREAD_ATTACHMENTS_MAX} por mensaje`} onPress={() => void attach("library")} />
      <SheetAction icon="document-attach" label="Documento" detail="PDF, Word, Excel o texto · hasta 25 MB" onPress={() => void attach("document")} />
    </Sheet> : null}

    {editing ? <Sheet title="Editar comentario" onClose={() => setEditing(null)}>
      <TextInput value={editText} onChangeText={setEditText} multiline maxLength={THREAD_TEXT_MAX} autoFocus style={[styles.input, styles.editInput]} accessibilityLabel="Texto del comentario" />
      <Pressable accessibilityRole="button" disabled={sending || !editText.trim()} onPress={() => void saveEdit()} style={[styles.saveEdit, (sending || !editText.trim()) && styles.sendDisabled]}>
        {sending ? <ActivityIndicator size="small" color={palette.white} /> : <Ionicons name="checkmark" size={18} color={palette.white} accessible={false} />}
        <Text style={styles.saveEditText}>Guardar cambios</Text>
      </Pressable>
      <Text style={styles.hint}>Todos verán que el comentario fue editado.</Text>
    </Sheet> : null}

    {preview ? <Modal visible animationType="fade" onRequestClose={() => setPreview(null)}>
      <View style={styles.preview}>
        <View style={styles.previewBar}>
          <View style={styles.grow} />
          <Pressable accessibilityRole="button" accessibilityLabel="Abrir original" hitSlop={8} onPress={() => { const url = httpUrl(preview.url); if (url) void Linking.openURL(url).catch(() => undefined); }}>
            <Ionicons name="open-outline" size={22} color={palette.white} accessible={false} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar foto" hitSlop={8} onPress={() => setPreview(null)}><Ionicons name="close" size={26} color={palette.white} accessible={false} /></Pressable>
        </View>
        <Image source={{ uri: httpUrl(preview.url) ?? "" }} resizeMode="contain" style={styles.previewImage} accessibilityLabel="Foto del comentario" />
      </View>
    </Modal> : null}
  </>;

  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={embedded ? 120 : 0}>{content}</KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  barIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  barTitle: { fontSize: 17, fontWeight: "800", color: palette.heading },
  tabs: { flexDirection: "row", gap: 6, marginHorizontal: 12, marginTop: 8, padding: 4, borderRadius: radius.md, backgroundColor: palette.track },
  tab: { flex: 1, minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.sm },
  tabOn: { backgroundColor: palette.surface, boxShadow: "0px 1px 3px rgba(18, 44, 58, 0.12)" },
  tabText: { fontSize: 14, fontWeight: "700", color: palette.textSecondary },
  tabTextOn: { color: palette.primary },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 8, flexGrow: 1 },
  older: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  olderText: { fontSize: 13, fontWeight: "700", color: palette.primary },
  day: { alignSelf: "center", marginVertical: 6, paddingHorizontal: 12, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.track },
  dayText: { fontSize: 12, fontWeight: "700", color: palette.textSecondary, textTransform: "capitalize" },
  messageRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginVertical: 2 },
  messageRowMine: { justifyContent: "flex-end" },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: palette.track },
  avatarText: { fontSize: 12, fontWeight: "800", color: palette.white },
  bubble: { maxWidth: "80%", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  bubbleOther: { borderBottomLeftRadius: 4, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  bubbleMine: { borderBottomRightRadius: 4, backgroundColor: palette.primary },
  author: { fontSize: 12, fontWeight: "800" },
  messageText: { fontSize: 15, lineHeight: 21, color: palette.text },
  textMine: { color: palette.white },
  time: { alignSelf: "flex-end", fontSize: 11, color: palette.textMuted },
  timeMine: { color: "rgba(255,255,255,0.8)" },
  attachments: { gap: 6 },
  photo: { width: 200, height: 150, borderRadius: 12, backgroundColor: palette.track },
  fileChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: palette.primarySoft, maxWidth: 240 },
  fileChipMine: { backgroundColor: "rgba(255,255,255,0.18)" },
  fileName: { flex: 1, fontSize: 13, fontWeight: "700", color: palette.primary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 40, paddingHorizontal: 24 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: palette.heading, textAlign: "center" },
  emptyText: { ...typography.body, color: palette.textSecondary, textAlign: "center" },
  retry: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: palette.primarySoft },
  retryText: { fontWeight: "800", color: palette.primary },
  typing: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  typingDots: { flexDirection: "row", gap: 3, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: palette.track },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.textMuted },
  dotMid: { backgroundColor: palette.primary },
  typingText: { flex: 1, fontSize: 12, fontStyle: "italic", color: palette.textSecondary },
  suggestions: { gap: 2, padding: 6, borderRadius: radius.md, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm },
  suggestionName: { flex: 1, fontSize: 14, fontWeight: "700", color: palette.heading },
  blocked: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border },
  composer: { gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border },
  sendError: { flexDirection: "row", alignItems: "center", gap: 6 },
  sendErrorText: { flex: 1, fontSize: 13, color: palette.danger },
  pending: { gap: 8, paddingVertical: 2 },
  pendingItem: { width: 72, gap: 4 },
  pendingImage: { width: 72, height: 72, borderRadius: 10, backgroundColor: palette.track },
  pendingDoc: { width: 72, height: 72, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  pendingName: { fontSize: 11, color: palette.textSecondary },
  pendingRemove: { position: "absolute", top: -4, right: -4, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.heading },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  attachButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  input: { flex: 1, minHeight: 42, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 21, backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, fontSize: 15, color: palette.text },
  sendButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: palette.primary },
  sendDisabled: { backgroundColor: palette.textMuted },
  // Ventana centrada: pegada abajo quedaba bajo la barra de navegación del teléfono.
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(15,23,42,0.5)" },
  sheet: { width: "100%", maxWidth: 520, maxHeight: "85%", gap: 6, padding: 16, borderRadius: radius.xl, backgroundColor: palette.surface },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: palette.heading },
  sheetAction: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.md },
  sheetIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.primarySoft },
  sheetLabel: { fontSize: 15, fontWeight: "700", color: palette.heading },
  editInput: { flex: 0, minHeight: 100, borderRadius: radius.md, textAlignVertical: "top" },
  saveEdit: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: radius.md, backgroundColor: palette.primary, marginTop: 6 },
  saveEditText: { fontSize: 15, fontWeight: "800", color: palette.white },
  preview: { flex: 1, backgroundColor: "#000000" },
  previewBar: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 16, paddingTop: 44, paddingBottom: 12 },
  previewImage: { flex: 1, width: "100%" },
  hint: { ...typography.caption, color: palette.textSecondary },
  grow: { flex: 1, minWidth: 0 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 }
});
