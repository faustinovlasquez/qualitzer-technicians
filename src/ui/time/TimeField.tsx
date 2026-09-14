import { useState } from "react";
import { SelectorTrigger, type SelectorPresentation } from "./SelectorUi";
import { TimePickerPanel } from "./TimePickerPanel";
import { parseClock } from "./timeValues";
import { useSelectionSession, type SelectionFieldProps } from "./useSelectionSession";

export interface TimeFieldProps extends SelectionFieldProps, SelectorPresentation {}

export function TimeField(props: TimeFieldProps) {
  const selection = useSelectionSession(props);
  const [pickerError, setPickerError] = useState<string | null>(null);
  return <>
    <SelectorTrigger {...props} icon="time-outline" disabled={selection.disabled}
      error={props.error ?? pickerError} onPress={() => { setPickerError(null); selection.open(); }} />
    {selection.session ? <TimePickerPanel key={selection.session.id} label={props.label} value={props.value} session={selection.session}
      onError={(message) => { if (selection.session?.isCurrent()) { selection.session.cancel(); setPickerError(message); } }}
      onConfirm={(value) => { if (parseClock(value)) selection.session?.commit(value); }} /> : null}
  </>;
}