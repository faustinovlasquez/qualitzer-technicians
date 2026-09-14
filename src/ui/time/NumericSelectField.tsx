import { useState } from "react";
import { Text, View } from "react-native";
import { Button, IconButton } from "../components";
import { SelectionChip, SelectionModal, SelectorTrigger, timeStyles, type SelectorPresentation } from "./SelectorUi";
import { dayOffsetLabel, parseSelectionNumber } from "./timeValues";
import { useSelectionSession, type SelectionFieldProps, type SelectionSession } from "./useSelectionSession";

export interface NumericSelectFieldProps extends SelectionFieldProps, SelectorPresentation {
  max: 30 | 59 | 99;
  dayOffset?: boolean;
}

export function NumericSelectField(props: NumericSelectFieldProps) {
  const selection = useSelectionSession({ ...props, scopeKey: `${props.scopeKey}:${props.max}:${Boolean(props.dayOffset)}` });
  const selected = parseSelectionNumber(props.value, props.max);
  const display = props.dayOffset && selected !== null ? dayOffsetLabel(selected) : props.value;
  return <>
    <SelectorTrigger {...props} value={display} icon="options-outline" disabled={selection.disabled} onPress={selection.open} />
    {selection.session ? <NumericSelection key={selection.session.id} {...props} session={selection.session} /> : null}
  </>;
}

function NumericSelection({ label, value, max, dayOffset, session }: NumericSelectFieldProps & { session: SelectionSession }) {
  const [selected, setSelected] = useState(() => parseSelectionNumber(value, max));
  function choose(next: number): void {
    if (session.isCurrent() && Number.isInteger(next) && next >= 0 && next <= max) setSelected(next);
  }
  return <SelectionModal title={label} onCancel={session.cancel} canConfirm={selected !== null} onConfirm={() => {
    if (selected !== null) session.commit(String(selected));
  }}>
    {parseSelectionNumber(value, max) === null ? <Text style={timeStyles.hint}>Valor anterior: {value || "vacío"}. Elige un valor; no cambia hasta confirmar.</Text> : null}
    {dayOffset ? <View style={timeStyles.grid}>{[0, 1].map((number) => <SelectionChip key={number} label={dayOffsetLabel(number)}
      selected={selected === number} onPress={() => choose(number)} />)}</View> : null}
    <Text style={timeStyles.hint}>{dayOffset ? "Para más días, usa los botones − y +. Una hora de término menor no añade un día automáticamente." : `Selecciona de 0 a ${max}, sin escribir.`}</Text>
    <View style={timeStyles.stepper}>
      <IconButton name="remove" label={`Reducir ${label}`} disabled={selected === null || selected === 0} onPress={() => { if (selected !== null) choose(selected - 1); }} />
      <Text accessibilityLiveRegion="polite" style={timeStyles.number}>{selected === null ? "Sin seleccionar" : dayOffset ? dayOffsetLabel(selected) : String(selected)}</Text>
      <IconButton name="add" label={`Aumentar ${label}`} disabled={selected === max} onPress={() => choose(selected === null ? 0 : selected + 1)} />
    </View>
    {!dayOffset ? <Button title="Elegir cero" variant="ghost" onPress={() => choose(0)} /> : null}
  </SelectionModal>;
}

export function DayOffsetField(props: SelectionFieldProps & SelectorPresentation) {
  return <NumericSelectField {...props} max={30} dayOffset />;
}