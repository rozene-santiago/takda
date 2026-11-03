import { useMemo, useState, useEffect } from "react";
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
import { C, DAY_SHORT, teacherColor, NO_COLOR } from "../../lib/theme";
import { printTeacherSchedule, printAllTeachers } from "../../lib/print";
import {
  useSections,
  useSubjects,
  useTeachers,
  useRooms,
  useTimeSlots,
  useEntries,
  useSettings,
  useBlockedTimes,
  useEntryMutations,
  useHistory,
  useCreateSavePoint,
  type ScheduleEntry,
  type Subject,
  type Section,
  type Teacher,
} from "../../lib/hooks";

type ViewMode = "single" | "master";

export default function TeacherScheduleScreen() {
  const sections = useSections();
  const subjects = useSubjects();
  const teachers = useTeachers();
  const rooms = useRooms();
  const slots = useTimeSlots();
  const entries = useEntries();
  const settings = useSettings();
  const blocked = useBlockedTimes();
  const locked = !!settings.data?.locked;
  const { update } = useEntryMutations();
  const history = useHistory();
  const createSavePoint = useCreateSavePoint();
  const [savePointOpen, setSavePointOpen] = useState(false);
  const [savePointName, setSavePointName] = useState("");
  const [savePointNote, setSavePointNote] = useState("");

  const [view, setView] = useState<ViewMode>("single");
  const [masterDay, setMasterDay] = useState<number | "all">("all");
  const [activeTeacher, setActiveTeacher] = useState<number | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<number | "all">("all");
  const [editor, setEditor] = useState<{ entry?: ScheduleEntry; day: number; slotId: number } | null>(null);
  const [printOpen, setPrintOpen] = useState<"one" | "all" | null>(null);
  // Move/Swap mode inside the per-teacher grid: holds the entry being relocated.
  const [moving, setMoving] = useState<ScheduleEntry | null>(null);

  // A teacher's grid isn't section-specific, so only GLOBAL blocks (all sections)
  // are shown as blocked here — grade/section-scoped blocks don't universally apply.
  const globalBlockAt = (day: number, slotId: number) =>
    (blocked.data ?? []).some((b: any) =>
      b.dayOfWeek === day && b.timeSlotId === slotId
      && !(b.sectionIds && b.sectionIds.length) && b.gradeLevelId == null && b.sectionId == null);

  // Teachers narrowed by the subject filter (a teacher matches if they teach that subject).
  const filteredTeachers = useMemo(() => {
    const all = teachers.data ?? [];
    if (subjectFilter === "all") return all;
    return all.filter((t) => (t.subjectIds ?? []).includes(subjectFilter));
  }, [teachers.data, subjectFilter]);

  useEffect(() => {
    if (teachers.data && teachers.data.length > 0) {
      if (activeTeacher == null || !filteredTeachers.some((t) => t.id === activeTeacher)) {
        setActiveTeacher(filteredTeachers[0]?.id ?? null);
      }
    }
  }, [teachers.data, filteredTeachers, activeTeacher]);

  const pickSubjectFilter = () => {
    const subs = subjects.data ?? [];
    Alert.alert("Filter by subject", undefined, [
      { text: "All subjects", onPress: () => setSubjectFilter("all") },
      ...subs.map((s) => ({ text: s.name, onPress: () => setSubjectFilter(s.id) })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  const loading =
    teachers.isLoading || slots.isLoading || settings.isLoading || entries.isLoading;

  const days = settings.data?.activeDays ?? [1, 2, 3, 4, 5];
  const masterDays = masterDay === "all" ? days : days.filter((d) => d === masterDay);
  const schedSlots = useMemo(
    () => [...(slots.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).filter((s) => !s.isBreak),
    [slots.data]
  );
  const teachingSlots = useMemo(
    () => [...(slots.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [slots.data]
  );

  const subjMap = useMemo(() => {
    const m = new Map<number, Subject>();
    (subjects.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects.data]);
  const sectionMap = useMemo(() => {
    const m = new Map<number, Section>();
    (sections.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [sections.data]);
  const roomMap = useMemo(() => {
    const m = new Map<number, { id: number; name: string }>();
    (rooms.data ?? []).forEach((r) => m.set(r.id, r));
    return m;
  }, [rooms.data]);

  const doPrintTeacher = (timeStyle: "default" | "emphasizeTime") => {
    setPrintOpen(null);
    const t = teachers.data?.find((x) => x.id === activeTeacher);
    if (!t) return;
    printTeacherSchedule({
      teacher: t, days, slots: teachingSlots, entries: entries.data ?? [],
      subjMap, sectionMap: sectionMap as any, roomMap: roomMap as any, timeStyle,
      template: settings.data?.printTemplate, heading: settings.data?.printHeading, offset: settings.data?.printOffset, rowHeight: settings.data?.printRowHeight,
    }).catch((e) => Alert.alert("Print failed", String(e)));
  };

  const doPrintAll = (timeStyle: "default" | "emphasizeTime") => {
    setPrintOpen(null);
    if (!teachers.data?.length) return;
    printAllTeachers({
      teachers: teachers.data!, days, slots: teachingSlots, entries: entries.data ?? [],
      subjMap, sectionMap: sectionMap as any, roomMap: roomMap as any, timeStyle,
      template: settings.data?.printTemplate, heading: settings.data?.printHeading, offset: settings.data?.printOffset, rowHeight: settings.data?.printRowHeight,
    }).catch((e) => Alert.alert("Print failed", String(e)));
  };

  const entriesByTeacher = useMemo(() => {
    const m = new Map<number, ScheduleEntry[]>();
    (entries.data ?? []).forEach((e) => {
      if (e.teacherId == null) return;
      if (!m.has(e.teacherId)) m.set(e.teacherId, []);
      m.get(e.teacherId)!.push(e);
    });
    return m;
  }, [entries.data]);

  const teacherClashKeys = useMemo(() => {
    const out = new Map<number, Set<string>>();
    entriesByTeacher.forEach((list, tid) => {
      const seen = new Map<string, number>();
      list.forEach((e) => {
        const k = `${e.dayOfWeek}:${e.timeSlotId}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      });
      const clashes = new Set<string>();
      seen.forEach((n, k) => {
        if (n > 1) clashes.add(k);
      });
      out.set(tid, clashes);
    });
    return out;
  }, [entriesByTeacher]);

  // Perform move (empty target) or swap (occupied by same teacher) of `moving`.
  const placeMoving = (day: number, slotId: number) => {
    const src = moving;
    if (!src || locked) { setMoving(null); return; }
    if (src.dayOfWeek === day && src.timeSlotId === slotId) { setMoving(null); return; }
    if (globalBlockAt(day, slotId)) { setMoving(null); return; }
    const slot = teachingSlots.find((s) => s.id === slotId);
    if (slot?.isBreak) { setMoving(null); return; }
    const tid = activeTeacher;
    const target = tid != null
      ? (entriesByTeacher.get(tid) ?? []).find((e) => e.dayOfWeek === day && e.timeSlotId === slotId)
      : undefined;
    history.record(entries.data);
    if (target && target.id !== src.id) {
      update.mutate({ id: target.id, dayOfWeek: src.dayOfWeek, timeSlotId: src.timeSlotId } as any);
    }
    update.mutate({ id: src.id, dayOfWeek: day, timeSlotId: slotId } as any);
    setMoving(null);
  };

  // Tap handler for a filled cell in the per-teacher grid.
  const onFilledCell = (day: number, slotId: number, entry: ScheduleEntry) => {
    if (locked) return;
    if (moving) { placeMoving(day, slotId); return; }
    Alert.alert(subjMap.get(entry.subjectId)?.name ?? "Class", undefined, [
      { text: "Edit", onPress: () => setEditor({ entry, day, slotId }) },
      { text: "Move / Swap", onPress: () => setMoving(entry) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const onEmptyCell = (day: number, slotId: number) => {
    if (locked) return;
    if (moving) { placeMoving(day, slotId); return; }
    setEditor({ day, slotId });
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

  if (!teachers.data?.length) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.center}>
          <Ionicons name="people-outline" size={56} color={C.sage} />
          <Text style={styles.emptyTitle}>No teachers yet</Text>
          <Text style={styles.emptyText}>
            Add teachers in the Teachers tab, then assign them to classes on the Schedule board.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const COL_W = 116;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* View toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, view === "single" && styles.toggleBtnActive]}
          onPress={() => setView("single")}
        >
          <Ionicons name="calendar-number-outline" size={15} color={view === "single" ? "#fff" : C.forest} />
          <Text style={[styles.toggleText, view === "single" && styles.toggleTextActive]}>Per teacher</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, view === "master" && styles.toggleBtnActive]}
          onPress={() => setView("master")}
        >
          <Ionicons name="grid-outline" size={15} color={view === "master" ? "#fff" : C.forest} />
          <Text style={[styles.toggleText, view === "master" && styles.toggleTextActive]}>Master matrix</Text>
        </TouchableOpacity>
        {view === "single" && activeTeacher != null && (
          <TouchableOpacity style={styles.printBtn} onPress={() => setPrintOpen("one")}>
            <Ionicons name="print-outline" size={16} color={C.brand} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.printBtn} onPress={() => setPrintOpen("all")}>
          <Ionicons name="albums-outline" size={16} color={C.brand} />
        </TouchableOpacity>
      </View>

      {/* Undo / Redo / Save point */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.histScroll} contentContainerStyle={styles.histRow}>
        <TouchableOpacity
          style={[styles.histBtn, (locked || !history.canUndo) && styles.histBtnDisabled]}
          disabled={locked || !history.canUndo}
          onPress={() => history.undo()}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={C.brand} />
          <Text style={styles.histText}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.histBtn, (locked || !history.canRedo) && styles.histBtnDisabled]}
          disabled={locked || !history.canRedo}
          onPress={() => history.redo()}
        >
          <Ionicons name="arrow-redo-outline" size={16} color={C.brand} />
          <Text style={styles.histText}>Redo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.histBtn, locked && styles.histBtnDisabled]}
          disabled={locked}
          onPress={() => { setSavePointName(""); setSavePointNote(""); setSavePointOpen(true); }}
        >
          <Ionicons name="bookmark-outline" size={16} color={C.brand} />
          <Text style={styles.histText}>Save point</Text>
        </TouchableOpacity>
      </ScrollView>

      {moving && view === "single" && (
        <View style={styles.moveBanner}>
          <Ionicons name="swap-horizontal" size={16} color="#fff" />
          <Text style={styles.moveBannerText} numberOfLines={1}>
            Moving {subjMap.get(moving.subjectId)?.name ?? "class"} — tap a cell to move/swap
          </Text>
          <TouchableOpacity onPress={() => setMoving(null)} style={styles.moveCancel}>
            <Text style={styles.moveCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {view === "single" && (
        <>
          <SubjectFilterBar value={subjectFilter} subjects={subjects.data ?? []} onPress={pickSubjectFilter}
            count={filteredTeachers.length} total={teachers.data.length} onClear={() => setSubjectFilter("all")} />

          {/* Teacher switcher */}
          {filteredTeachers.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="people-outline" size={48} color={C.sage} />
              <Text style={styles.emptyTitle}>No teachers match</Text>
              <Text style={styles.emptyText}>Pick a different subject or clear the filter.</Text>
            </View>
          ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pillRow}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: "center" }}
          >
            {filteredTeachers.map((t) => {
              const active = t.id === activeTeacher;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => setActiveTeacher(t.id)}
                >
                  <View style={[styles.dot, { backgroundColor: teacherColor(t.subjectIds, subjects.data) }]} />
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>{t.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          )}

          {activeTeacher != null &&
            (() => {
              const teacher = teachers.data!.find((t) => t.id === activeTeacher);
              if (!teacher) return null;
              const tEntries = entriesByTeacher.get(activeTeacher) ?? [];
              const clashes = teacherClashKeys.get(activeTeacher) ?? new Set<string>();
              const entryAt = (day: number, slotId: number) =>
                tEntries.find((e) => e.dayOfWeek === day && e.timeSlotId === slotId);
              const totalSlots = schedSlots.length * days.length;
              const used = tEntries.length;
              const free = Math.max(0, totalSlots - used);
              const bySubject = tEntries.reduce((acc, e) => {
                acc.set(e.subjectId, (acc.get(e.subjectId) ?? 0) + 1);
                return acc;
              }, new Map<number, number>());

              return (
                <ScrollView style={{ flex: 1 }}>
                  {/* Load summary */}
                  <LoadSummary
                    teacher={teacher}
                    used={used}
                    free={free}
                    totalSlots={totalSlots}
                    clashCount={clashes.size}
                    bySubject={bySubject}
                    subjMap={subjMap}
                  />

                  {/* Grid */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={styles.row}>
                        <View style={styles.cornerCell}>
                          <Text style={styles.headTime}>Time</Text>
                        </View>
                        {days.map((d) => (
                          <View key={d} style={[styles.headCell, { width: COL_W }]}>
                            <Text style={styles.headText}>{DAY_SHORT[d]}</Text>
                          </View>
                        ))}
                      </View>

                      {teachingSlots.map((slot) => (
                        <View key={slot.id} style={styles.row}>
                          <View style={styles.timeCell}>
                            <Text style={styles.slotLabel} numberOfLines={1}>{slot.label}</Text>
                            <Text style={styles.slotTime}>{slot.startTime}</Text>
                          </View>
                          {days.map((d) => {
                            const key = `${d}:${slot.id}`;
                            if (slot.isBreak) {
                              return (
                                <View key={d} style={[styles.cell, styles.breakCell, { width: COL_W }]}>
                                  <Text style={styles.breakText}>{slot.label}</Text>
                                </View>
                              );
                            }
                            const e = entryAt(d, slot.id);
                            const subj = e ? subjMap.get(e.subjectId) : undefined;
                            const sec = e ? sectionMap.get(e.sectionId) : undefined;
                            const room = e?.roomId ? roomMap.get(e.roomId) : undefined;
                            const clash = clashes.has(key);
                            const isBlk = !e && globalBlockAt(d, slot.id);
                            const isMovingSrc = !!moving && !!e && moving.id === e.id;
                            const isMoveTarget = !!moving && !isMovingSrc && !isBlk;
                            return (
                              <TouchableOpacity
                                key={d}
                                style={[
                                  styles.cell,
                                  { width: COL_W },
                                  isMovingSrc && styles.movingSrcCell,
                                  isMoveTarget && styles.moveTargetCell,
                                ]}
                                onPress={() => (e ? onFilledCell(d, slot.id, e) : onEmptyCell(d, slot.id))}
                              >
                                {e ? (
                                  <View
                                    style={[
                                      styles.entryBox,
                                      { backgroundColor: subj?.color || NO_COLOR },
                                      clash && styles.clashBox,
                                    ]}
                                  >
                                    {clash && (
                                      <Ionicons
                                        name="warning"
                                        size={12}
                                        color="#fff"
                                        style={styles.clashIcon}
                                      />
                                    )}
                                    <Text style={styles.entrySubj} numberOfLines={2}>{subj?.name ?? "?"}</Text>
                                    {sec && <Text style={styles.entryMeta} numberOfLines={1}>{sec.name}</Text>}
                                    {room && <Text style={styles.entryMetaDim} numberOfLines={1}>{room.name}</Text>}
                                  </View>
                                ) : isBlk ? (
                                  <View style={styles.blockedBox}>
                                    <Ionicons name="lock-closed" size={13} color={C.muted} />
                                    <Text style={styles.blockedText}>Blocked</Text>
                                  </View>
                                ) : (
                                  <Ionicons name="add" size={18} color={C.sage} />
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                  <View style={{ height: 28 }} />
                </ScrollView>
              );
            })()}
        </>
      )}

      {view === "master" && (
        <ScrollView style={{ flex: 1 }}>
          <SubjectFilterBar value={subjectFilter} subjects={subjects.data ?? []} onPress={pickSubjectFilter}
            count={filteredTeachers.length} total={teachers.data.length} onClear={() => setSubjectFilter("all")} />

          {/* Day filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayFilterRow}
          >
            <TouchableOpacity
              style={[styles.dayPill, masterDay === "all" && styles.dayPillActive]}
              onPress={() => setMasterDay("all")}
            >
              <Text style={[styles.dayPillText, masterDay === "all" && styles.dayPillTextActive]}>All days</Text>
            </TouchableOpacity>
            {days.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.dayPill, masterDay === d && styles.dayPillActive]}
                onPress={() => setMasterDay(d)}
              >
                <Text style={[styles.dayPillText, masterDay === d && styles.dayPillTextActive]}>{DAY_SHORT[d]}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {/* Header */}
              <View style={styles.row}>
                <View style={[styles.mTeacherHead]}>
                  <Text style={styles.headText}>Teacher</Text>
                </View>
                {masterDays.map((d) =>
                  schedSlots.map((slot) => (
                    <View key={`${d}:${slot.id}`} style={styles.mHeadCell}>
                      <Text style={styles.mHeadDay}>{DAY_SHORT[d]}</Text>
                      <Text style={styles.mHeadSlot} numberOfLines={1}>{slot.label}</Text>
                    </View>
                  ))
                )}
                <View style={styles.mLoadHead}>
                  <Text style={styles.headText}>Load</Text>
                </View>
              </View>

              {filteredTeachers.length === 0 && (
                <View style={{ padding: 18 }}>
                  <Text style={styles.emptyText}>No teachers match this subject.</Text>
                </View>
              )}
              {filteredTeachers.map((t, ri) => {
                const tEntries = entriesByTeacher.get(t.id) ?? [];
                const clashes = teacherClashKeys.get(t.id) ?? new Set<string>();
                const entryAt = (day: number, slotId: number) =>
                  tEntries.find((e) => e.dayOfWeek === day && e.timeSlotId === slotId);
                return (
                  <View key={t.id} style={[styles.row, ri % 2 === 1 && styles.rowAlt]}>
                    <View style={[styles.mTeacherCell]}>
                      <View style={[styles.dot, { backgroundColor: teacherColor(t.subjectIds, subjects.data) }]} />
                      <Text style={styles.mTeacherName} numberOfLines={1}>{t.name}</Text>
                    </View>
                    {masterDays.map((d) =>
                      schedSlots.map((slot) => {
                        const key = `${d}:${slot.id}`;
                        const e = entryAt(d, slot.id);
                        const subj = e ? subjMap.get(e.subjectId) : undefined;
                        const sec = e ? sectionMap.get(e.sectionId) : undefined;
                        const clash = clashes.has(key);
                        return (
                          <TouchableOpacity
                            key={key}
                            style={styles.mCell}
                            disabled={!e}
                            onPress={() => { if (!locked && e) setEditor({ entry: e, day: d, slotId: slot.id }); }}
                          >
                            {e ? (
                              <View
                                style={[
                                  styles.mEntryBox,
                                  { backgroundColor: subj?.color || NO_COLOR },
                                  clash && styles.clashBox,
                                ]}
                              >
                                <Text style={styles.mEntryCode} numberOfLines={1}>
                                  {subj?.code ?? subj?.name ?? "?"}
                                </Text>
                                <Text style={styles.mEntrySec} numberOfLines={1}>{sec?.name ?? ""}</Text>
                              </View>
                            ) : (
                              <View style={styles.mEmpty} />
                            )}
                          </TouchableOpacity>
                        );
                      })
                    )}
                    <View style={styles.mLoadCell}>
                      <Text style={styles.mLoadText}>
                        {tEntries.length}{t.maxLoad ? `/${t.maxLoad}` : ""}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
          <View style={{ height: 28 }} />
        </ScrollView>
      )}

      {editor && (
        <TeacherCellEditor
          editor={editor}
          teacherId={activeTeacher ?? editor.entry?.teacherId ?? null}
          sections={sections.data ?? []}
          subjects={subjects.data ?? []}
          teachers={teachers.data ?? []}
          rooms={rooms.data ?? []}
          slots={slots.data ?? []}
          entries={entries.data ?? []}
          onRecord={() => history.record(entries.data)}
          onClose={() => setEditor(null)}
        />
      )}

      <TchPrintModal
        visible={printOpen !== null}
        scope={printOpen}
        onClose={() => setPrintOpen(null)}
        onPrint={(timeStyle) => (printOpen === "all" ? doPrintAll(timeStyle) : doPrintTeacher(timeStyle))}
      />

      <Modal visible={savePointOpen} transparent animationType="fade" onRequestClose={() => setSavePointOpen(false)}>
        <View style={styles.spOverlay}>
          <View style={styles.spCard}>
            <Text style={styles.spTitle}>Create save point</Text>
            <Text style={styles.spDesc}>
              Captures your entire configuration and schedule so you can roll back to this exact state from Setup → Save Points.
            </Text>
            <TextInput
              style={styles.spInput}
              placeholder="Name (optional)"
              placeholderTextColor={C.muted}
              value={savePointName}
              onChangeText={setSavePointName}
              autoFocus
            />
            <TextInput
              style={styles.spInput}
              placeholder="Note (optional)"
              placeholderTextColor={C.muted}
              value={savePointNote}
              onChangeText={setSavePointNote}
            />
            <View style={styles.spBtnRow}>
              <TouchableOpacity style={styles.spCancelBtn} onPress={() => setSavePointOpen(false)}>
                <Text style={styles.spCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.spSaveBtn}
                disabled={createSavePoint.isPending}
                onPress={() => createSavePoint.mutate({ name: savePointName.trim() || undefined, note: savePointNote.trim() || null }, { onSuccess: () => setSavePointOpen(false) })}
              >
                <Ionicons name="bookmark" size={16} color="#fff" />
                <Text style={styles.spSaveText}>{createSavePoint.isPending ? "Saving…" : "Save snapshot"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TchPrintModal({
  visible,
  scope,
  onClose,
  onPrint,
}: {
  visible: boolean;
  scope: "one" | "all" | null;
  onClose: () => void;
  onPrint: (timeStyle: "default" | "emphasizeTime") => void;
}) {
  const [style, setStyle] = useState<"default" | "emphasizeTime">("default");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.printOverlay}>
        <View style={styles.printCard}>
          <Text style={styles.printTitle}>
            {scope === "all" ? "Print all teachers" : "Print teacher schedule"}
          </Text>

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

          <TouchableOpacity style={styles.printScopeBtn} onPress={() => onPrint(style)}>
            <Ionicons name="print-outline" size={16} color={C.brand} />
            <Text style={styles.printScopeText}>
              {scope === "all" ? "Print all teachers" : "Print this teacher"}
            </Text>
          </TouchableOpacity>

          <View style={styles.printBtnRow}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.printCancelBtn} onPress={onClose}>
              <Text style={styles.printCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SubjectFilterBar({ value, subjects, onPress, onClear, count, total }: {
  value: number | "all"; subjects: Subject[]; onPress: () => void; onClear: () => void; count: number; total: number;
}) {
  const active = value !== "all";
  const label = active ? (subjects.find((s) => s.id === value)?.name ?? "Subject") : "All subjects";
  return (
    <View style={styles.filterBar}>
      <Ionicons name="filter-outline" size={15} color={C.muted} />
      <TouchableOpacity style={[styles.filterPill, active && styles.filterPillActive]} onPress={onPress}>
        <Text style={[styles.filterPillText, active && { color: "#fff" }]} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={13} color={active ? "#fff" : C.forest} />
      </TouchableOpacity>
      {active && (
        <>
          <Text style={styles.filterCount}>{count}/{total}</Text>
          <TouchableOpacity onPress={onClear} style={styles.filterClear}>
            <Ionicons name="close-circle" size={18} color={C.muted} />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function LoadSummary({
  teacher,
  used,
  free,
  totalSlots,
  clashCount,
  bySubject,
  subjMap,
}: {
  teacher: Teacher;
  used: number;
  free: number;
  totalSlots: number;
  clashCount: number;
  bySubject: Map<number, number>;
  subjMap: Map<number, Subject>;
}) {
  const pct = totalSlots ? Math.round((used / totalSlots) * 100) : 0;
  const over = teacher.maxLoad != null && used > teacher.maxLoad;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHead}>
        <Ionicons name="time-outline" size={18} color={C.brand} />
        <Text style={styles.summaryTitle}>Teaching Load — {teacher.name}</Text>
      </View>

      <View style={styles.statRow}>
        <Stat label="Periods/wk" value={String(used)} />
        <Stat label="Free" value={String(free)} />
        <Stat label="Util." value={`${pct}%`} />
        <Stat label="Max" value={teacher.maxLoad != null ? String(teacher.maxLoad) : "—"} danger={over} />
      </View>

      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.min(100, pct)}%`, backgroundColor: over ? C.danger : C.brand },
          ]}
        />
      </View>

      {over && (
        <View style={styles.warnRow}>
          <Ionicons name="warning" size={13} color={C.danger} />
          <Text style={styles.warnText}>Over max load by {used - teacher.maxLoad!} period(s).</Text>
        </View>
      )}
      {clashCount > 0 && (
        <View style={styles.warnRow}>
          <Ionicons name="warning" size={13} color={C.danger} />
          <Text style={styles.warnText}>{clashCount} double-booked slot(s).</Text>
        </View>
      )}

      <Text style={styles.subjHead}>By subject</Text>
      {bySubject.size === 0 ? (
        <Text style={styles.emptyText}>No classes assigned.</Text>
      ) : (
        [...bySubject.entries()].map(([sid, n]) => {
          const s = subjMap.get(sid);
          return (
            <View key={sid} style={styles.subjRow}>
              <View style={[styles.subjDot, { backgroundColor: s?.color || NO_COLOR }]} />
              <Text style={styles.subjName} numberOfLines={1}>{s?.name ?? "?"}</Text>
              <Text style={styles.subjCount}>{n}</Text>
            </View>
          );
        })
      )}

      <Text style={styles.loadDisclaimer}>
        Note: This load reflects scheduled face-to-face meetings only and may not represent the teacher's actual total loading. Asynchronous sessions are not captured in the scheduler.
      </Text>
    </View>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, danger && { color: C.danger }]}>{value}</Text>
    </View>
  );
}

function TeacherCellEditor({
  editor,
  teacherId,
  sections,
  subjects,
  teachers,
  rooms,
  slots,
  entries,
  onRecord,
  onClose,
}: {
  editor: { entry?: ScheduleEntry; day: number; slotId: number };
  teacherId: number | null;
  sections: Section[];
  subjects: Subject[];
  teachers: Teacher[];
  rooms: { id: number; name: string }[];
  slots: { id: number; label: string }[];
  entries: ScheduleEntry[];
  onRecord: () => void;
  onClose: () => void;
}) {
  const { create, update } = useEntryMutations();
  const { entry, day, slotId } = editor;

  const [sectionId, setSectionId] = useState<number | null>(
    entry?.sectionId ?? sections[0]?.id ?? null
  );
  const [subjectId, setSubjectId] = useState<number | null>(entry?.subjectId ?? subjects[0]?.id ?? null);
  const [roomId, setRoomId] = useState<number | null>(entry?.roomId ?? null);
  const [transferTo, setTransferTo] = useState<number | null>(null);

  // Teachers eligible to receive this class (teach this subject + serve this grade if set).
  const transferTeachers = useMemo(() => {
    if (!entry) return [];
    const sec = sections.find((s) => s.id === entry.sectionId);
    const gradeId = sec?.gradeLevelId;
    return teachers.filter((t) => {
      if (t.id === entry.teacherId) return false;
      const teachesSubj = (t.subjectIds ?? []).length === 0 || (t.subjectIds ?? []).includes(entry.subjectId);
      const serves = !gradeId || !(t.gradeLevelIds ?? []).length || (t.gradeLevelIds ?? []).includes(gradeId);
      return teachesSubj && serves;
    });
  }, [entry, teachers, sections]);

  function doTransfer() {
    if (!entry || transferTo == null) return;
    onRecord();
    update.mutate({ id: entry.id, teacherId: transferTo } as any, { onSuccess: onClose });
  }

  const slotLabel = slots.find((s) => s.id === slotId)?.label;

  const targetEntry = useMemo(() => {
    if (entry && entry.sectionId === sectionId) return entry;
    return entries.find((e) => e.sectionId === sectionId && e.dayOfWeek === day && e.timeSlotId === slotId);
  }, [entry, entries, sectionId, day, slotId]);

  const busy = create.isPending || update.isPending;

  function save() {
    if (sectionId == null || subjectId == null) return;
    onRecord();
    if (targetEntry) {
      update.mutate(
        { id: targetEntry.id, subjectId, roomId, teacherId } as any,
        { onSuccess: onClose }
      );
    } else {
      create.mutate(
        { sectionId, dayOfWeek: day, timeSlotId: slotId, subjectId, teacherId, roomId } as any,
        { onSuccess: onClose }
      );
    }
  }

  function unassign() {
    if (!entry) return;
    onRecord();
    update.mutate({ id: entry.id, teacherId: null } as any, { onSuccess: onClose });
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{DAY_SHORT[day]} · {slotLabel ?? ""}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={C.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 440 }}>
            <Text style={styles.label}>Section</Text>
            <View style={styles.chipWrap}>
              {sections.map((s) => {
                const disabled = !!entry;
                const sel = sectionId === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    disabled={disabled}
                    style={[
                      styles.chip,
                      sel && { backgroundColor: C.brand, borderColor: C.brand },
                      disabled && !sel && { opacity: 0.4 },
                    ]}
                    onPress={() => setSectionId(s.id)}
                  >
                    <Text style={[styles.chipText, sel && { color: "#fff" }]}>{s.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Subject</Text>
            <View style={styles.chipWrap}>
              {subjects.map((s) => {
                const sel = subjectId === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.chip, sel && { backgroundColor: C.brand, borderColor: C.brand }]}
                    onPress={() => setSubjectId(s.id)}
                  >
                    <Text style={[styles.chipText, sel && { color: "#fff" }]}>{s.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Room</Text>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                style={[styles.chip, roomId === null && { backgroundColor: C.brand, borderColor: C.brand }]}
                onPress={() => setRoomId(null)}
              >
                <Text style={[styles.chipText, roomId === null && { color: "#fff" }]}>None</Text>
              </TouchableOpacity>
              {rooms.map((r) => {
                const sel = roomId === r.id;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.chip, sel && { backgroundColor: C.brand, borderColor: C.brand }]}
                    onPress={() => setRoomId(r.id)}
                  >
                    <Text style={[styles.chipText, sel && { color: "#fff" }]}>{r.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {entry && transferTeachers.length > 0 && (
              <>
                <View style={styles.transferDivider} />
                <Text style={styles.label}>Transfer to teacher</Text>
                <View style={styles.chipWrap}>
                  {transferTeachers.map((t) => {
                    const sel = transferTo === t.id;
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.chip, sel && { backgroundColor: C.forest, borderColor: C.forest }]}
                        onPress={() => setTransferTo(sel ? null : t.id)}
                      >
                        <Text style={[styles.chipText, sel && { color: "#fff" }]}>{t.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  style={[styles.transferBtn, transferTo == null && { opacity: 0.5 }]}
                  disabled={transferTo == null || busy}
                  onPress={doTransfer}
                >
                  <Ionicons name="swap-horizontal" size={16} color="#fff" />
                  <Text style={styles.transferBtnText}>Transfer this class</Text>
                </TouchableOpacity>
                <Text style={styles.hint}>Reassigns only this one class to the chosen teacher.</Text>
              </>
            )}

            {!entry && (
              <Text style={styles.hint}>
                Assigns this teacher to the selected section's {slotLabel} slot. If a class already
                exists there it's updated; otherwise a new one is created.
              </Text>
            )}
          </ScrollView>

          <View style={styles.modalActions}>
            {entry && (
              <TouchableOpacity style={styles.unassignBtn} disabled={busy} onPress={unassign}>
                <Text style={styles.unassignText}>Unassign</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { flex: 1, opacity: busy || sectionId == null || subjectId == null ? 0.5 : 1 },
              ]}
              disabled={busy || sectionId == null || subjectId == null}
              onPress={save}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: C.text, marginTop: 8 },
  emptyText: { color: C.muted, marginBottom: 12, textAlign: "center" },

  toggleRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  histScroll: { flexGrow: 0, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  histRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  histBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderWidth: 1, borderColor: C.brand, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  histBtnDisabled: { opacity: 0.4 },
  histText: { color: C.brand, fontWeight: "700", fontSize: 13 },
  spOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  spCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 420, gap: 12 },
  spTitle: { fontSize: 17, fontWeight: "800", color: C.forest },
  spDesc: { fontSize: 13, color: C.muted, lineHeight: 18 },
  spInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.forest },
  spBtnRow: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  spCancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  spCancelText: { color: C.forest, fontWeight: "700", fontSize: 14 },
  spSaveBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.brand, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  spSaveText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  toggleBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg },
  printBtn: { marginLeft: "auto", alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: C.brand, backgroundColor: "#fff" },
  toggleBtnActive: { backgroundColor: C.brand, borderColor: C.brand },
  toggleText: { color: C.forest, fontWeight: "700", fontSize: 13 },
  toggleTextActive: { color: "#fff" },

  filterBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  filterPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, maxWidth: 220 },
  filterPillActive: { backgroundColor: C.brand, borderColor: C.brand },
  filterPillText: { color: C.forest, fontWeight: "700", fontSize: 13 },
  filterCount: { color: C.muted, fontSize: 12, fontWeight: "600" },
  filterClear: { padding: 2 },

  dayFilterRow: { gap: 8, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  dayPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  dayPillActive: { backgroundColor: C.brand, borderColor: C.brand },
  dayPillText: { color: C.forest, fontWeight: "700", fontSize: 13 },
  dayPillTextActive: { color: "#fff" },

  pillRow: { flexGrow: 0, paddingVertical: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  pillActive: { backgroundColor: C.brand, borderColor: C.brand },
  pillText: { color: C.text, fontWeight: "600", fontSize: 13 },
  pillTextActive: { color: "#fff" },
  dot: { width: 9, height: 9, borderRadius: 5 },

  row: { flexDirection: "row" },
  rowAlt: { backgroundColor: "rgba(0,0,0,0.02)" },
  cornerCell: { width: 70, padding: 6, backgroundColor: C.forest, justifyContent: "center", alignItems: "center", borderWidth: 0.5, borderColor: C.border },
  headTime: { color: "#fff", fontWeight: "700", fontSize: 11 },
  headCell: { padding: 8, backgroundColor: C.brand, justifyContent: "center", alignItems: "center", borderWidth: 0.5, borderColor: C.border },
  headText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  timeCell: { width: 70, padding: 6, backgroundColor: C.card, justifyContent: "center", borderWidth: 0.5, borderColor: C.border },
  slotLabel: { fontSize: 11, fontWeight: "700", color: C.text },
  slotTime: { fontSize: 9, color: C.muted },
  cell: { minHeight: 72, padding: 4, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border, justifyContent: "center", alignItems: "center" },
  breakCell: { backgroundColor: C.cream },
  breakText: { color: C.wood, fontSize: 11, fontWeight: "600" },
  entryBox: { flex: 1, alignSelf: "stretch", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 5, justifyContent: "center" },
  clashBox: { borderWidth: 2, borderColor: C.danger },
  clashIcon: { position: "absolute", top: 3, right: 3 },
  entrySubj: { fontSize: 12, fontWeight: "700", color: "#fff" },
  entryMeta: { fontSize: 10, color: "rgba(255,255,255,0.9)" },
  entryMetaDim: { fontSize: 10, color: "rgba(255,255,255,0.75)" },

  // master matrix
  mTeacherHead: { width: 120, padding: 8, backgroundColor: C.forest, justifyContent: "center", borderWidth: 0.5, borderColor: C.border },
  mHeadCell: { width: 64, padding: 4, backgroundColor: C.forest, justifyContent: "center", alignItems: "center", borderWidth: 0.5, borderColor: "rgba(255,255,255,0.1)" },
  mHeadDay: { color: "#fff", fontWeight: "700", fontSize: 10 },
  mHeadSlot: { color: "rgba(255,255,255,0.6)", fontSize: 9 },
  mLoadHead: { width: 54, padding: 4, backgroundColor: C.forest, justifyContent: "center", alignItems: "center", borderWidth: 0.5, borderColor: C.border },
  mTeacherCell: { width: 120, padding: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border },
  mTeacherName: { fontSize: 12, fontWeight: "700", color: C.forest, flex: 1 },
  mCell: { width: 64, padding: 2, borderWidth: 0.5, borderColor: C.border, justifyContent: "center" },
  mEntryBox: { borderRadius: 5, paddingHorizontal: 3, paddingVertical: 3, minHeight: 36, justifyContent: "center" },
  mEntryCode: { fontSize: 10, fontWeight: "700", color: "#fff" },
  mEntrySec: { fontSize: 9, color: "rgba(255,255,255,0.85)" },
  mEmpty: { minHeight: 36 },
  mLoadCell: { width: 54, justifyContent: "center", alignItems: "center", borderWidth: 0.5, borderColor: C.border },
  mLoadText: { fontSize: 12, fontWeight: "700", color: C.forest },

  // summary
  summaryCard: { margin: 12, padding: 14, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, gap: 10 },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle: { fontSize: 15, fontWeight: "800", color: C.forest, flex: 1 },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 8 },
  statLabel: { fontSize: 10, color: C.muted },
  statValue: { fontSize: 17, fontWeight: "800", color: C.forest },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: C.bg, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4 },
  warnRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(192,57,43,0.1)", borderRadius: 8, padding: 8 },
  warnText: { color: C.danger, fontSize: 12, flex: 1 },
  subjHead: { fontSize: 11, fontWeight: "700", color: C.muted, textTransform: "uppercase", marginTop: 2 },
  subjRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  subjDot: { width: 12, height: 12, borderRadius: 3 },
  subjName: { flex: 1, fontSize: 13, color: C.text },
  subjCount: { fontSize: 13, fontWeight: "700", color: C.forest },
  loadDisclaimer: { fontSize: 10, lineHeight: 14, color: C.muted, fontStyle: "italic", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },

  // modal
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: C.text },
  label: { fontSize: 13, fontWeight: "700", color: C.text, marginTop: 14, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  chipText: { color: C.text, fontSize: 13, fontWeight: "600" },
  hint: { fontSize: 12, color: C.muted, marginTop: 14, lineHeight: 17 },
  blockedBox: { alignItems: "center", justifyContent: "center", gap: 3 },
  blockedText: { color: C.muted, fontSize: 10, fontWeight: "700" },
  moveTargetCell: { borderWidth: 2, borderColor: C.brand, borderStyle: "dashed" },
  movingSrcCell: { borderWidth: 2, borderColor: (C as any).bright ?? C.brand, opacity: 0.55 },
  moveBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.brand, paddingHorizontal: 12, paddingVertical: 9, marginHorizontal: 12, marginTop: 8, borderRadius: 10 },
  moveBannerText: { color: "#fff", fontWeight: "700", fontSize: 12, flex: 1 },
  moveCancel: { backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  moveCancelText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  transferDivider: { height: 1, backgroundColor: C.border, marginTop: 18, marginBottom: 4 },
  transferBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.forest, paddingVertical: 13, borderRadius: 10, marginTop: 10 },
  transferBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 18, alignItems: "center" },
  unassignBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: C.danger },
  unassignText: { color: C.danger, fontWeight: "700", fontSize: 14 },
  primaryBtn: { backgroundColor: C.brand, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  printOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  printCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20, gap: 12 },
  printTitle: { fontSize: 17, fontWeight: "800", color: C.text },
  printLabel: { fontSize: 11, fontWeight: "800", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 },
  printStyleRow: { flexDirection: "row", gap: 10 },
  printStyleBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center" },
  printStyleBtnActive: { borderColor: C.brand, backgroundColor: C.brand + "14" },
  printStyleText: { fontSize: 12, fontWeight: "600", color: C.text, textAlign: "center" },
  printStyleTextActive: { color: C.brand, fontWeight: "800" },
  printScopeBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14, marginTop: 4 },
  printScopeText: { fontSize: 14, fontWeight: "700", color: C.text },
  printBtnRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  printCancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  printCancelText: { fontSize: 14, fontWeight: "700", color: C.muted },
});
