import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../../lib/theme";
import { useConflicts, useSections, useAutofill, useEntryMutations, useLocked, type Conflict } from "../../lib/hooks";

export default function ConflictsScreen() {
  const conflicts = useConflicts();
  const sections = useSections();
  const autofill = useAutofill();
  const { bulk, clear } = useEntryMutations();
  const [redoing, setRedoing] = useState(false);
  const locked = useLocked();

  const { errors, warnings, doubleBookings } = useMemo(() => {
    const all = conflicts.data?.conflicts ?? [];
    return {
      errors: all.filter((c) => c.severity === "error"),
      warnings: all.filter((c) => c.severity === "warning"),
      doubleBookings: all.filter(
        (c) => c.type === "teacher_double" || c.type === "section_double" || c.type === "room_double",
      ),
    };
  }, [conflicts.data]);

  const redoAutofill = () => {
    const ids = (sections.data ?? []).map((s) => s.id);
    if (!ids.length) return;
    Alert.alert(
      "Redo auto-fill?",
      "This clears every section and rebuilds a clash-free schedule. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Rebuild",
          style: "destructive",
          onPress: async () => {
            setRedoing(true);
            try {
              await clear.mutateAsync(undefined);
              const res = await autofill.mutateAsync(ids);
              await bulk.mutateAsync(res.suggestions);
            } finally {
              setRedoing(false);
            }
          },
        },
      ],
    );
  };

  const sectionName = (id?: number) =>
    id != null ? sections.data?.find((s) => s.id === id)?.name : undefined;

  if (conflicts.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator color={C.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const total = errors.length + warnings.length;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={conflicts.isFetching} onRefresh={() => conflicts.refetch()} tintColor={C.brand} />
        }
      >
        {total === 0 ? (
          <View style={styles.center}>
            <Ionicons name="checkmark-circle" size={64} color={C.bright} />
            <Text style={styles.cleanTitle}>No conflicts</Text>
            <Text style={styles.cleanText}>Your schedule is clean. Pull down to recheck.</Text>
          </View>
        ) : (
          <>
            <View style={styles.summary}>
              <Badge count={errors.length} color={C.danger} label="Errors" />
              <Badge count={warnings.length} color={C.warning} label="Warnings" />
            </View>

            {doubleBookings.length > 0 && !locked && (
              <View style={styles.redoBox}>
                <Text style={styles.redoMsg}>
                  {doubleBookings.length} double-booking{doubleBookings.length !== 1 ? "s" : ""} found.
                </Text>
                <TouchableOpacity
                  style={[styles.redoBtn, redoing && { opacity: 0.6 }]}
                  onPress={redoAutofill}
                  disabled={redoing}
                >
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.redoBtnText}>{redoing ? "Rebuilding…" : "Redo auto-fill (all)"}</Text>
                </TouchableOpacity>
                <Text style={styles.redoHint}>Clears every section and rebuilds a clash-free schedule.</Text>
              </View>
            )}

            {errors.length > 0 && (
              <Section title="Errors">
                {errors.map((c, i) => (
                  <ConflictCard key={`e${i}`} c={c} section={sectionName(c.sectionId)} />
                ))}
              </Section>
            )}
            {warnings.length > 0 && (
              <Section title="Warnings">
                {warnings.map((c, i) => (
                  <ConflictCard key={`w${i}`} c={c} section={sectionName(c.sectionId)} />
                ))}
              </Section>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Badge({ count, color, label }: { count: number; color: string; label: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeCount, { color }]}>{count}</Text>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ConflictCard({ c, section }: { c: Conflict; section?: string }) {
  const isError = c.severity === "error";
  const color = isError ? C.danger : C.warning;
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Ionicons
        name={isError ? "close-circle" : "alert-circle"}
        size={22}
        color={color}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.cardMsg}>{c.message}</Text>
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{c.type}</Text>
          {section ? <Text style={styles.tag}>{section}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center", padding: 40, gap: 8, marginTop: 40 },
  cleanTitle: { fontSize: 20, fontWeight: "800", color: C.text },
  cleanText: { color: C.muted, textAlign: "center" },
  summary: { flexDirection: "row", gap: 12 },
  redoBox: { backgroundColor: "#FDECEC", borderWidth: 1, borderColor: "#F5C2C2", borderRadius: 12, padding: 14, gap: 8 },
  redoMsg: { fontSize: 13, color: C.danger, fontWeight: "700" },
  redoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.danger, paddingVertical: 11, borderRadius: 10 },
  redoBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  redoHint: { fontSize: 11, color: C.muted },
  badge: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 14, alignItems: "center", backgroundColor: C.card },
  badgeCount: { fontSize: 26, fontWeight: "800" },
  badgeLabel: { fontSize: 12, color: C.muted, fontWeight: "600", marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: C.text, marginTop: 6 },
  card: { flexDirection: "row", gap: 10, backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, borderLeftWidth: 4 },
  cardMsg: { fontSize: 14, color: C.text, fontWeight: "600", lineHeight: 19 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  tag: { fontSize: 11, color: C.muted, backgroundColor: C.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
});
