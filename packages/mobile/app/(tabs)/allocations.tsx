import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../../lib/theme";
import {
  useGradeLevels,
  useSubjects,
  useAllocations,
  useAllocationMutations,
} from "../../lib/hooks";

export default function AllocationsScreen() {
  const grades = useGradeLevels();
  const subjects = useSubjects();
  const allocations = useAllocations();
  const { set, clearAll } = useAllocationMutations();

  const [activeGrade, setActiveGrade] = useState<number | null>(null);
  const allocCount = allocations.data?.filter((a) => a.periodsPerWeek > 0).length ?? 0;
  const handleClearAll = () =>
    Alert.alert(
      "Reset all allocations?",
      `This will clear all ${allocCount} subject allocations back to 0 periods/week.\nThis cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset all", style: "destructive", onPress: () => clearAll.mutate() },
      ],
    );

  const loading = grades.isLoading || subjects.isLoading || allocations.isLoading;
  const gradeId = activeGrade ?? grades.data?.[0]?.id ?? null;

  const get = (g: number, s: number) =>
    allocations.data?.find((a) => a.gradeLevelId === g && a.subjectId === s)?.periodsPerWeek ?? 0;

  const total = useMemo(() => {
    if (gradeId == null) return 0;
    return (subjects.data ?? []).reduce((sum, s) => sum + get(gradeId, s.id), 0);
  }, [allocations.data, subjects.data, gradeId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator color={C.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const noData = (grades.data?.length ?? 0) === 0 || (subjects.data?.length ?? 0) === 0;
  if (noData) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <Ionicons name="speedometer-outline" size={52} color={C.sage} />
          <Text style={styles.emptyTitle}>Need grades & subjects</Text>
          <Text style={styles.emptyText}>
            Add grade levels and subjects in Setup / Subjects, then set how many periods per week each subject needs here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const step = (subjectId: number, delta: number) => {
    if (gradeId == null) return;
    const next = Math.max(0, Math.min(40, get(gradeId, subjectId) + delta));
    set.mutate({ gradeLevelId: gradeId, subjectId, periodsPerWeek: next });
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* Grade switcher */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillRow}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: "center", height: 56 }}
      >
        {(grades.data ?? []).map((g) => {
          const active = g.id === gradeId;
          return (
            <TouchableOpacity
              key={g.id}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => setActiveGrade(g.id)}
            >
              <Text numberOfLines={1} style={[styles.pillText, active && styles.pillTextActive]}>{g.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.totalBar}>
        <Text style={styles.totalLabel}>Periods / week</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {allocCount > 0 && (
            <TouchableOpacity style={styles.resetBtn} onPress={handleClearAll}>
              <Ionicons name="trash-outline" size={15} color={C.danger} />
              <Text style={styles.resetText}>Reset all</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.totalValue}>{total}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 40 }}>
        {(subjects.data ?? []).map((s) => {
          const val = gradeId != null ? get(gradeId, s.id) : 0;
          return (
            <View key={s.id} style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: s.color || C.mid }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.subjName}>{s.name}</Text>
                {s.code ? <Text style={styles.subjCode}>{s.code}</Text> : null}
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={[styles.stepBtn, val === 0 && styles.stepBtnDisabled]}
                  disabled={val === 0}
                  onPress={() => step(s.id, -1)}
                >
                  <Ionicons name="remove" size={20} color={val === 0 ? C.muted : C.brand} />
                </TouchableOpacity>
                <Text style={styles.stepVal}>{val}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => step(s.id, 1)}>
                  <Ionicons name="add" size={20} color={C.brand} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        <Text style={styles.hint}>
          Sets target periods per week per grade. Drives auto-fill and over/under-allocation warnings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginTop: 6 },
  emptyText: { color: C.muted, textAlign: "center", lineHeight: 20 },
  pillRow: { flexGrow: 0, flexShrink: 0, height: 56, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  pill: { flexShrink: 0, height: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  pillActive: { backgroundColor: C.brand, borderColor: C.brand },
  pillText: { color: C.text, fontWeight: "600", fontSize: 13 },
  pillTextActive: { color: "#fff" },
  totalBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.sage + "55", paddingHorizontal: 18, paddingVertical: 10 },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.danger, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  resetText: { color: C.danger, fontWeight: "700", fontSize: 12.5 },
  totalLabel: { fontWeight: "700", color: C.forest, fontSize: 13 },
  totalValue: { fontWeight: "800", color: C.forest, fontSize: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border },
  swatch: { width: 14, height: 34, borderRadius: 4 },
  subjName: { fontSize: 15, fontWeight: "700", color: C.text },
  subjCode: { fontSize: 12, color: C.muted, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  stepBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  stepBtnDisabled: { opacity: 0.5 },
  stepVal: { width: 36, textAlign: "center", fontSize: 17, fontWeight: "800", color: C.text },
  hint: { color: C.muted, fontSize: 12, textAlign: "center", marginTop: 12, lineHeight: 18, paddingHorizontal: 10 },
});
