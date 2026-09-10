import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type { Tenant } from "../domain/models";
import { Brand } from "./components";
import { palette } from "./theme";

export function SessionContextBar({ tenant, branchName, showBrand = true, children }: { tenant: Tenant; branchName: string; showBrand?: boolean; children?: ReactNode }) {
  if (!showBrand && !children) return null;
  return <View style={styles.bar}>
    {showBrand ? <View accessible accessibilityLabel={`Empresa: ${tenant.name}. Sucursal: ${branchName}`}><Brand tenant={tenant} compact showTag={false} singleLine /></View> : null}
    {children}
  </View>;
}
const styles = StyleSheet.create({
  bar: { backgroundColor: palette.primarySoft, paddingVertical: 2, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: palette.border },
});