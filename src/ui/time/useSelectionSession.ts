import { useContext, useEffect, useRef, useState } from "react";
import { DeviceSecurityContext } from "../../security/DeviceSecurityContext";

export interface SelectionSession {
  id: number;
  isCurrent(): boolean;
  cancel(): void;
  commit(value: string): void;
  bindCleanup(cleanup: () => void): void;
}

export interface SelectionFieldProps {
  value: string;
  scopeKey: string;
  disabled?: boolean;
  onChange(value: string): void;
}

export function useSelectionSession(props: SelectionFieldProps) {
  const security = useContext(DeviceSecurityContext);
  const latest = useRef({ props, security });
  latest.current = { props, security };
  const mounted = useRef(true);
  const active = useRef<(SelectionSession & { dispose(): void }) | null>(null);
  const sequence = useRef(0);
  const [session, setSession] = useState<SelectionSession | null>(null);
  const identity = JSON.stringify([props.scopeKey, props.value, Boolean(props.disabled)]);
  const revision = useRef({ identity, controller: security?.controller, token: Symbol() });
  if (revision.current.identity !== identity || revision.current.controller !== security?.controller) {
    revision.current = { identity, controller: security?.controller, token: Symbol() };
  }

  function allowed(): boolean {
    const current = latest.current;
    return mounted.current && !current.props.disabled && Boolean(current.security && !current.security.blocked
      && current.security.isUnlocked() && current.security.controller.getSnapshot().foreground);
  }

  function cancel(): void {
    const previous = active.current;
    active.current = null;
    previous?.dispose();
    if (mounted.current) setSession(null);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, []);
  useEffect(() => {
    cancel();
    return cancel;
  }, [identity, security?.controller]);
  useEffect(() => {
    if (!allowed()) cancel();
    return security?.controller.subscribe(() => { if (!allowed()) cancel(); });
  }, [security?.controller, security?.blocked]);

  function open(): void {
    if (!allowed() || active.current) return;
    const token = revision.current.token;
    let cleanup = () => {};
    const next: SelectionSession & { dispose(): void } = {
      id: ++sequence.current,
      isCurrent: () => active.current === next && revision.current.token === token && allowed(),
      cancel: () => { if (active.current === next) cancel(); },
      dispose: () => cleanup(),
      bindCleanup: (dispose) => { if (next.isCurrent()) cleanup = dispose; else dispose(); },
      commit: (value) => {
        if (!next.isCurrent()) return;
        cancel();
        latest.current.props.onChange(value);
      },
    };
    active.current = next;
    setSession(next);
  }

  return { session: session?.isCurrent() ? session : null, open, disabled: !allowed() };
}