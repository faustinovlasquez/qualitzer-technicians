import { useEffect, useState } from "react";
import { Platform, Text } from "react-native";
import { createAndroidTimeDialog, TIME_PICKER_UNAVAILABLE } from "./androidTimeDialog";
import { SelectionModal, timeStyles } from "./SelectorUi";
import { clockFromPickerDate, clockPickerDate, parseClock } from "./timeValues";
import type { TimePickerPanelProps } from "./TimePickerPanel";

const openAndroidTimeDialog = createAndroidTimeDialog();

function loadNativePicker(): typeof import("@react-native-community/datetimepicker") | null {
  try { return require("@react-native-community/datetimepicker"); }
  catch { return null; }
}

export function TimePickerPanel(props: TimePickerPanelProps) {
  return Platform.OS === "android" ? <AndroidTimePicker {...props} /> : <IosTimePicker {...props} />;
}

function AndroidTimePicker({ value, session, onConfirm, onError }: TimePickerPanelProps) {
  useEffect(() => {
    if (!session.isCurrent()) return;
    const picker = loadNativePicker();
    if (!picker) { onError(TIME_PICKER_UNAVAILABLE); return; }
    const cancel = openAndroidTimeDialog(picker.DateTimePickerAndroid, {
      value, isCurrent: session.isCurrent, onConfirm, onCancel: session.cancel, onError,
    });
    session.bindCleanup(cancel);
    return cancel;
  }, [session]);
  return null;
}

function IosTimePicker({ label, value, session, onConfirm, onError }: TimePickerPanelProps) {
  const [date, setDate] = useState(() => clockPickerDate(value));
  const [picker] = useState(() => session.isCurrent() ? loadNativePicker() : null);
  useEffect(() => { if (!picker && session.isCurrent()) onError(TIME_PICKER_UNAVAILABLE); }, [picker, session]);
  if (!picker) return null;
  const DateTimePicker = picker.default;
  return <SelectionModal title={label} onCancel={session.cancel} onConfirm={() => {
    const result = clockFromPickerDate(date);
    if (session.isCurrent() && result) onConfirm(result);
  }}>
    {!parseClock(value) ? <Text style={timeStyles.hint}>El valor anterior solo se reemplaza al confirmar una hora.</Text> : null}
    <DateTimePicker value={date} mode="time" display="spinner" minuteInterval={1} locale="es_ES"
      accessibilityLabel={label} onValueChange={(_event, next) => { if (session.isCurrent() && clockFromPickerDate(next)) setDate(next); }} />
  </SelectionModal>;
}