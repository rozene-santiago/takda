import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { api } from "../../lib/api";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { C, DAY_NAMES, DAY_SHORT } from "../../lib/theme";
import {
  useGradeLevels,
  useSections,
  useSubjects,
  useRooms,
  useTimeSlots,
  useBlockedTimes,
  useSettings,
  useTeachers,
  useGradeMutations,
  useSectionMutations,
  useSubjectMutations,
  useRoomMutations,
  useTimeSlotMutations,
  useBlockedTimeMutations,
  useSavePoints,
  useCreateSavePoint,
  useRestoreSavePoint,
  useDeleteSavePoint,
} from "../../lib/hooks";

const SWATCHES = [
  "#007041", "#338D67", "#00AD6D", "#1E3D32", "#2C4D46",
  "#7F5237", "#C0392B", "#D99A00", "#2E5AAC", "#7A4FB5",
];

type Tab = "grades" | "sections" | "subjects" | "periods" | "rooms" | "blocked" | "savepoints";
const TABS: { key: Tab; label: string }[] = [
  { key: "grades", label: "Grades" },
  { key: "sections", label: "Sections" },
  { key: "subjects", label: "Subjects" },
  { key: "periods", label: "Periods" },
  { key: "rooms", label: "Rooms" },
  { key: "blocked", label: "Blocked" },
  { key: "savepoints", label: "Save Points" },
];

export default function SetupScreen() {
  const [tab, setTab] = useState<Tab>("sections");
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <TouchableOpacity
        style={styles.arrangeRow}
        onPress={() => router.push("/(tabs)/tab-settings")}
      >
        <View style={styles.arrangeIcon}>
          <Ionicons name="swap-vertical-outline" size={18} color={C.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.arrangeTitle}>Arrange Tabs</Text>
          <Text style={styles.arrangeSub}>Reorder or hide bottom tabs</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.muted} />
      </TouchableOpacity>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: "center", height: 56 }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabPill, active && styles.tabPillActive]}
              onPress={() => setTab(t.key)}
            >
              <Text numberOfLines={1} style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {tab === "grades" && <GradesPane />}
      {tab === "sections" && <SectionsPane />}
      {tab === "subjects" && <SubjectsPane />}
      {tab === "periods" && <PeriodsPane />}
      {tab === "rooms" && <RoomsPane />}
      {tab === "blocked" && <BlockedPane />}
      {tab === "savepoints" && <SavePointsPane />}

      <View style={styles.copyright}>
        <Text style={styles.copyrightText}>© Copyright 2026. All Rights Reserved. | rozene.santiago</Text>
        <Text style={styles.versionText}>ver. 2.01 build 07.10.2026</Text>
      </View>
    </SafeAreaView>
  );
}

