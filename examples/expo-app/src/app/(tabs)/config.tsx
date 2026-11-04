// Every playground option, applied live. New options get a section here.
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlayground } from "@/PlaygroundProvider";
import { LOCALES, TITLE_FONTS, type PlaygroundSettings } from "@/playground";

type ModuleName = keyof PlaygroundSettings["modules"];
const MODULE_NAMES: ModuleName[] = [
  "polls",
  "inbox",
  "reaction",
  "translation",
  "images",
  "streaks",
];

export default function ConfigTab() {
  const insets = useSafeAreaInsets();
  const { settings, update, reset } = usePlayground();

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.h1}>Config</Text>

      <Section title="Modules">
        {MODULE_NAMES.map((name) => (
          <Row key={name} label={name}>
            <Switch
              value={settings.modules[name]}
              onValueChange={(on) => update({ modules: { ...settings.modules, [name]: on } })}
            />
          </Row>
        ))}
      </Section>

      <Section title="Locale">
        <Chips
          options={LOCALES}
          value={settings.locale}
          onChange={(locale) => update({ locale })}
        />
      </Section>

      <Section title="Colors">
        {(["accent", "background"] as const).map((name) => (
          <Row key={name} label={name}>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              defaultValue={settings.colors[name]}
              onEndEditing={(e) =>
                update({ colors: { ...settings.colors, [name]: e.nativeEvent.text } })
              }
            />
          </Row>
        ))}
      </Section>

      <Section title="Typography">
        <Text style={styles.hint}>Title font</Text>
        <Chips
          options={["Default", ...TITLE_FONTS]}
          value={settings.typography.titleFont ?? "Default"}
          onChange={(font) =>
            update({
              typography: { ...settings.typography, titleFont: font === "Default" ? null : font },
            })
          }
        />
        <Text style={styles.hint}>Body size</Text>
        <Chips
          options={["13", "15", "17", "19"]}
          value={String(settings.typography.bodySize)}
          onChange={(size) =>
            update({ typography: { ...settings.typography, bodySize: Number(size) } })
          }
        />
      </Section>

      <Pressable style={styles.reset} onPress={reset}>
        <Text style={styles.resetText}>Reset everything</Text>
      </Pressable>
    </ScrollView>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T | string;
  onChange(value: T): void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.chip, option === value && styles.chipOn]}
        >
          <Text style={[styles.chipText, option === value && styles.chipTextOn]}>{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 24 },
  h1: { fontSize: 28, fontWeight: "700" },
  h2: { fontSize: 13, fontWeight: "600", color: "#6B6B73", textTransform: "uppercase" },
  section: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
  },
  label: { fontSize: 16 },
  hint: { fontSize: 14, color: "#6B6B73" },
  input: {
    minWidth: 120,
    borderWidth: 1,
    borderColor: "#D5D5DA",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 15,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#D5D5DA",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: "#16161A", borderColor: "#16161A" },
  chipText: { fontSize: 14 },
  chipTextOn: { color: "#FFFFFF" },
  reset: { alignSelf: "flex-start", paddingVertical: 8 },
  resetText: { color: "#D14343", fontSize: 16 },
});
