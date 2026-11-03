import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { C, teacherColor } from "../../lib/theme";
import {
  useTeachers,
  useSubjects,
  useGradeLevels,
  useTeacherMutations,
  type Teacher,
} from "../../lib/hooks";

export default function TeachersScreen() {
  const teachers = useTeachers();
  const subjects = useSubjects();
  const gradeLevels = useGradeLevels();
  const { save, remove, clearAll } = useTeacherMutations();
  const [editing, setEditing] = useState<Partial<Teacher> | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<number | "all" | "none">("all");
  const [sortBy, setSortBy] = useState<"name" | "subject" | "load">("name");
  const teacherCount = teachers.data?.length ?? 0;

  const subjName = (id: number) => subjects.data?.find((s) => s.id === id)?.name ?? "";
  const visibleTeachers = (() => {
    let list = [...(teachers.data ?? [])];
    if (subjectFilter === "none") list = list.filter((t) => (t.subjectIds ?? []).length === 0);
    else if (subjectFilter !== "all") list = list.filter((t) => (t.subjectIds ?? []).includes(subjectFilter));
    list.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "load") return (b.maxLoad ?? 0) - (a.maxLoad ?? 0);
      return (subjName(a.subjectIds?.[0] ?? -1) || "~").localeCompare(subjName(b.subjectIds?.[0] ?? -1) || "~");
    });
    return list;
  })();
  const sortLabel = sortBy === "name" ? "Name" : sortBy === "load" ? "Max load" : "Subject";
  const promptSort = () =>
    Alert.alert("Sort by", undefined, [
      { text: "Name", onPress: () => setSortBy("name") },
      { text: "Subject", onPress: () => setSortBy("subject") },
      { text: "Max load", onPress: () => setSortBy("load") },
      { text: "Cancel", style: "cancel" },
    ]);
  const handleClearAll = () =>
    Alert.alert(
      "Delete all teachers?",
      `This will permanently remove all ${teacherCount} teachers and unassign them from any classes.\nThis cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete all", style: "destructive", onPress: () => clearAll.mutate() },
      ],
    );

  if (teachers.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator color={C.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 90 }}>
        {teacherCount > 0 && (
          <TouchableOpacity style={styles.clearAllBar} onPress={handleClearAll}>
            <Ionicons name="trash-outline" size={16} color={C.danger} />
            <Text style={styles.clearAllText}>Delete all ({teacherCount})</Text>
          </TouchableOpacity>
        )}
        {teacherCount > 0 && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, flexShrink: 0 }}
              contentContainerStyle={{ gap: 8, alignItems: "center", paddingRight: 8 }}
            >
              {[{ v: "all" as const, l: "All" }, { v: "none" as const, l: "Unassigned" }, ...(subjects.data ?? []).map((s) => ({ v: s.id, l: s.name }))].map((o) => {
                const on = subjectFilter === o.v;
                return (
                  <TouchableOpacity key={String(o.v)} style={[styles.filterChip, on && styles.filterChipOn]} onPress={() => setSubjectFilter(o.v)}>
                    <Text numberOfLines={1} style={[styles.filterChipText, on && styles.filterChipTextOn]}>{o.l}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.sortRow}>
              <TouchableOpacity style={styles.sortBtn} onPress={promptSort}>
                <Ionicons name="swap-vertical" size={15} color={C.brand} />
                <Text style={styles.sortBtnText}>Sort: {sortLabel}</Text>
              </TouchableOpacity>
              <Text style={styles.countText}>{visibleTeachers.length} of {teacherCount}</Text>
            </View>
          </>
        )}
        {(teachers.data ?? []).length === 0 && (
          <View style={styles.center}>
            <Ionicons name="people-outline" size={48} color={C.sage} />
            <Text style={styles.emptyText}>No teachers yet. Tap + to add one.</Text>
          </View>
        )}
        {teacherCount > 0 && visibleTeachers.length === 0 && (
          <View style={styles.center}>
            <Ionicons name="people-outline" size={40} color={C.sage} />
            <Text style={styles.emptyText}>No teachers match this filter.</Text>
          </View>
        )}
        {visibleTeachers.map((t) => {
          const subs = (t.subjectIds ?? [])
            .map((id) => subjects.data?.find((s) => s.id === id)?.name)
            .filter(Boolean);
          return (
            <View key={t.id} style={styles.card}>
              <View style={[styles.dot, { backgroundColor: teacherColor(t.subjectIds, subjects.data) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{t.name}</Text>
                {t.email ? <Text style={styles.meta}>{t.email}</Text> : null}
                <Text style={styles.meta}>
                  {subs.length ? subs.join(" · ") : "No subjects assigned"}
                </Text>
                {t.maxLoad != null ? (
                  <Text style={styles.meta}>Max load: {t.maxLoad}</Text>
                ) : null}
                <Text style={styles.meta}>
                  {(t.gradeLevelIds ?? []).length
                    ? "Grades: " + (t.gradeLevelIds ?? []).map((id) => gradeLevels.data?.find((g) => g.id === id)?.name).filter(Boolean).join(" · ")
                    : "Grades: All"}
                </Text>
              </View>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setEditing(t)}>
                <Ionicons name="create-outline" size={20} color={C.brand} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() =>
                  Alert.alert("Delete teacher", `Remove ${t.name}?`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => remove.mutate(t.id) },
                  ])
                }
              >
                <Ionicons name="trash-outline" size={20} color={C.danger} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setEditing({ subjectIds: [], gradeLevelIds: [] })}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {editing && (
        <TeacherModal
          teacher={editing}
          subjects={subjects.data ?? []}
          gradeLevels={gradeLevels.data ?? []}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(t) => save.mutate(t, { onSuccess: () => setEditing(null) })}
        />
      )}
    </SafeAreaView>
  );
}

function TeacherModal({
  teacher,
  subjects,
  gradeLevels,
  saving,
  onClose,
  onSave,
}: {
  teacher: Partial<Teacher>;
  subjects: { id: number; name: string }[];
  gradeLevels: { id: number; name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (t: any) => void;
}) {
  const [name, setName] = useState(teacher.name ?? "");
  const [email, setEmail] = useState(teacher.email ?? "");
  const [maxLoad, setMaxLoad] = useState(teacher.maxLoad != null ? String(teacher.maxLoad) : "");
  const [subjectIds, setSubjectIds] = useState<number[]>(teacher.subjectIds ?? []);
  const [gradeLevelIds, setGradeLevelIds] = useState<number[]>(teacher.gradeLevelIds ?? []);

  const toggle = (id: number) =>
    setSubjectIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleGrade = (id: number) =>
    setGradeLevelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{teacher.id ? "Edit Teacher" : "Add Teacher"}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={C.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 480 }}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Maria Santos"
              placeholderTextColor={C.muted}
            />
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email ?? ""}
              onChangeText={setEmail}
              placeholder="optional"
              placeholderTextColor={C.muted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.label}>Max load (periods/week)</Text>
            <TextInput
              style={styles.input}
              value={maxLoad}
              onChangeText={setMaxLoad}
              placeholder="optional"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
            />
            <Text style={styles.label}>Subjects</Text>
            <View style={styles.chipWrap}>
              {subjects.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, subjectIds.includes(s.id) && { backgroundColor: C.brand, borderColor: C.brand }]}
                  onPress={() => toggle(s.id)}
                >
                  <Text style={[styles.chipText, subjectIds.includes(s.id) && { color: "#fff" }]}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Grade levels (none = all)</Text>
            <View style={styles.chipWrap}>
              {gradeLevels.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.chip, gradeLevelIds.includes(g.id) && { backgroundColor: C.brand, borderColor: C.brand }]}
                  onPress={() => toggleGrade(g.id)}
                >
                  <Text style={[styles.chipText, gradeLevelIds.includes(g.id) && { color: "#fff" }]}>{g.name}</Text>
                </TouchableOpacity>
              ))}
              {gradeLevels.length === 0 && <Text style={styles.meta}>No grade levels defined yet.</Text>}
            </View>
          </ScrollView>
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 18, opacity: !name.trim() || saving ? 0.5 : 1 }]}
            disabled={!name.trim() || saving}
            onPress={() =>
              onSave({
                ...(teacher.id ? { id: teacher.id } : {}),
                name: name.trim(),
                email: email?.trim() || null,
                maxLoad: maxLoad ? Number(maxLoad) : null,
                subjectIds,
                gradeLevelIds,
              })
            }
          >
            <Text style={styles.primaryBtnText}>{saving ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { fontSize: 15, fontWeight: "700", color: C.text },
  meta: { fontSize: 12, color: C.muted, marginTop: 2 },
  iconBtn: { padding: 6 },
  fab: { position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: C.brand, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  clearAllBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.danger, borderRadius: 10, paddingVertical: 9 },
  filterChip: { flexShrink: 0, height: 34, justifyContent: "center", paddingHorizontal: 14, borderRadius: 17, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipOn: { backgroundColor: C.brand, borderColor: C.brand },
  filterChipText: { fontSize: 13, fontWeight: "600", color: C.brand },
  filterChipTextOn: { color: "#fff" },
  sortRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4 },
  sortBtnText: { fontSize: 13, fontWeight: "600", color: C.brand },
  countText: { fontSize: 12, color: C.muted },
  clearAllText: { color: C.danger, fontWeight: "700", fontSize: 13.5 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  label: { fontSize: 13, fontWeight: "700", color: C.text, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.text },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  chipText: { color: C.text, fontSize: 13, fontWeight: "600" },
  primaryBtn: { backgroundColor: C.brand, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