/* ---------- shared bits ---------- */
function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={C.brand} size="large" />
    </View>
  );
}
function Empty({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={46} color={C.sage} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}
function Fab({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.fab} onPress={onPress}>
      <Ionicons name="add" size={28} color="#fff" />
    </TouchableOpacity>
  );
}
function RowCard({
  title,
  subtitle,
  onEdit,
  onDelete,
  accent,
  onMoveUp,
  onMoveDown,
}: {
  title: string;
  subtitle?: string;
  onEdit?: () => void;
  onDelete: () => void;
  accent?: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const reorderable = onMoveUp !== undefined || onMoveDown !== undefined;
  return (
    <View style={styles.card}>
      {reorderable && (
        <View style={styles.reorderCol}>
          <TouchableOpacity
            style={[styles.reorderBtn, !onMoveUp && styles.reorderBtnDisabled]}
            disabled={!onMoveUp}
            onPress={onMoveUp}
          >
            <Ionicons name="chevron-up" size={16} color={onMoveUp ? C.brand : "#C4C4C4"} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reorderBtn, !onMoveDown && styles.reorderBtnDisabled]}
            disabled={!onMoveDown}
            onPress={onMoveDown}
          >
            <Ionicons name="chevron-down" size={16} color={onMoveDown ? C.brand : "#C4C4C4"} />
          </TouchableOpacity>
        </View>
      )}
      {accent ? <View style={[styles.accent, { backgroundColor: accent }]} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSub}>{subtitle}</Text> : null}
      </View>
      {onEdit && (
        <TouchableOpacity style={styles.iconBtn} onPress={onEdit}>
          <Ionicons name="create-outline" size={20} color={C.brand} />
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.iconBtn} onPress={onDelete}>
        <Ionicons name="trash-outline" size={20} color={C.danger} />
      </TouchableOpacity>
    </View>
  );
}
function confirmDelete(name: string, onYes: () => void, note?: string) {
  Alert.alert("Delete", `Remove ${name}?${note ? `\n${note}` : ""}`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onYes },
  ]);
}
function confirmClearAll(noun: string, count: number, onYes: () => void, note?: string) {
  Alert.alert(
    `Delete all ${noun}?`,
    `This will permanently remove all ${count} ${noun}.${note ? `\n${note}` : ""}\nThis cannot be undone.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete all", style: "destructive", onPress: onYes },
    ],
  );
}
// Red "Delete all" bar shown at the top of a list. Hidden when count is 0.
function ClearAllBar({ count, onPress }: { count: number; onPress: () => void }) {
  if (count <= 0) return null;
  return (
    <TouchableOpacity style={styles.clearAllBar} onPress={onPress}>
      <Ionicons name="trash-outline" size={16} color={C.danger} />
      <Text style={styles.clearAllText}>Delete all ({count})</Text>
    </TouchableOpacity>
  );
}

/* ---------- GRADES ---------- */
function GradesPane() {
  const grades = useGradeLevels();
  const { save, remove, clearAll } = useGradeMutations();
  const [editing, setEditing] = useState<any>(null);
  if (grades.isLoading) return <Loading />;
  return (
    <>
      <ScrollView contentContainerStyle={styles.list}>
        <ClearAllBar count={grades.data?.length ?? 0} onPress={() => confirmClearAll("grade levels", grades.data?.length ?? 0, () => clearAll.mutate(), "Sections, schedules & allocations under them are also removed.")} />
        {(grades.data ?? []).length === 0 && <Empty icon="school-outline" text="No grade levels yet." />}
        {(grades.data ?? []).map((g) => (
          <RowCard
            key={g.id}
            title={g.name}
            subtitle={`Order: ${g.sortOrder}`}
            onEdit={() => setEditing(g)}
            onDelete={() => confirmDelete(g.name, () => remove.mutate(g.id), "Sections under it may be affected.")}
          />
        ))}
      </ScrollView>
      <Fab onPress={() => setEditing({ name: "", sortOrder: (grades.data?.length ?? 0) + 1 })} />
      {editing && (
        <FormModal
          title={editing.id ? "Edit Grade" : "Add Grade"}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate(editing, { onSuccess: () => setEditing(null) })}
          valid={!!editing.name?.trim()}
        >
          <LabeledInput label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="e.g. Grade 7" />
          <LabeledInput label="Sort order" value={String(editing.sortOrder ?? "")} onChange={(v) => setEditing({ ...editing, sortOrder: Number(v) || 0 })} keyboardType="number-pad" />
        </FormModal>
      )}
    </>
  );
}

/* ---------- SECTIONS ---------- */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some((x) => x.trim() !== "")) rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field !== "" || cur.length) { cur.push(field); if (cur.some((x) => x.trim() !== "")) rows.push(cur); }
  return rows;
}

// Reusable CSV import bar. onRows runs the per-row import and returns {added, errors}.
function ImportBar({ hint, headerHints, disabled, onRows, onDone }: {
  hint: string;
  headerHints: string[];
  disabled?: boolean;
  onRows: (rows: string[][]) => Promise<{ added: number; errors: string[] }>;
  onDone: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const handleImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      setImporting(true);
      const text = await new File(res.assets[0].uri).text();
      const all = parseCsv(text);
      if (!all.length) { Alert.alert("Empty file", "No rows found in the CSV."); return; }
      const first = all[0].map((c) => c.trim().toLowerCase());
      const hasHeader = headerHints.some((h) => first.some((f) => f.includes(h)));
      const rows = hasHeader ? all.slice(1) : all;
      const out = await onRows(rows);
      onDone();
      Alert.alert("Import complete", `Imported ${out.added} item${out.added === 1 ? "" : "s"}.` + (out.errors.length ? `\n\nSkipped ${out.errors.length}:\n${out.errors.join("\n")}` : ""));
    } catch (e: any) {
      Alert.alert("Import failed", e?.message ?? "Could not read the file.");
    } finally {
      setImporting(false);
    }
  };
  return (
    <View style={styles.importRow}>
      <TouchableOpacity style={styles.importBtn} onPress={handleImport} disabled={disabled || importing}>
        {importing
          ? <ActivityIndicator size="small" color={C.brand} />
          : <Ionicons name="cloud-upload-outline" size={18} color={C.brand} />}
        <Text style={styles.importBtnText}>{importing ? "Importing…" : "Import CSV"}</Text>
      </TouchableOpacity>
      <Text style={styles.importHint}>{hint}</Text>
    </View>
  );
}

function SectionsPane() {
  const sections = useSections();
  const grades = useGradeLevels();
  const teachers = useTeachers();
  const { save, remove, clearAll } = useSectionMutations();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  if (sections.isLoading || grades.isLoading) return <Loading />;
  const gradeName = (id: number) => grades.data?.find((g) => g.id === id)?.name ?? "—";

  const importRows = async (rows: string[][]) => {
    const gradeByName = new Map((grades.data ?? []).map((g) => [g.name.trim().toLowerCase(), g.id]));
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const name = (r[0] ?? "").trim();
      const gName = (r[1] ?? "").trim();
      if (!name) continue;
      const gid = gradeByName.get(gName.toLowerCase());
      if (!gid) { errors.push(`"${name}" → grade "${gName}" not found`); continue; }
      await api.sections.$post({ json: { name, gradeLevelId: gid, adviser: "" } } as any);
      added++;
    }
    return { added, errors };
  };

  return (
    <>
      <ImportBar
        hint="Columns: section name, grade level"
        headerHints={["section", "grade"]}
        disabled={!grades.data?.length}
        onRows={importRows}
        onDone={() => { qc.invalidateQueries({ queryKey: ["sections"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); }}
      />
      <ScrollView contentContainerStyle={styles.list}>
        <ClearAllBar count={sections.data?.length ?? 0} onPress={() => confirmClearAll("sections", sections.data?.length ?? 0, () => clearAll.mutate(), "Their scheduled classes are also removed.")} />
        {(sections.data ?? []).length === 0 && <Empty icon="people-circle-outline" text="No sections yet. Tap + to add." />}
        {(sections.data ?? []).map((s) => (
          <RowCard
            key={s.id}
            title={s.name}
            subtitle={`${gradeName(s.gradeLevelId)}${s.adviser ? ` · ${s.adviser}` : ""}`}
            onEdit={() => setEditing(s)}
            onDelete={() => confirmDelete(s.name, () => remove.mutate(s.id), "Its scheduled classes will be removed.")}
          />
        ))}
      </ScrollView>
      <Fab
        onPress={() => {
          if (!grades.data?.length) {
            Alert.alert("Add a grade first", "Create at least one grade level before adding sections.");
            return;
          }
          setEditing({ name: "", gradeLevelId: grades.data[0].id, adviser: "" });
        }}
      />
      {editing && (
        <FormModal
          title={editing.id ? "Edit Section" : "Add Section"}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate(editing, { onSuccess: () => setEditing(null) })}
          valid={!!editing.name?.trim() && !!editing.gradeLevelId}
        >
          <LabeledInput label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="e.g. St. Joseph" />
          <Text style={styles.label}>Grade level</Text>
          <View style={styles.chipWrap}>
            {(grades.data ?? []).map((g) => (
              <TouchableOpacity
                key={g.id}
                style={[styles.chip, editing.gradeLevelId === g.id && styles.chipActive]}
                onPress={() => setEditing({ ...editing, gradeLevelId: g.id })}
              >
                <Text style={[styles.chipText, editing.gradeLevelId === g.id && styles.chipTextActive]}>{g.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Class adviser</Text>
          <View style={styles.chipWrap}>
            <TouchableOpacity
              style={[styles.chip, !editing.adviser && styles.chipActive]}
              onPress={() => setEditing({ ...editing, adviser: "" })}
            >
              <Text style={[styles.chipText, !editing.adviser && styles.chipTextActive]}>None</Text>
            </TouchableOpacity>
            {(teachers.data ?? []).map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.chip, editing.adviser === t.name && styles.chipActive]}
                onPress={() => setEditing({ ...editing, adviser: t.name })}
              >
                <Text style={[styles.chipText, editing.adviser === t.name && styles.chipTextActive]}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </FormModal>
      )}
    </>
  );
}

/* ---------- SUBJECTS ---------- */
function SubjectsPane() {
  const subjects = useSubjects();
  const { save, remove, clearAll } = useSubjectMutations();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);

  const reorder = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await Promise.all(orderedIds.map((id, i) => api.subjects[":id"].$put({ param: { id: String(id) }, json: { sortOrder: i + 1 } } as any)));
    },
    onMutate: async (orderedIds: number[]) => {
      await qc.cancelQueries({ queryKey: ["subjects"] });
      const prev = qc.getQueryData<any[]>(["subjects"]);
      if (prev) {
        const byId = new Map(prev.map((s) => [s.id, s]));
        qc.setQueryData(["subjects"], orderedIds.map((id, i) => ({ ...byId.get(id), sortOrder: i + 1 })));
      }
      return { prev };
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(["subjects"], ctx.prev); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["subjects"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); },
  });

  const move = (id: number, dir: -1 | 1) => {
    const list = subjects.data ?? [];
    const ids = list.map((s) => s.id);
    const idx = ids.indexOf(id);
    const next = idx + dir;
    if (idx === -1 || next < 0 || next >= ids.length) return;
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    reorder.mutate(ids);
  };

  if (subjects.isLoading) return <Loading />;

  const importRows = async (rows: string[][]) => {
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const name = (r[0] ?? "").trim();
      const code = (r[1] ?? "").trim();
      if (!name) continue;
      await api.subjects.$post({ json: { name, code, color: SWATCHES[added % SWATCHES.length] } } as any);
      added++;
    }
    return { added, errors };
  };

  return (
    <>
      <ImportBar
        hint="Columns: name, code"
        headerHints={["name", "code", "subject"]}
        onRows={importRows}
        onDone={() => { qc.invalidateQueries({ queryKey: ["subjects"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); }}
      />
      <ScrollView contentContainerStyle={styles.list}>
        <ClearAllBar count={subjects.data?.length ?? 0} onPress={() => confirmClearAll("subjects", subjects.data?.length ?? 0, () => clearAll.mutate(), "They are removed from schedules and allocations.")} />
        {(subjects.data ?? []).length === 0 && <Empty icon="book-outline" text="No subjects yet. Tap + to add." />}
        {(subjects.data ?? []).map((s, i, arr) => (
          <RowCard
            key={s.id}
            title={s.name}
            subtitle={s.code ?? undefined}
            accent={s.color || "#9CA3AF"}
            onEdit={() => setEditing(s)}
            onDelete={() => confirmDelete(s.name, () => remove.mutate(s.id), "Its scheduled classes will be removed.")}
            onMoveUp={i > 0 ? () => move(s.id, -1) : undefined}
            onMoveDown={i < arr.length - 1 ? () => move(s.id, 1) : undefined}
          />
        ))}
      </ScrollView>
      <Fab onPress={() => setEditing({ name: "", code: "", color: SWATCHES[1] })} />
      {editing && (
        <FormModal
          title={editing.id ? "Edit Subject" : "Add Subject"}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={() =>
            save.mutate(
              { ...editing, name: editing.name?.trim(), code: editing.code?.trim() || null },
              { onSuccess: () => setEditing(null) }
            )
          }
          valid={!!editing.name?.trim()}
        >
          <LabeledInput label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="e.g. Mathematics" />
          <LabeledInput label="Code" value={editing.code ?? ""} onChange={(v) => setEditing({ ...editing, code: v })} placeholder="optional · e.g. MATH" />
          <Text style={styles.label}>Color</Text>
          <View style={styles.swatchWrap}>
            <TouchableOpacity
              style={[styles.swatchPick, { backgroundColor: "#fff", borderColor: C.border }, !editing.color && styles.swatchActive]}
              onPress={() => setEditing({ ...editing, color: null })}
            >
              <Ionicons name="ban-outline" size={18} color="#9CA3AF" />
            </TouchableOpacity>
            {SWATCHES.map((sw) => (
              <TouchableOpacity
                key={sw}
                style={[styles.swatchPick, { backgroundColor: sw }, editing.color === sw && styles.swatchActive]}
                onPress={() => setEditing({ ...editing, color: sw })}
              >
                {editing.color === sw && <Ionicons name="checkmark" size={16} color="#fff" />}
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.hexRow}>
            <View style={[styles.hexSwatch, { backgroundColor: editing.color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(editing.color) ? editing.color : "#fff", borderColor: C.border }]} />
            <Text style={styles.hexHash}>#</Text>
            <TextInput
              style={styles.hexInput}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="338D67"
              placeholderTextColor="#9CA3AF"
              maxLength={6}
              value={(editing.color ?? "").replace(/^#/, "")}
              onChangeText={(v) => {
                const raw = v.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
                setEditing({ ...editing, color: raw ? "#" + raw : null });
              }}
            />
          </View>
        </FormModal>
      )}
    </>
  );
}

/* ---------- TIME PERIODS ---------- */
function PeriodsPane() {
  const slots = useTimeSlots();
  const { save, remove, clearAll } = useTimeSlotMutations();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);

  const normTime = (raw: string): string | null => {
    const t = raw.trim().replace(/\./g, ":");
    const m = t.match(/^(\d{1,2}):?(\d{2})?$/);
    if (!m) return null;
    const h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  };
  const importRows = async (rows: string[][]) => {
    let added = 0; const errors: string[] = [];
    const base = slots.data?.length ?? 0;
    for (const r of rows) {
      const label = (r[0] ?? "").trim();
      if (!label) continue;
      const start = normTime(r[1] ?? "");
      const end = normTime(r[2] ?? "");
      if (!start || !end) { errors.push(`"${label}" → invalid start/end time`); continue; }
      const soRaw = (r[3] ?? "").trim();
      const sortOrder = soRaw && !isNaN(Number(soRaw)) ? Number(soRaw) : base + added + 1;
      await api["time-slots"].$post({ json: { label, startTime: start, endTime: end, sortOrder, isBreak: false } } as any);
      added++;
    }
    return { added, errors };
  };

  if (slots.isLoading) return <Loading />;
  const sorted = [...(slots.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <>
      <ImportBar
        hint="Columns: Label, Start, End, Sort Order"
        headerHints={["label", "start", "end", "sort"]}
        onRows={importRows}
        onDone={() => { qc.invalidateQueries({ queryKey: ["time-slots"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); }}
      />
      <ScrollView contentContainerStyle={styles.list}>
        <ClearAllBar count={sorted.length} onPress={() => confirmClearAll("time periods", sorted.length, () => clearAll.mutate(), "Classes & blocks in them are also removed.")} />
        {sorted.length === 0 && <Empty icon="time-outline" text="No time periods yet. Tap + to add." />}
        {sorted.map((s) => (
          <RowCard
            key={s.id}
            title={`${s.label}${s.isBreak ? "  ·  Break" : ""}`}
            subtitle={`${s.startTime} – ${s.endTime}`}
            accent={s.isBreak ? C.wood : C.mid}
            onEdit={() => setEditing(s)}
            onDelete={() => confirmDelete(s.label, () => remove.mutate(s.id), "Classes in this period will be removed.")}
          />
        ))}
      </ScrollView>
      <Fab onPress={() => setEditing({ label: "", startTime: "08:00", endTime: "09:00", sortOrder: (slots.data?.length ?? 0) + 1, isBreak: false })} />
      {editing && (
        <FormModal
          title={editing.id ? "Edit Period" : "Add Period"}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={() => save.mutate(editing, { onSuccess: () => setEditing(null) })}
          valid={!!editing.label?.trim() && !!editing.startTime && !!editing.endTime}
        >
          <LabeledInput label="Label" value={editing.label} onChange={(v) => setEditing({ ...editing, label: v })} placeholder="e.g. Period 1" />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <LabeledInput label="Start (HH:MM)" value={editing.startTime} onChange={(v) => setEditing({ ...editing, startTime: v })} placeholder="08:00" />
            </View>
            <View style={{ flex: 1 }}>
              <LabeledInput label="End (HH:MM)" value={editing.endTime} onChange={(v) => setEditing({ ...editing, endTime: v })} placeholder="09:00" />
            </View>
          </View>
          <LabeledInput label="Sort order" value={String(editing.sortOrder ?? "")} onChange={(v) => setEditing({ ...editing, sortOrder: Number(v) || 0 })} keyboardType="number-pad" />
          <View style={styles.switchRow}>
            <Text style={styles.label}>Break period (not schedulable)</Text>
            <Switch
              value={!!editing.isBreak}
              onValueChange={(v) => setEditing({ ...editing, isBreak: v })}
              trackColor={{ true: C.mid, false: C.border }}
              thumbColor="#fff"
            />
          </View>
        </FormModal>
      )}
    </>
  );
}

/* ---------- ROOMS ---------- */
function RoomsPane() {
  const rooms = useRooms();
  const { save, remove, clearAll } = useRoomMutations();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  if (rooms.isLoading) return <Loading />;

  const importRows = async (rows: string[][]) => {
    let added = 0; const errors: string[] = [];
    for (const r of rows) {
      const name = (r[0] ?? "").trim();
      const capRaw = (r[1] ?? "").trim();
      if (!name) continue;
      const capacity = capRaw && !isNaN(Number(capRaw)) ? Number(capRaw) : null;
      await api.rooms.$post({ json: { name, capacity } } as any);
      added++;
    }
    return { added, errors };
  };

  return (
    <>
      <ImportBar
        hint="Columns: name, capacity"
        headerHints={["name", "capacity", "room"]}
        onRows={importRows}
        onDone={() => { qc.invalidateQueries({ queryKey: ["rooms"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); }}
      />
      <ScrollView contentContainerStyle={styles.list}>
        <ClearAllBar count={rooms.data?.length ?? 0} onPress={() => confirmClearAll("rooms", rooms.data?.length ?? 0, () => clearAll.mutate(), "They are removed from scheduled classes.")} />
        {(rooms.data ?? []).length === 0 && <Empty icon="business-outline" text="No rooms yet. Tap + to add." />}
        {(rooms.data ?? []).map((r) => (
          <RowCard
            key={r.id}
            title={r.name}
            subtitle={r.capacity != null ? `Capacity: ${r.capacity}` : undefined}
            onEdit={() => setEditing(r)}
            onDelete={() => confirmDelete(r.name, () => remove.mutate(r.id))}
          />
        ))}
      </ScrollView>
      <Fab onPress={() => setEditing({ name: "", capacity: "" })} />
      {editing && (
        <FormModal
          title={editing.id ? "Edit Room" : "Add Room"}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={() =>
            save.mutate(
              { ...editing, capacity: editing.capacity === "" || editing.capacity == null ? null : Number(editing.capacity) },
              { onSuccess: () => setEditing(null) }
            )
          }
          valid={!!editing.name?.trim()}
        >
          <LabeledInput label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="e.g. Room 201" />
          <LabeledInput label="Capacity" value={String(editing.capacity ?? "")} onChange={(v) => setEditing({ ...editing, capacity: v })} keyboardType="number-pad" placeholder="optional" />
        </FormModal>
      )}
    </>
  );
}

/* ---------- SAVE POINTS ---------- */
function SavePointsPane() {
  const points = useSavePoints();
  const create = useCreateSavePoint();
  const restore = useRestoreSavePoint();
  const del = useDeleteSavePoint();
  const [creating, setCreating] = useState<{ name: string; note: string } | null>(null);
  if (points.isLoading) return <Loading />;

  const fmt = (d: string | number | Date) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const list = points.data ?? [];

  const confirmRestore = (id: number, label: string) => {
    Alert.alert(
      "Restore this save point?",
      `This will REPLACE your entire current configuration — grades, sections, subjects, teachers, rooms, time slots, blocked times, allocations and the schedule — with the snapshot "${label}". Your current setup will be lost unless you saved it first.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Restore", style: "destructive", onPress: () => restore.mutate(id) },
      ],
    );
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.spHeader}>
          <View style={styles.spHeaderRow}>
            <View style={styles.spHeaderIcon}>
              <Ionicons name="time-outline" size={20} color={C.brand} />
            </View>
            <Text style={styles.spHeaderTitle}>Save Points</Text>
          </View>
          <Text style={styles.spHeaderDesc}>
            A save point is a full snapshot of your configuration and schedule. Restore any time to roll back to that exact state.
          </Text>
        </View>
        {list.length === 0 && <Empty icon="bookmark-outline" text="No save points yet. Tap + to create one before big changes." />}
        {list.map((sp) => (
          <View key={sp.id} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{sp.name}</Text>
              <Text style={styles.cardSub}>
                {fmt(sp.createdAt)} · {sp.sectionCount} section{sp.sectionCount !== 1 ? "s" : ""} · {sp.entryCount} class{sp.entryCount !== 1 ? "es" : ""}
              </Text>
              {sp.note ? <Text style={[styles.cardSub, { fontStyle: "italic" }]}>{sp.note}</Text> : null}
            </View>
            <TouchableOpacity style={styles.spRestoreBtn} onPress={() => confirmRestore(sp.id, sp.name)}>
              <Ionicons name="refresh-outline" size={16} color={C.brand} />
              <Text style={styles.spRestoreText}>Restore</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => confirmDelete(sp.name, () => del.mutate(sp.id))}>
              <Ionicons name="trash-outline" size={20} color={C.danger} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      <Fab onPress={() => setCreating({ name: "", note: "" })} />
      {creating && (
        <FormModal
          title="Create save point"
          saving={create.isPending}
          onClose={() => setCreating(null)}
          onSave={() => create.mutate({ name: creating.name.trim() || undefined, note: creating.note.trim() || null }, { onSuccess: () => setCreating(null) })}
          valid
        >
          <Text style={{ fontSize: 13, color: C.muted, lineHeight: 18, marginBottom: 4 }}>
            Captures grades, sections, subjects, teachers, rooms, time slots, blocked times, allocations and the full schedule.
          </Text>
          <LabeledInput label="Name (optional)" value={creating.name} onChange={(v) => setCreating({ ...creating, name: v })} placeholder={`Save ${new Date().toLocaleDateString()}`} />
          <LabeledInput label="Note (optional)" value={creating.note} onChange={(v) => setCreating({ ...creating, note: v })} placeholder="e.g. Before rebalancing Grade 8 load" />
        </FormModal>
      )}
    </>
  );
}

