import { createContext, useContext } from "react";
import { Modal as NativeModal, View, type ModalProps } from "react-native";
import type { DeviceLockController } from "./DeviceLockController";
import type { DeviceLockSnapshot, TrustedNativePicker } from "./contracts";

export interface DeviceSecurityUi {
  controller: DeviceLockController;
  state: DeviceLockSnapshot;
  blocked: boolean;
  isUnlocked(): boolean;
  runTrustedNativePicker?: TrustedNativePicker;
  nativePickerActive?: boolean;
}

export const DeviceSecurityContext = createContext<DeviceSecurityUi | null>(null);

const directPicker: TrustedNativePicker = operation => operation();
const unavailablePicker: TrustedNativePicker = async () => { throw new Error("TRUSTED_NATIVE_PICKER_PROVIDER_REQUIRED"); };

export function useTrustedNativePicker(): TrustedNativePicker {
  const context = useContext(DeviceSecurityContext);
  return context === null ? directPicker : context.runTrustedNativePicker ?? unavailablePicker;
}

export function useDeviceSecurity(): DeviceSecurityUi {
  const context = useContext(DeviceSecurityContext);
  if (!context) throw new Error("DEVICE_SECURITY_PROVIDER_REQUIRED");
  return context;
}

export function PrivateModal(props: ModalProps) {
  const security = useContext(DeviceSecurityContext);
  const blocked = security?.blocked ?? false;
  const retainPicker = security?.nativePickerActive === true;
  return <NativeModal {...props} animationType={blocked ? "none" : props.animationType} visible={(props.visible ?? true) && (!blocked || retainPicker)} onRequestClose={blocked ? () => {} : props.onRequestClose}>
    <View style={{ flex: 1, backgroundColor: blocked ? "#F5F7FA" : undefined }}>
      <View style={[{ flex: 1 }, blocked && { display: "none" }]} pointerEvents={blocked ? "none" : "auto"}
        accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}>
        {props.children}
      </View>
    </View>
  </NativeModal>;
}