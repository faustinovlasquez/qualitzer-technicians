import { useContext, useEffect, useRef, useState } from "react";
import { ownProfileFor, type OwnProfile, type OwnProfileAccess } from "../../domain/ownProfile";
import { DeviceSecurityContext } from "../../security/DeviceSecurityContext";

/**
 * Estado del perfil propio con una sola operacion en vuelo.
 * Descarta respuestas si la sesion cambio, el dispositivo se bloqueo o la pantalla se desmonto.
 */
export function useOwnProfile(access: OwnProfileAccess | undefined) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "avatar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef(true);
  const flight = useRef(false);
  const latest = useRef(access); latest.current = access;
  const security = useContext(DeviceSecurityContext);
  const securityRef = useRef(security); securityRef.current = security;
  const scopeKey = access?.scopeKey;
  const current = (key: string | undefined): boolean => active.current && key !== undefined && latest.current?.scopeKey === key && (securityRef.current?.isUnlocked() ?? true);

  async function run(kind: "load" | "save" | "avatar", action: (current: OwnProfileAccess) => Promise<OwnProfile>, success?: string): Promise<boolean> {
    const owner = latest.current;
    if (!owner || flight.current || !current(owner.scopeKey)) return false;
    if (!owner.available) { setError("Conéctate para consultar o actualizar tu perfil."); return false; }
    flight.current = true; setBusy(kind); setError(null); setNotice(null);
    try {
      const result = ownProfileFor(await action(owner), owner.userId);
      if (!current(owner.scopeKey)) return false;
      setProfile(result); owner.onChanged(result);
      if (success) setNotice(success);
      return true;
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : "No se pudo completar la operación del perfil.");
      return false;
    } finally { flight.current = false; if (active.current) setBusy(null); }
  }

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { setProfile(null); setError(null); setNotice(null); }, [scopeKey]);
  useEffect(() => {
    if (latest.current?.available) void run("load", owner => owner.actions.ownProfile());
  }, [scopeKey, access?.available]);

  return {
    profile, busy, error, notice,
    clearMessages: () => { setError(null); setNotice(null); },
    fail: (message: string) => { if (active.current) setError(message); },
    reload: () => run("load", owner => owner.actions.ownProfile()),
    save: (input: Parameters<OwnProfileAccess["actions"]["saveOwnProfile"]>[0]) => run("save", owner => owner.actions.saveOwnProfile(input), "Datos personales actualizados."),
    saveAvatar: (image: string) => run("avatar", owner => owner.actions.saveOwnAvatar({ image }), "Foto de perfil actualizada."),
    removeAvatar: () => run("avatar", owner => owner.actions.removeOwnAvatar(), "Foto de perfil eliminada."),
    setAvatarBusy: (value: boolean) => { if (active.current && !flight.current) setBusy(value ? "avatar" : null); },
  };
}

export type OwnProfileState = ReturnType<typeof useOwnProfile>;