/* ---------- BLOCKED TIMES ---------- */
function BlockedPane() {
  const blocked = useBlockedTimes();
  const slots = useTimeSlots();
  const sections = useSections();
  const grades = useGradeLevels();
  const settings = useSettings();
  const { create, update, remove, clearAll } = useBlockedTimeMutations();
  const [adding, setAdding] = useState<any>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [filterDay, setFilterDay] = useState<number | null>(null);
  const [filterGrade, setFilterGrade] = useState<number | null>(null);
  if (blocked.isLoading || slots.isLoading) return <Loading />;

  const startEdit = (b: any) => {
    const scope = b.sectionIds?.length ? "sections" : b.gradeLevelId != null ? "grade" : "all";
    setEditId(b.id);
    setAdding({
      dayOfWeek: b.dayOfWeek,
      timeSlotIds: [b.timeSlotId],
      scope,
      gradeLevelId: b.gradeLevelId ?? grades.data?.[0]?.id ?? null,
      sectionIds: b.sectionIds ?? (b.sectionId != null ? [b.sectionId] : []),
      reason: b.reason ?? "",
    });
  };

  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const slotLabel = (id: number) => slots.data?.find((s) => s.id === id)?.label ?? `#${id}`;
  const sectionName = (id: number) => sections.data?.find((s) => s.id === id)?.name ?? "—";
  const gradeName = (id: number) => grades.data?.find((g) => g.id === id)?.name ?? "—";
  const scopeLabel = (b: any) => {
    if (b.sectionIds?.length) return b.sectionIds.map(sectionName).join(", ");
    if (b.gradeLevelId != null) return gradeName(b.gradeLevelId);
    if (b.sectionId != null) return sectionName(b.sectionId);
    return "All sections";
  };

  const blockMatchesGrade = (b: any, gid: number) => {
    if (b.gradeLevelId != null) return b.gradeLevelId === gid;
    if (b.sectionIds?.length) return b.sectionIds.some((sid: number) => sections.data?.find((s) => s.id === sid)?.gradeLevelId === gid);
    if (b.sectionId != null) return sections.data?.find((s) => s.id === b.sectionId)?.gradeLevelId === gid;
    return true; // "all sections" block applies to every grade
  };
  const all = blocked.data ?? [];
  const filtered = all.filter((b: any) =>
    (filterDay == null || b.dayOfWeek === filterDay) &&
    (filterGrade == null || blockMatchesGrade(b, filterGrade))
  );

  return (
    <>
      <ScrollView contentContainerStyle={styles.list}>
        <ClearAllBar count={all.length} onPress={() => confirmClearAll("blocked times", all.length, () => clearAll.mutate())} />
        {all.length > 0 && (
          <View style={{ gap: 8, marginBottom: 4 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              <TouchableOpacity style={[styles.chip, filterDay == null && styles.chipActive]} onPress={() => setFilterDay(null)}>
                <Text style={[styles.chipText, filterDay == null && styles.chipTextActive]}>All days</Text>
              </TouchableOpacity>
              {days.map((d) => (
                <TouchableOpacity key={d} style={[styles.chip, filterDay === d && styles.chipActive]} onPress={() => setFilterDay(d)}>
                  <Text style={[styles.chipText, filterDay === d && styles.chipTextActive]}>{DAY_SHORT[d]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
              <TouchableOpacity style={[styles.chip, filterGrade == null && styles.chipActive]} onPress={() => setFilterGrade(null)}>
                <Text style={[styles.chipText, filterGrade == null && styles.chipTextActive]}>All grades</Text>
              </TouchableOpacity>
              {(grades.data ?? []).map((g) => (
                <TouchableOpacity key={g.id} style={[styles.chip, filterGrade === g.id && styles.chipActive]} onPress={() => setFilterGrade(g.id)}>
                  <Text style={[styles.chipText, filterGrade === g.id && styles.chipTextActive]}>{g.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {(filterDay != null || filterGrade != null) && (
              <Text style={styles.filterCount}>{filtered.length} of {all.length}</Text>
            )}
          </View>
        )}
        {all.length === 0 && <Empty icon="lock-closed-outline" text="No blocked times. Tap + to block a slot." />}
        {all.length > 0 && filtered.length === 0 && <Empty icon="filter-outline" text="No blocked times match these filters." />}
        {filtered.map((b) => (
          <RowCard
            key={b.id}
            title={`${DAY_NAMES[b.dayOfWeek]} · ${slotLabel(b.timeSlotId)}`}
            subtitle={`${scopeLabel(b)}${b.reason ? ` · ${b.reason}` : ""}`}
            accent={C.danger}
            onEdit={() => startEdit(b)}
            onDelete={() => confirmDelete("this blocked time", () => remove.mutate(b.id))}
          />
        ))}
      </ScrollView>
      <Fab
        onPress={() => {
          if (!slots.data?.length) {
            Alert.alert("Add a period first", "Create time periods before blocking them.");
            return;
          }
          setEditId(null);
          setAdding({
            dayOfWeek: days[0],
            timeSlotIds: [],
            scope: "all",
            gradeLevelId: grades.data?.[0]?.id ?? null,
            sectionIds: [],
            reason: "",
          });
        }}
      />
      {adding && (
        <FormModal
          title={editId != null ? "Edit Blocked Time" : "Block a Time Slot"}
          saving={create.isPending || update.isPending}
          onClose={() => { setAdding(null); setEditId(null); }}
          onSave={async () => {
            const base: any = { dayOfWeek: adding.dayOfWeek, reason: adding.reason, gradeLevelId: null, sectionIds: null, sectionId: null };
            if (adding.scope === "grade") base.gradeLevelId = adding.gradeLevelId;
            else if (adding.scope === "sections") base.sectionIds = adding.sectionIds;
            if (editId != null) {
              await update.mutateAsync({ id: editId, ...base, timeSlotId: adding.timeSlotIds[0] });
            } else {
              for (const tid of adding.timeSlotIds as number[]) {
                await create.mutateAsync({ ...base, timeSlotId: tid });
              }
            }
            setAdding(null);
            setEditId(null);
          }}
          valid={
            !!adding.dayOfWeek &&
            (adding.timeSlotIds?.length ?? 0) > 0 &&
            (adding.scope !== "grade" || adding.gradeLevelId != null) &&
            (adding.scope !== "sections" || adding.sectionIds.length > 0)
          }
        >
          <Text style={styles.label}>Day</Text>
          <View style={styles.chipWrap}>
            {days.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.chip, adding.dayOfWeek === d && styles.chipActive]}
                onPress={() => setAdding({ ...adding, dayOfWeek: d })}
              >
                <Text style={[styles.chipText, adding.dayOfWeek === d && styles.chipTextActive]}>{DAY_NAMES[d]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>{editId != null ? "Period" : `Periods${adding.timeSlotIds?.length ? ` (${adding.timeSlotIds.length} selected)` : ""}`}</Text>
          <View style={styles.chipWrap}>
            {(slots.data ?? []).filter((s) => !s.isBreak).map((s) => {
              const on = (adding.timeSlotIds ?? []).includes(s.id);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, on && styles.chipActive]}
                  onPress={() =>
                    setAdding(
                      editId != null
                        ? { ...adding, timeSlotIds: [s.id] }
                        : { ...adding, timeSlotIds: on ? adding.timeSlotIds.filter((x: number) => x !== s.id) : [...(adding.timeSlotIds ?? []), s.id] }
                    )
                  }
                >
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.label}>Applies to</Text>
          <View style={styles.chipWrap}>
            {[
              { v: "all", l: "All sections" },
              { v: "grade", l: "By grade level" },
              { v: "sections", l: "Specific section(s)" },
            ].map((o) => (
              <TouchableOpacity
                key={o.v}
                style={[styles.chip, adding.scope === o.v && styles.chipActive]}
                onPress={() => setAdding({ ...adding, scope: o.v })}
              >
                <Text style={[styles.chipText, adding.scope === o.v && styles.chipTextActive]}>{o.l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {adding.scope === "grade" && (
            <>
              <Text style={styles.label}>Grade level</Text>
              <View style={styles.chipWrap}>
                {(grades.data ?? []).map((g) => (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.chip, adding.gradeLevelId === g.id && styles.chipActive]}
                    onPress={() => setAdding({ ...adding, gradeLevelId: g.id })}
                  >
                    <Text style={[styles.chipText, adding.gradeLevelId === g.id && styles.chipTextActive]}>{g.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {adding.scope === "sections" && (
            <>
              <Text style={styles.label}>Sections</Text>
              <View style={styles.chipWrap}>
                {(sections.data ?? []).map((s) => {
                  const on = adding.sectionIds.includes(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, on && styles.chipActive]}
                      onPress={() =>
                        setAdding({
                          ...adding,
                          sectionIds: on ? adding.sectionIds.filter((x: number) => x !== s.id) : [...adding.sectionIds, s.id],
                        })
                      }
                    >
                      <Text style={[styles.chipText, on && styles.chipTextActive]}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
          <LabeledInput label="Reason" value={adding.reason ?? ""} onChange={(v) => setAdding({ ...adding, reason: v })} placeholder="optional · e.g. Assembly" />
        </FormModal>
      )}
    </>
  );
}

/* ---------- form primitives ---------- */
function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "number-pad" | "email-address";
}) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        keyboardType={keyboardType ?? "default"}
      />
    </>
  );
}

function FormModal({
  title,
  children,
  onClose,
  onSave,
  saving,
  valid,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  valid: boolean;
}) {
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={C.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 480 }}>{children}</ScrollView>
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 18, opacity: !valid || saving ? 0.5 : 1 }]}
            disabled={!valid || saving}
            onPress={onSave}
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
  arrangeRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  arrangeIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  arrangeTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  arrangeSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  tabBar: { flexGrow: 0, flexShrink: 0, height: 56, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  tabPill: { flexShrink: 0, height: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  tabPillActive: { backgroundColor: C.brand, borderColor: C.brand },
  tabText: { color: C.text, fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: "#fff" },
  importRow: { paddingHorizontal: 14, paddingTop: 12, gap: 4 },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.brand, borderRadius: 10, paddingVertical: 11 },
  importBtnText: { color: C.brand, fontWeight: "700", fontSize: 14 },
  importHint: { fontSize: 11, color: C.muted, textAlign: "center" },
  list: { padding: 14, gap: 12, paddingBottom: 100 },
  clearAllBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.danger, borderRadius: 10, paddingVertical: 9 },
  clearAllText: { color: C.danger, fontWeight: "700", fontSize: 13.5 },
  center: { alignItems: "center", justifyContent: "center", padding: 50, gap: 10 },
  emptyText: { color: C.muted, textAlign: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  spHeader: { backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  spHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  spHeaderIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  spHeaderTitle: { fontSize: 16, fontWeight: "800", color: C.forest },
  spHeaderDesc: { fontSize: 13, color: C.muted, lineHeight: 18 },
  spRestoreBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: C.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.bg },
  spRestoreText: { color: C.brand, fontWeight: "700", fontSize: 13 },
  accent: { width: 6, height: 38, borderRadius: 3 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  cardSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  iconBtn: { padding: 6 },
  reorderCol: { marginRight: 6, justifyContent: "center", gap: 3 },
  reorderBtn: { width: 28, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F1F1" },
  reorderBtnDisabled: { backgroundColor: "transparent" },
  fab: { position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: C.brand, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  label: { fontSize: 13, fontWeight: "700", color: C.text, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.text },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterScroll: { gap: 8, paddingVertical: 2 },
  filterCount: { fontSize: 12, color: C.muted, fontWeight: "600" },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { color: C.text, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 12 },
  swatchWrap: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  swatchPick: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchActive: { borderColor: C.text },
  hexRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignSelf: "flex-start" },
  hexSwatch: { width: 24, height: 24, borderRadius: 6, borderWidth: 1 },
  hexHash: { color: "#9CA3AF", fontSize: 15 },
  hexInput: { minWidth: 90, fontSize: 15, color: C.text, fontFamily: "monospace", paddingVertical: 2 },
  primaryBtn: { backgroundColor: C.brand, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  copyright: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card },
  copyrightText: { textAlign: "center", fontSize: 11, color: C.muted },
  versionText: { textAlign: "center", fontSize: 10, color: C.muted, opacity: 0.7, marginTop: 2 },
});
