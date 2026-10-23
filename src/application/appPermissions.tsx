import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ALL_APP_PERMISSIONS, isAppPermissionAllowed, type MobileAppConfig, type MobileAppPermission } from "../domain/mobileAppConfig";

/** Permisos de la app que configuró la sucursal en la web. Sin configuración (o sin conexión) todo queda permitido; la pasarela igual lo exige. */
const AppPermissionsContext = createContext<MobileAppConfig>(ALL_APP_PERMISSIONS);

export function AppPermissionsProvider({ value, children }: { value: MobileAppConfig; children: ReactNode }) {
  return <AppPermissionsContext.Provider value={value}>{children}</AppPermissionsContext.Provider>;
}

/** ¿La sucursal permite esta acción en la app? Las del Taller exigen además el Taller habilitado. */
export function useAppPermission(key: MobileAppPermission): boolean {
  return isAppPermissionAllowed(useContext(AppPermissionsContext), key);
}

export function useAppPermissions(): MobileAppConfig {
  return useContext(AppPermissionsContext);
}

/** Carga la configuración de la sucursal activa; se vuelve a pedir al cambiar de sesión o sucursal y al volver a la app. */
export function useBranchAppPermissions(port: { mobileAppConfig?: (branchId: number) => Promise<MobileAppConfig> } | null | undefined, branchId: number, sessionKey: string, refreshKey: unknown): MobileAppConfig {
  const [config, setConfig] = useState<MobileAppConfig>(ALL_APP_PERMISSIONS);
  useEffect(() => {
    setConfig(ALL_APP_PERMISSIONS);
    if (!port?.mobileAppConfig || branchId <= 0) return;
    let active = true;
    port.mobileAppConfig(branchId).then((value) => { if (active) setConfig(value); }, () => undefined);
    return () => { active = false; };
  }, [port, branchId, sessionKey]);
  useEffect(() => {
    if (!port?.mobileAppConfig || branchId <= 0 || refreshKey === undefined) return;
    let active = true;
    port.mobileAppConfig(branchId).then((value) => { if (active) setConfig(value); }, () => undefined);
    return () => { active = false; };
  }, [refreshKey]);
  return config;
}
