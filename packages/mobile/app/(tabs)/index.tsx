import { useMemo, useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { C, DAY_SHORT, NO_COLOR } from "../../lib/theme";
import {
  useSections,
  useSubjects,
  useTeachers,
  useRooms,
  useTimeSlots,
  useBlockedTimes,
  useEntries,
  useSettings,
  useGradeLevels,
  useEntryMutations,
  useAutofill,
  useSeed,
  useConflicts,
  useLock,
  useUnlock,
  useChangeLockPassword,
  useHistory,
  useCreateSavePoint,
  type ScheduleEntry,
  type Subject,
  type Conflict,
} from "../../lib/hooks";
import { printSectionSchedule, printAllSections } from "../../lib/print";
import { exportScheduleWorkbook } from "../../lib/excel-export";

export default function ScheduleScreen() {
  const sections = useSections();
  const subjects = useSubjects();
  const teachers = useTeachers();
  const rooms = useRooms();
  const slots = useTimeSlots();
  const blocked = useBlockedTimes();
  const entries = useEntries();
  const settings = useSettings();
  const grades = useGradeLevels();
  const { create, update, remove, bulk, clear } = useEntryMutations();
  const autofill = useAutofill();
  const seed = useSeed();
  const conflicts = useConflicts();
  const history = useHistory();
  const createSavePoint = useCreateSavePoint();
  const rec = () => history.record(entries.data);
  const [savePointOpen, setSavePointOpen] = useState(false);
  const [savePointName, setSavePointName] = useState("");
  const [savePointNote, setSavePointNote] = useState("");
  const [showConflicts, setShowConflicts] = useState(false);
  const [redoing, setRedoing] = useState(false);

  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ day: number; slotId: number; entry?: ScheduleEntry } | null>(null);
  // Move/Swap mode: holds the entry being relocated. Tap a destination cell to
  // move (empty target) or swap (occupied target).
  const [moving, setMoving] = useState<ScheduleEntry | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const loading =
    sections.isLoading || subjects.isLoading || slots.isLoading || entries.isLoading || settings.isLoading;

  const locked = !!settings.data?.locked;
  const sectionId = activeSection ?? sections.data?.[0]?.id ?? null;
  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const sortedSlots = useMemo(
    () => [...(slots.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [slots.data]
  );

  const subjectMap = useMemo(() => {
    const m = new Map<number, Subject>();
    (subjects.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects.data]);

  const teacherMap = useMemo(() => new Map((teachers.data ?? []).map((t) => [t.id, t])), [teachers.data]);
  const roomMap = useMemo(() => new Map((rooms.data ?? []).map((r) => [r.id, r])), [rooms.data]);
  const gradeName = (gid: number) => grades.data?.find((g) => g.id === gid)?.name;

  const entryAt = (day: number, slotId: number) =>
    (entries.data ?? []).find(
      (e) => e.sectionId === sectionId && e.dayOfWeek === day && e.timeSlotId === slotId
    );

  const activeGrade = sections.data?.find((s) => s.id === sectionId)?.gradeLevelId ?? null;
  const isBlocked = (day: number, slotId: number) =>
    (blocked.data ?? []).some((b: any) => {
      if (b.dayOfWeek !== day || b.timeSlotId !== slotId) return false;
      if (b.sectionIds && b.sectionIds.length) return sectionId != null && b.sectionIds.includes(sectionId);
      if (b.gradeLevelId != null) return activeGrade === b.gradeLevelId;
      if (b.sectionId != null) return b.sectionId === sectionId;
      return true; // all sections
    });

  // Perform move (empty target) or swap (occupied target) of the entry held in `moving`.
  const placeMoving = (day: number, slotId: number) => {
    const src = moving;
    if (!src) return;
    if (src.dayOfWeek === day && src.timeSlotId === slotId) { setMoving(null); return; }
    if (isBlocked(day, slotId)) { Alert.alert("Blocked", "That time slot is blocked."); return; }
    const target = entryAt(day, slotId);
    rec();
    if (target && target.id !== src.id) {
      // SWAP: target goes to src's old cell, src goes to target's cell.
      update.mutate({ id: target.id, dayOfWeek: src.dayOfWeek, timeSlotId: src.timeSlotId });
      update.mutate({ id: src.id, dayOfWeek: day, timeSlotId: slotId });
    } else {
      update.mutate({ id: src.id, dayOfWeek: day, timeSlotId: slotId });
    }
    setMoving(null);
  };

  // Tap on a filled cell -> action sheet (Edit / Move-Swap / Delete).
  const onFilledCell = (day: number, slotId: number, entry: ScheduleEntry) => {
    if (locked) return; // read-only in lockdown
    if (moving) { placeMoving(day, slotId); return; }
    const subj = subjectMap.get(entry.subjectId);
    Alert.alert(
      subj?.name ?? "Class",
      "Choose an action",
      [
        { text: "Edit", onPress: () => setEditing({ day, slotId, entry }) },
        { text: "Move / Swap", onPress: () => setMoving(entry) },
        { text: "Delete", style: "destructive", onPress: () => { rec(); remove.mutate(entry.id); } },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const onEmptyCell = (day: number, slotId: number) => {
    if (locked) return; // read-only in lockdown
    if (moving) { placeMoving(day, slotId); return; }
    setEditing({ day, slotId, entry: undefined });
  };

  // Conflicts for the active section (mirrors web's per-section sidebar panel).
  const allConflicts = conflicts.data?.conflicts ?? [];
  const sectionEntryIds = new Set((entries.data ?? []).filter((e) => e.sectionId === sectionId).map((e) => e.id));
  const isDouble = (c: Conflict) => c.type === "teacher_double" || c.type === "section_double" || c.type === "room_double";
  const sectionConflicts = allConflicts.filter(
    (c) => c.sectionId === sectionId || c.entryIds.some((id) => sectionEntryIds.has(id)),
  );
  const sectionErrors = sectionConflicts.filter((c) => c.severity === "error");
  const sectionWarnings = sectionConflicts.filter((c) => c.severity === "warning");
  const allDoubles = allConflicts.filter(isDouble);
  const sectionDoubles = sectionConflicts.filter(isDouble);
  const conflictCount = sectionConflicts.length;

  const redoAll = () => {
    const ids = (sections.data ?? []).map((s) => s.id);
    if (!ids.length) return;
    Alert.alert("Redo auto-fill (all sections)?", "Clears every section and rebuilds a clash-free schedule. Cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Rebuild all", style: "destructive",
        onPress: async () => {
          rec();
          setRedoing(true);
          try { await clear.mutateAsync(undefined); const res = await autofill.mutateAsync(ids); await bulk.mutateAsync(res.suggestions); }
          finally { setRedoing(false); }
        },
      },
    ]);
  };

  const redoSection = () => {
    if (sectionId == null) return;
    const name = sections.data?.find((s) => s.id === sectionId)?.name ?? "this section";
    Alert.alert(`Redo ${name}?`, "Clears and rebuilds just this section around the others. Cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Rebuild section",
        onPress: async () => {
          rec();
          setRedoing(true);
          try { await clear.mutateAsync(sectionId); const res = await autofill.mutateAsync([sectionId]); await bulk.mutateAsync(res.suggestions); }
          finally { setRedoing(false); }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator color={C.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!sections.data?.length) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={56} color={C.sage} />
          <Text style={styles.emptyTitle}>No data yet</Text>
          <Text style={styles.emptyText}>Seed demo data to get started.</Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            disabled={seed.isPending}
            onPress={() => seed.mutate()}
          >
            <Text style={styles.primaryBtnText}>
              {seed.isPending ? "Seeding…" : "Load Demo Data"}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const doAutofill = (ids: number[], scopeLabel: string) => {
    if (!ids.length) return;
    autofill.mutate(ids, {
      onSuccess: (res) => {
        const count = res.suggestions?.length ?? 0;
        if (!count) {
          Alert.alert("Auto-fill", "No suggestions — schedule may already be full.");
          return;
        }
        const hard = (res.projectedConflicts ?? []).filter((c) => c.severity === "error").length;
        Alert.alert(
          `Apply auto-fill (${scopeLabel})?`,
          `${count} suggested entries${hard ? ` · ${hard} conflict(s)` : ""}.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Apply", onPress: () => { rec(); bulk.mutate(res.suggestions); } },
          ]
        );
      },
    });
  };

  const promptAutofill = () => {
    const ids = (sections.data ?? []).map((s) => s.id);
    if (!ids.length) return;
    const sectionName = sections.data?.find((s) => s.id === sectionId)?.name ?? "this section";
    Alert.alert(
      "Auto-fill",
      "What would you like to auto-fill?",
      [
        { text: "Cancel", style: "cancel" },
        { text: `Current section (${sectionName})`, onPress: () => { if (sectionId) doAutofill([sectionId], "this section"); } },
        { text: `All sections (${ids.length})`, onPress: () => doAutofill(ids, `all ${ids.length} sections`) },
      ]
    );
  };

  const runClear = () => {
    const total = entries.data?.length ?? 0;
    if (!total) {
      Alert.alert("Clear", "The schedule is already empty.");
      return;
    }
    const sectionCount = sectionId ? (entries.data ?? []).filter((e) => e.sectionId === sectionId).length : 0;
    const sectionName = sections.data?.find((s) => s.id === sectionId)?.name ?? "this section";
    Alert.alert(
      "Clear schedule?",
      "Choose what to clear. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `This section (${sectionName}, ${sectionCount})`,
          onPress: () => { if (sectionId) { rec(); clear.mutate(sectionId); } },
        },
        {
          text: `All sections (${total})`,
          style: "destructive",
          onPress: () => { rec(); clear.mutate(undefined); },
        },
      ]
    );
  };

  const runPrint = () => setPrintOpen(true);

  const doPrint = (scope: "section" | "all", timeStyle: "default" | "emphasizeTime") => {
    setPrintOpen(false);
    if (scope === "section") {
      const section = sections.data?.find((s) => s.id === sectionId);
      if (!section) return;
      printSectionSchedule({
        section, gradeName: gradeName(section.gradeLevelId), days, slots: sortedSlots,
        entries: entries.data ?? [], subjMap: subjectMap, teacherMap, roomMap, timeStyle,
        template: settings.data?.printTemplate, heading: settings.data?.printHeading, offset: settings.data?.printOffset, rowHeight: settings.data?.printRowHeight,
      }).catch((e) => Alert.alert("Print failed", String(e)));
    } else {
      printAllSections({
        sections: sections.data ?? [], gradeNameFor: (s) => gradeName(s.gradeLevelId),
        days, slots: sortedSlots, entries: entries.data ?? [], subjMap: subjectMap, teacherMap, roomMap, timeStyle,
        template: settings.data?.printTemplate, heading: settings.data?.printHeading, offset: settings.data?.printOffset, rowHeight: settings.data?.printRowHeight,
      }).catch((e) => Alert.alert("Print failed", String(e)));
    }
  };

  const runExport = () => {
    const sectionMap = new Map((sections.data ?? []).map((s) => [s.id, s]));
    exportScheduleWorkbook({
      sections: sections.data ?? [],
      teachers: teachers.data ?? [],
      days, slots: sortedSlots, entries: entries.data ?? [],
      gradeNameFor: (s) => gradeName(s.gradeLevelId),
      maps: { subjMap: subjectMap, teacherMap, roomMap, sectionMap },
    }).catch((e) => Alert.alert("Export failed", String(e)));
  };

  const COL_W = 116;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* Lock banner / toggle */}
      <TouchableOpacity
        style={locked ? styles.lockBannerOn : styles.lockBannerOff}
        onPress={() => setLockOpen(true)}
      >
        <Ionicons
          name={locked ? "lock-closed" : "lock-open-outline"}
          size={15}
          color={locked ? C.lime : C.brand}
        />
        <Text style={[styles.lockBannerText, { color: locked ? "#fff" : C.brand }]}>
          {locked ? "Lockdown mode — read-only. Tap to unlock." : "Lock changes"}
        </Text>
      </TouchableOpacity>

      <LockModal
        visible={lockOpen}
        onClose={() => setLockOpen(false)}
        locked={locked}
        hasPassword={!!settings.data?.hasLockPassword}
      />

      <PrintModal
        visible={printOpen}
        onClose={() => setPrintOpen(false)}
        hasSection={!!sectionId}
        onPrint={doPrint}
      />

      <SavePointModal
        visible={savePointOpen}
        name={savePointName}
        onChangeName={setSavePointName}
        note={savePointNote}
        onChangeNote={setSavePointNote}
        saving={createSavePoint.isPending}
        onClose={() => setSavePointOpen(false)}
        onSave={() => createSavePoint.mutate({ name: savePointName.trim() || undefined, note: savePointNote.trim() || null }, { onSuccess: () => setSavePointOpen(false) })}
      />

      {/* Section switcher */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillRow}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: "center" }}
      >
        {sections.data.map((s) => {
          const active = s.id === sectionId;
          return (
            <TouchableOpacity
              key={s.id}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => setActiveSection(s.id)}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{s.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolbarScroll} contentContainerStyle={styles.toolbar}>
        <TouchableOpacity
          style={[styles.clearBtn, (locked || !history.canUndo) && styles.btnDisabled]}
          disabled={locked || !history.canUndo}
          onPress={() => history.undo()}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={C.brand} />
          <Text style={styles.clearText}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.clearBtn, (locked || !history.canRedo) && styles.btnDisabled]}
          disabled={locked || !history.canRedo}
          onPress={() => history.redo()}
        >
          <Ionicons name="arrow-redo-outline" size={16} color={C.brand} />
          <Text style={styles.clearText}>Redo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.clearBtn, locked && styles.btnDisabled]}
          disabled={locked}
          onPress={() => { setSavePointName(""); setSavePointNote(""); setSavePointOpen(true); }}
        >
          <Ionicons name="bookmark-outline" size={16} color={C.brand} />
          <Text style={styles.clearText}>Save point</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={runPrint}>
          <Ionicons name="print-outline" size={16} color={C.brand} />
          <Text style={styles.clearText}>Print</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.clearBtn} onPress={runExport}>
          <Ionicons name="document-outline" size={16} color={C.brand} />
          <Text style={styles.clearText}>Export</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.autofillBtn, locked && styles.btnDisabled]}
          disabled={locked || autofill.isPending || bulk.isPending || !(sections.data?.length)}
          onPress={promptAutofill}
        >
          <Ionicons name="sparkles-outline" size={16} color="#fff" />
          <Text style={styles.autofillText}>
            {autofill.isPending || bulk.isPending ? "Working…" : "Auto-fill"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.clearBtn, locked && styles.btnDisabled]}
          disabled={locked || clear.isPending}
          onPress={runClear}
        >
          <Ionicons name="trash-outline" size={16} color={C.brand} />
          <Text style={styles.clearText}>
            {clear.isPending ? "Clearing…" : "Clear"}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {moving && (
        <View style={styles.moveBanner}>
          <Ionicons name="swap-horizontal" size={16} color="#fff" />
          <Text style={styles.moveBannerText} numberOfLines={1}>
            Moving {subjectMap.get(moving.subjectId)?.name ?? "class"} — tap a cell to move/swap
          </Text>
          <TouchableOpacity onPress={() => setMoving(null)} style={styles.moveCancel}>
            <Text style={styles.moveCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Timetable grid */}
      <ScrollView style={{ flex: 1 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* Header row */}
            <View style={styles.row}>
              <View style={[styles.cornerCell]}>
                <Text style={styles.headTime}>Time</Text>
              </View>
              {days.map((d) => (
                <View key={d} style={[styles.headCell, { width: COL_W }]}>
                  <Text style={styles.headText}>{DAY_SHORT[d]}</Text>
                </View>
              ))}
            </View>

            {sortedSlots.map((slot) => (
              <View key={slot.id} style={styles.row}>
                <View style={styles.timeCell}>
                  <Text style={styles.slotLabel} numberOfLines={1}>{slot.label}</Text>
                  <Text style={styles.slotTime}>{slot.startTime}</Text>
                </View>
                {days.map((d) => {
                  if (slot.isBreak) {
                    return (
                      <View key={d} style={[styles.cell, styles.breakCell, { width: COL_W }]}>
                        <Text style={styles.breakText}>Break</Text>
                      </View>
                    );
                  }
                  if (isBlocked(d, slot.id)) {
                    return (
                      <View key={d} style={[styles.cell, styles.blockedCell, { width: COL_W }]}>
                        <Text style={styles.blockedText}>Blocked</Text>
                      </View>
                    );
                  }
                  const e = entryAt(d, slot.id);
                  const subj = e ? subjectMap.get(e.subjectId) : undefined;
                  const isMovingSrc = moving && e && moving.id === e.id;
                  const isMoveTarget = !!moving && !isMovingSrc;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[
                        styles.cell,
                        { width: COL_W },
                        subj ? { backgroundColor: (subj.color || NO_COLOR) + "22", borderColor: subj.color || NO_COLOR } : null,
                        isMoveTarget ? styles.moveTargetCell : null,
                        isMovingSrc ? styles.movingSrcCell : null,
                      ]}
                      onPress={() => (e ? onFilledCell(d, slot.id, e) : onEmptyCell(d, slot.id))}
                    >
                      {subj ? (
                        <>
                          <Text style={[styles.entrySubj, { color: C.text }]} numberOfLines={2}>
                            {subj.name}
                          </Text>
                          <Text style={styles.entryMeta} numberOfLines={1}>
                            {teachers.data?.find((t) => t.id === e?.teacherId)?.name ?? "—"}
                          </Text>
                          <Text style={styles.entryMeta} numberOfLines={1}>
                            {rooms.data?.find((r) => r.id === e?.roomId)?.name ?? ""}
                          </Text>
                        </>
                      ) : (
                        !locked && <Ionicons name="add" size={18} color={C.sage} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
        <View style={{ height: 96 }} />
      </ScrollView>

      {/* Conflict bar (always visible, like web's sidebar) + expandable panel */}
      <View style={styles.conflictBarWrap}>
        {showConflicts && (
          <View style={styles.conflictPanel}>
            <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ padding: 12, gap: 8 }}>
              {allDoubles.length > 0 && !locked && (
                <View style={styles.cpRedoBox}>
                  <Text style={styles.cpRedoMsg}>
                    {allDoubles.length} double-booking{allDoubles.length !== 1 ? "s" : ""} in the schedule.
                  </Text>
                  {sectionDoubles.length > 0 && (
                    <TouchableOpacity style={[styles.cpRedoSection, redoing && { opacity: 0.6 }]} disabled={redoing} onPress={redoSection}>
                      <Ionicons name="refresh" size={16} color="#fff" />
                      <Text style={styles.cpRedoBtnText}>{redoing ? "Rebuilding…" : "Redo this section"}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.cpRedoAll, redoing && { opacity: 0.6 }]} disabled={redoing} onPress={redoAll}>
                    <Ionicons name="refresh" size={16} color="#fff" />
                    <Text style={styles.cpRedoBtnText}>{redoing ? "Rebuilding…" : "Redo all sections"}</Text>
                  </TouchableOpacity>
                  <Text style={styles.cpRedoHint}>Section redo rebuilds just this section around the others.</Text>
                </View>
              )}
              {conflictCount === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 16, gap: 6 }}>
                  <Ionicons name="checkmark-circle" size={36} color={C.bright} />
                  <Text style={{ color: C.muted, fontWeight: "600" }}>All clear for this section.</Text>
                </View>
              ) : (
                <>
                  {sectionErrors.map((c, i) => (
                    <View key={`e${i}`} style={[styles.cpItem, { backgroundColor: "#FDECEC" }]}>
                      <Ionicons name="close-circle" size={16} color={C.danger} style={{ marginTop: 1 }} />
                      <Text style={[styles.cpItemText, { color: C.danger }]}>{c.message}</Text>
                    </View>
                  ))}
                  {sectionWarnings.map((c, i) => (
                    <View key={`w${i}`} style={[styles.cpItem, { backgroundColor: "#FBF3DC" }]}>
                      <Ionicons name="alert-circle" size={16} color={C.warning} style={{ marginTop: 1 }} />
                      <Text style={[styles.cpItemText, { color: "#8a6400" }]}>{c.message}</Text>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>
          </View>
        )}
        <TouchableOpacity style={styles.conflictBar} onPress={() => setShowConflicts((v) => !v)} activeOpacity={0.85}>
          <Ionicons
            name={conflictCount === 0 ? "checkmark-circle" : "alert-circle"}
            size={18}
            color={conflictCount === 0 ? C.bright : sectionErrors.length ? C.danger : C.warning}
          />
          <Text style={styles.conflictBarText}>
            {conflictCount === 0
              ? "No conflicts in this section"
              : `${sectionErrors.length} error${sectionErrors.length !== 1 ? "s" : ""} · ${sectionWarnings.length} warning${sectionWarnings.length !== 1 ? "s" : ""}`}
          </Text>
          <Ionicons name={showConflicts ? "chevron-down" : "chevron-up"} size={18} color={C.muted} />
        </TouchableOpacity>
      </View>

      {editing && sectionId != null && (
        <EntryModal
          sectionId={sectionId}
          gradeLevelId={activeGrade}
          day={editing.day}
          slotId={editing.slotId}
          entry={editing.entry}
          subjects={subjects.data ?? []}
          teachers={teachers.data ?? []}
          rooms={rooms.data ?? []}
          onClose={() => setEditing(null)}
          onSave={(payload) => {
            rec();
            if (editing.entry) update.mutate({ id: editing.entry.id, ...payload });
            else create.mutate(payload);
            setEditing(null);
          }}
          onDelete={() => {
            if (editing.entry) { rec(); remove.mutate(editing.entry.id); }
            setEditing(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function SavePointModal({
  visible, name, onChangeName, note, onChangeNote, saving, onClose, onSave,
}: {
  visible: boolean; name: string; onChangeName: (v: string) => void; note: string; onChangeNote: (v: string) => void; saving: boolean; onClose: () => void; onSave: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.lockOverlay}>
        <View style={styles.lockCard}>
          <Text style={styles.lockTitle}>Create save point</Text>
          <Text style={{ fontSize: 13, color: C.muted, lineHeight: 18 }}>
            Captures your entire configuration and schedule so you can roll back to this exact state from Setup → Save Points.
          </Text>
          <TextInput
            style={styles.lockInput}
            placeholder="Name (optional)"
            placeholderTextColor={C.muted}
            value={name}
            onChangeText={onChangeName}
            autoFocus
          />
          <TextInput
            style={styles.lockInput}
            placeholder="Note (optional)"
            placeholderTextColor={C.muted}
            value={note}
            onChangeText={onChangeNote}
          />
          <View style={styles.lockBtnRow}>
            <TouchableOpacity style={styles.lockCancelBtn} onPress={onClose}>
              <Text style={styles.lockCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.autofillBtn} disabled={saving} onPress={onSave}>
              <Ionicons name="bookmark" size={16} color="#fff" />
              <Text style={styles.autofillText}>{saving ? "Saving…" : "Save snapshot"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function PrintModal({
  visible,
  onClose,
  hasSection,
  onPrint,
}: {
  visible: boolean;
  onClose: () => void;
  hasSection: boolean;
  onPrint: (scope: "section" | "all", timeStyle: "default" | "emphasizeTime") => void;
}) {
  const [style, setStyle] = useState<"default" | "emphasizeTime">("default");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.lockOverlay}>
        <View style={styles.lockCard}>
          <Text style={styles.lockTitle}>Print schedule</Text>

          <Text style={styles.printLabel}>Time-column format</Text>
          <View style={styles.printStyleRow}>
            <TouchableOpacity
              style={[styles.printStyleBtn, style === "default" && styles.printStyleBtnActive]}
              onPress={() => setStyle("default")}
            >
              <Text style={[styles.printStyleText, style === "default" && styles.printStyleTextActive]}>Original format</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.printStyleBtn, style === "emphasizeTime" && styles.printStyleBtnActive]}
              onPress={() => setStyle("emphasizeTime")}
            >
              <Text style={[styles.printStyleText, style === "emphasizeTime" && styles.printStyleTextActive]}>Emphasize time periods</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.printLabel}>What to print</Text>
          <TouchableOpacity
            style={[styles.printScopeBtn, !hasSection && styles.btnDisabled]}
            disabled={!hasSection}
            onPress={() => onPrint("section", style)}
          >
            <Ionicons name="document-text-outline" size={16} color={C.brand} />
            <Text style={styles.printScopeText}>This section</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.printScopeBtn}
            onPress={() => onPrint("all", style)}
          >
            <Ionicons name="documents-outline" size={16} color={C.brand} />
            <Text style={styles.printScopeText}>All sections</Text>
          </TouchableOpacity>

          <View style={styles.lockBtnRow}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.lockCancelBtn} onPress={onClose}>
              <Text style={styles.lockCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LockModal({
  visible,
  onClose,
  locked,
  hasPassword,
}: {
  visible: boolean;
  onClose: () => void;
  locked: boolean;
  hasPassword: boolean;
}) {
  const lock = useLock();
  const unlock = useUnlock();
  const changePw = useChangeLockPassword();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [changing, setChanging] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [nextPw, setNextPw] = useState("");

  const reset = () => {
    setPw(""); setConfirm(""); setChanging(false); setCurPw(""); setNextPw("");
  };
  const close = () => { reset(); onClose(); };

  const doLock = () => {
    if (!pw) return Alert.alert("Password", "Enter a password.");
    if (!hasPassword && pw !== confirm) return Alert.alert("Password", "Passwords don't match.");
    lock.mutate(pw, { onSuccess: close, onError: (e) => Alert.alert("Error", (e as Error).message) });
  };
  const doUnlock = () => {
    if (!pw) return Alert.alert("Password", "Enter the password.");
    unlock.mutate(pw, { onSuccess: close, onError: (e) => Alert.alert("Error", (e as Error).message) });
  };
  const doChange = () => {
    if (!nextPw) return Alert.alert("Password", "Enter a new password.");
    changePw.mutate(
      { current: curPw || undefined, next: nextPw },
      { onSuccess: () => { setChanging(false); setCurPw(""); setNextPw(""); Alert.alert("Done", "Password updated."); },
        onError: (e) => Alert.alert("Error", (e as Error).message) }
    );
  };

  const busy = lock.isPending || unlock.isPending || changePw.isPending;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.lockOverlay}>
        <View style={styles.lockCard}>
          <Text style={styles.lockTitle}>
            {changing ? "Change password" : locked ? "Unlock changes" : "Lock changes"}
          </Text>

          {changing ? (
            <>
              <Text style={styles.lockDesc}>Set a new lockdown password.</Text>
              {hasPassword && (
                <TextInput style={styles.lockInput} placeholder="Current password" secureTextEntry
                  value={curPw} onChangeText={setCurPw} autoFocus />
              )}
              <TextInput style={styles.lockInput} placeholder="New password" secureTextEntry
                value={nextPw} onChangeText={setNextPw} />
            </>
          ) : locked ? (
            <>
              <Text style={styles.lockDesc}>Enter the password to exit lockdown mode.</Text>
              <TextInput style={styles.lockInput} placeholder="Password" secureTextEntry
                value={pw} onChangeText={setPw} autoFocus />
            </>
          ) : (
            <>
              <Text style={styles.lockDesc}>
                Lockdown makes all data read-only. It hides Allocations, Teachers and Setup, and greys out auto-fill, clear and delete.
              </Text>
              <TextInput style={styles.lockInput} placeholder={hasPassword ? "Password" : "Create a password"} secureTextEntry
                value={pw} onChangeText={setPw} autoFocus />
              {!hasPassword && (
                <TextInput style={styles.lockInput} placeholder="Confirm password" secureTextEntry
                  value={confirm} onChangeText={setConfirm} />
              )}
            </>
          )}

          <View style={styles.lockBtnRow}>
            {!changing && (locked || hasPassword) && (
              <TouchableOpacity style={styles.lockSecondaryBtn} onPress={() => setChanging(true)}>
                <Text style={styles.lockSecondaryText}>Change password</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.lockCancelBtn} onPress={close}>
              <Text style={styles.lockCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.lockPrimaryBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={changing ? doChange : locked ? doUnlock : doLock}
            >
              <Text style={styles.lockPrimaryText}>
                {changing ? "Save" : locked ? "Unlock" : "Lock"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function EntryModal({
  sectionId,
  gradeLevelId,
  day,
  slotId,
  entry,
  subjects,
  teachers,
  rooms,
  onClose,
  onSave,
  onDelete,
}: {
  sectionId: number;
  gradeLevelId: number | null;
  day: number;
  slotId: number;
  entry?: ScheduleEntry;
  subjects: Subject[];
  teachers: { id: number; name: string; subjectIds?: number[]; gradeLevelIds?: number[] }[];
  rooms: { id: number; name: string }[];
  onClose: () => void;
  onSave: (p: any) => void;
  onDelete: () => void;
}) {
  const [subjectId, setSubjectId] = useState<number | null>(entry?.subjectId ?? null);
  const [teacherId, setTeacherId] = useState<number | null>(entry?.teacherId ?? null);
  const [roomId, setRoomId] = useState<number | null>(entry?.roomId ?? null);
  const eligibleTeachers = teachers.filter((t) =>
    ((t.subjectIds?.length ?? 0) === 0 || subjectId == null || t.subjectIds!.includes(subjectId))
    && ((t.gradeLevelIds?.length ?? 0) === 0 || gradeLevelId == null || t.gradeLevelIds!.includes(gradeLevelId)));

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{entry ? "Edit Class" : "Add Class"}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={C.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 460 }}>
            <Text style={styles.label}>Subject</Text>
            <View style={styles.chipWrap}>
              {subjects.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, subjectId === s.id && { backgroundColor: C.brand, borderColor: C.brand }]}
                  onPress={() => setSubjectId(s.id)}
                >
                  <Text style={[styles.chipText, subjectId === s.id && { color: "#fff" }]}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Teacher</Text>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                style={[styles.chip, teacherId === null && { backgroundColor: C.brand, borderColor: C.brand }]}
                onPress={() => setTeacherId(null)}
              >
                <Text style={[styles.chipText, teacherId === null && { color: "#fff" }]}>None</Text>
              </TouchableOpacity>
              {eligibleTeachers.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.chip, teacherId === t.id && { backgroundColor: C.brand, borderColor: C.brand }]}
                  onPress={() => setTeacherId(t.id)}
                >
                  <Text style={[styles.chipText, teacherId === t.id && { color: "#fff" }]}>{t.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Room</Text>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                style={[styles.chip, roomId === null && { backgroundColor: C.brand, borderColor: C.brand }]}
                onPress={() => setRoomId(null)}
              >
                <Text style={[styles.chipText, roomId === null && { color: "#fff" }]}>None</Text>
              </TouchableOpacity>
              {rooms.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.chip, roomId === r.id && { backgroundColor: C.brand, borderColor: C.brand }]}
                  onPress={() => setRoomId(r.id)}
                >
                  <Text style={[styles.chipText, roomId === r.id && { color: "#fff" }]}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            {entry && (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
                <Ionicons name="trash-outline" size={18} color={C.danger} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1, opacity: subjectId == null ? 0.5 : 1 }]}
              disabled={subjectId == null}
              onPress={() =>
                onSave({ sectionId, dayOfWeek: day, timeSlotId: slotId, subjectId, teacherId, roomId })
              }
            >
              <Text style={styles.primaryBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  btnDisabled: { opacity: 0.4 },
  lockBannerOff: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.sage + "33", borderBottomWidth: 1, borderBottomColor: C.border },
  lockBannerOn: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.brand },
  lockBannerText: { fontSize: 12.5, fontWeight: "700" },
  lockOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  lockCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 12 },
  lockTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  lockDesc: { fontSize: 13, color: C.muted, lineHeight: 18 },
  lockInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text },
  lockBtnRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  lockSecondaryBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  lockSecondaryText: { color: C.brand, fontWeight: "700", fontSize: 13 },
  lockCancelBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  lockCancelText: { color: C.muted, fontWeight: "700" },
  lockPrimaryBtn: { backgroundColor: C.brand, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  lockPrimaryText: { color: "#fff", fontWeight: "800" },
  printLabel: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  printStyleRow: { flexDirection: "row", gap: 8 },
  printStyleBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center" },
  printStyleBtnActive: { borderColor: C.brand, backgroundColor: C.brand + "14" },
  printStyleText: { fontSize: 12, fontWeight: "700", color: C.muted, textAlign: "center" },
  printStyleTextActive: { color: C.brand },
  printScopeBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  printScopeText: { fontSize: 15, fontWeight: "700", color: C.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginTop: 8 },
  emptyText: { color: C.muted, marginBottom: 12 },
  pillRow: { flexGrow: 0, paddingVertical: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  pillActive: { backgroundColor: C.brand, borderColor: C.brand },
  pillText: { color: C.text, fontWeight: "600", fontSize: 13 },
  pillTextActive: { color: "#fff" },
  toolbarScroll: { flexGrow: 0 },
  toolbar: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  autofillBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.mid, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  autofillText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  clearBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderWidth: 1, borderColor: C.brand, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  clearText: { color: C.brand, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row" },
  cornerCell: { width: 70, padding: 6, backgroundColor: C.forest, justifyContent: "center", alignItems: "center", borderWidth: 0.5, borderColor: C.border },
  headTime: { color: "#fff", fontWeight: "700", fontSize: 11 },
  headCell: { padding: 8, backgroundColor: C.brand, justifyContent: "center", alignItems: "center", borderWidth: 0.5, borderColor: C.border },
  headText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  timeCell: { width: 70, padding: 6, backgroundColor: C.card, justifyContent: "center", borderWidth: 0.5, borderColor: C.border },
  slotLabel: { fontSize: 11, fontWeight: "700", color: C.text },
  slotTime: { fontSize: 9, color: C.muted },
  cell: { minHeight: 72, padding: 6, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border, justifyContent: "center", alignItems: "center", gap: 2 },
  breakCell: { backgroundColor: C.cream },
  breakText: { color: C.wood, fontSize: 11, fontWeight: "600" },
  blockedCell: { backgroundColor: "#EFE7E5" },
  blockedText: { color: C.danger, fontSize: 11, fontWeight: "600" },
  moveTargetCell: { borderWidth: 2, borderColor: C.brand, borderStyle: "dashed" },
  movingSrcCell: { borderWidth: 2, borderColor: C.bright ?? C.brand, opacity: 0.55 },
  moveBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.brand, paddingHorizontal: 12, paddingVertical: 9, marginHorizontal: 12, marginBottom: 6, borderRadius: 10 },
  moveBannerText: { color: "#fff", fontWeight: "700", fontSize: 12, flex: 1 },
  moveCancel: { backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  moveCancelText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  conflictBarWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  conflictBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 16, paddingVertical: 12 },
  conflictBarText: { flex: 1, fontSize: 13, fontWeight: "700", color: C.text },
  conflictPanel: { backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border },
  cpItem: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 10, padding: 10 },
  cpItemText: { flex: 1, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  cpRedoBox: { backgroundColor: "#FDECEC", borderWidth: 1, borderColor: "#F5C2C2", borderRadius: 12, padding: 12, gap: 8 },
  cpRedoMsg: { fontSize: 12, color: C.danger, fontWeight: "700" },
  cpRedoSection: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.brand, paddingVertical: 10, borderRadius: 10 },
  cpRedoAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.danger, paddingVertical: 10, borderRadius: 10 },
  cpRedoBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  cpRedoHint: { fontSize: 11, color: C.muted },
  entrySubj: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  entryMeta: { fontSize: 10, color: C.muted, textAlign: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  label: { fontSize: 13, fontWeight: "700", color: C.text, marginTop: 14, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  chipText: { color: C.text, fontSize: 13, fontWeight: "600" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 18, alignItems: "center" },
  deleteBtn: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: C.danger, alignItems: "center", justifyContent: "center" },
  primaryBtn: { backgroundColor: C.brand, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
