import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { api } from "./api";

export interface GradeLevel { id: number; name: string; sortOrder: number }
export interface Section { id: number; name: string; gradeLevelId: number; adviser: string | null }
export interface Subject { id: number; name: string; code: string | null; color: string | null; sortOrder: number }
export interface Teacher { id: number; name: string; email: string | null; subjectIds: number[]; gradeLevelIds: number[]; maxLoad: number | null; color: string }
export interface Room { id: number; name: string; capacity: number | null }
export interface TimeSlot { id: number; label: string; startTime: string; endTime: string; sortOrder: number; isBreak: boolean }
export interface BlockedTime { id: number; dayOfWeek: number; timeSlotId: number; sectionId: number | null; reason: string | null }
export interface ScheduleEntry { id: number; sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId: number | null; roomId: number | null }
export interface TabConfigItem { key: string; visible: boolean }
export interface AppSettings { id: number; activeDays: number[]; schoolName: string; tabConfig?: TabConfigItem[] | null; locked?: boolean; hasLockPassword?: boolean; printTemplate?: string | null; printHeading?: string | null; printOffset?: number | null; printRowHeight?: number | null }
export interface Conflict { type: string; severity: "error" | "warning"; message: string; entryIds: number[]; sectionId?: number }
export interface SuggestedEntry { sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId: number | null; roomId: number | null }
export interface Allocation { id: number; gradeLevelId: number; subjectId: number; periodsPerWeek: number }
export interface SavePoint { id: number; name: string; note: string | null; entryCount: number; sectionCount: number; createdAt: string | number | Date }

export const useGradeLevels = () => useQuery({ queryKey: ["grade-levels"], queryFn: async () => (await api["grade-levels"].$get()).json() as Promise<GradeLevel[]> });
export const useSections = () => useQuery({ queryKey: ["sections"], queryFn: async () => (await api.sections.$get()).json() as Promise<Section[]> });
export const useSubjects = () => useQuery({ queryKey: ["subjects"], queryFn: async () => (await api.subjects.$get()).json() as Promise<Subject[]> });
export const useTeachers = () => useQuery({ queryKey: ["teachers"], queryFn: async () => (await api.teachers.$get()).json() as Promise<Teacher[]> });
export const useRooms = () => useQuery({ queryKey: ["rooms"], queryFn: async () => (await api.rooms.$get()).json() as Promise<Room[]> });
export const useTimeSlots = () => useQuery({ queryKey: ["time-slots"], queryFn: async () => (await api["time-slots"].$get()).json() as Promise<TimeSlot[]> });
export const useBlockedTimes = () => useQuery({ queryKey: ["blocked-times"], queryFn: async () => (await api["blocked-times"].$get()).json() as Promise<BlockedTime[]> });
export const useEntries = () => useQuery({ queryKey: ["entries"], queryFn: async () => (await api.entries.$get()).json() as Promise<ScheduleEntry[]> });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: async () => (await api.settings.$get()).json() as Promise<AppSettings> });
export function useSettingsMutation() {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: async (patch: Partial<Pick<AppSettings, "activeDays" | "schoolName" | "tabConfig">>) =>
      (await api.settings.$put({ json: patch } as any)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  return { update };
}

// ---- lockdown ----
export function useLocked(): boolean {
  const { data } = useSettings();
  return !!data?.locked;
}
export function useLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      const res = await (api as any).settings.lock.$post({ json: { password } });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to lock");
      return res.json() as Promise<AppSettings>;
    },
    onSuccess: (data: any) => qc.setQueryData(["settings"], data),
  });
}
export function useUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      const res = await (api as any).settings.unlock.$post({ json: { password } });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to unlock");
      return res.json() as Promise<AppSettings>;
    },
    onSuccess: (data: any) => qc.setQueryData(["settings"], data),
  });
}
export function useChangeLockPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { current?: string; next: string }) => {
      const res = await (api as any).settings["lock-password"].$post({ json: vars });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to change password");
      return res.json() as Promise<AppSettings>;
    },
    onSuccess: (data: any) => qc.setQueryData(["settings"], data),
  });
}

export const useConflicts = () => useQuery({ queryKey: ["conflicts"], queryFn: async () => (await api.conflicts.$get()).json() as Promise<{ conflicts: Conflict[] }> });
export const useAllocations = () => useQuery({ queryKey: ["allocations"], queryFn: async () => (await api.allocations.$get()).json() as Promise<Allocation[]> });

export function useEntryMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["entries"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const create = useMutation({ mutationFn: async (e: any) => (await api.entries.$post({ json: e })).json(), onSuccess: refresh });
  const update = useMutation({ mutationFn: async ({ id, ...e }: any) => (await api.entries[":id"].$put({ param: { id: String(id) }, json: e } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api.entries[":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: refresh });
  const bulk = useMutation({ mutationFn: async (entries: SuggestedEntry[]) => (await api.entries.bulk.$post({ json: { entries } })).json(), onSuccess: refresh });
  const clear = useMutation({ mutationFn: async (sectionId?: number) => (await api.entries.clear.$post({ json: { sectionId } })).json(), onSuccess: refresh });
  return { create, update, remove, bulk, clear };
}

export function useAutofill() {
  return useMutation({ mutationFn: async (sectionIds: number[]) => (await api.autofill.$post({ json: { sectionIds } })).json() as Promise<{ suggestions: SuggestedEntry[]; projectedConflicts: Conflict[] }> });
}

export function useSeed() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async () => (await api.seed.$post()).json(), onSuccess: () => qc.invalidateQueries() });
}

export function useTeacherMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["teachers"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const save = useMutation({ mutationFn: async (t: any) => t.id ? (await api.teachers[":id"].$put({ param: { id: String(t.id) }, json: t } as any)).json() : (await api.teachers.$post({ json: t } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api.teachers[":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: refresh });
  const clearAll = useMutation({ mutationFn: async () => (await (api.teachers as any).clear.$post()).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); } });
  return { save, remove, clearAll };
}

export function useSubjectMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["subjects"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const save = useMutation({ mutationFn: async (s: any) => s.id ? (await api.subjects[":id"].$put({ param: { id: String(s.id) }, json: s } as any)).json() : (await api.subjects.$post({ json: s } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api.subjects[":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); } });
  const clearAll = useMutation({ mutationFn: async () => (await (api.subjects as any).clear.$post()).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); qc.invalidateQueries({ queryKey: ["allocations"] }); } });
  return { save, remove, clearAll };
}

export function useGradeMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["grade-levels"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const save = useMutation({ mutationFn: async (g: any) => g.id ? (await api["grade-levels"][":id"].$put({ param: { id: String(g.id) }, json: g } as any)).json() : (await api["grade-levels"].$post({ json: g } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api["grade-levels"][":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["sections"] }); } });
  const clearAll = useMutation({ mutationFn: async () => (await (api["grade-levels"] as any).clear.$post()).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["sections"] }); qc.invalidateQueries({ queryKey: ["allocations"] }); qc.invalidateQueries({ queryKey: ["entries"] }); qc.invalidateQueries({ queryKey: ["blocked-times"] }); } });
  return { save, remove, clearAll };
}

export function useSectionMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["sections"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const save = useMutation({ mutationFn: async (s: any) => s.id ? (await api.sections[":id"].$put({ param: { id: String(s.id) }, json: s } as any)).json() : (await api.sections.$post({ json: s } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api.sections[":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); } });
  const clearAll = useMutation({ mutationFn: async () => (await (api.sections as any).clear.$post()).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); qc.invalidateQueries({ queryKey: ["blocked-times"] }); } });
  return { save, remove, clearAll };
}

export function useRoomMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["rooms"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const save = useMutation({ mutationFn: async (r: any) => r.id ? (await api.rooms[":id"].$put({ param: { id: String(r.id) }, json: r } as any)).json() : (await api.rooms.$post({ json: r } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api.rooms[":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); } });
  const clearAll = useMutation({ mutationFn: async () => (await (api.rooms as any).clear.$post()).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); } });
  return { save, remove, clearAll };
}

export function useTimeSlotMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["time-slots"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const save = useMutation({ mutationFn: async (s: any) => s.id ? (await api["time-slots"][":id"].$put({ param: { id: String(s.id) }, json: s } as any)).json() : (await api["time-slots"].$post({ json: s } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api["time-slots"][":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); qc.invalidateQueries({ queryKey: ["blocked-times"] }); } });
  const clearAll = useMutation({ mutationFn: async () => (await (api["time-slots"] as any).clear.$post()).json(), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["entries"] }); qc.invalidateQueries({ queryKey: ["blocked-times"] }); } });
  return { save, remove, clearAll };
}

export function useBlockedTimeMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["blocked-times"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  const create = useMutation({ mutationFn: async (b: any) => (await api["blocked-times"].$post({ json: b } as any)).json(), onSuccess: refresh });
  const update = useMutation({ mutationFn: async ({ id, ...b }: any) => (await api["blocked-times"][":id"].$put({ param: { id: String(id) }, json: b } as any)).json(), onSuccess: refresh });
  const remove = useMutation({ mutationFn: async (id: number) => (await api["blocked-times"][":id"].$delete({ param: { id: String(id) } })).json(), onSuccess: refresh });
  const clearAll = useMutation({ mutationFn: async () => (await (api["blocked-times"] as any).clear.$post()).json(), onSuccess: refresh });
  return { create, update, remove, clearAll };
}

export function useAllocationMutations() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["allocations"] }); qc.invalidateQueries({ queryKey: ["conflicts"] }); };
  // POST upserts by (gradeLevelId, subjectId)
  const set = useMutation({ mutationFn: async (a: { gradeLevelId: number; subjectId: number; periodsPerWeek: number }) => (await api.allocations.$post({ json: a } as any)).json(), onSuccess: refresh });
  const clearAll = useMutation({ mutationFn: async () => (await (api.allocations as any).clear.$post()).json(), onSuccess: refresh });
  return { set, clearAll };
}

// ---- save points (full-config snapshots + rollback) ----
const refreshAll = (qc: ReturnType<typeof useQueryClient>) =>
  ["grade-levels", "sections", "subjects", "teachers", "rooms", "time-slots", "blocked-times", "allocations", "entries", "settings", "conflicts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

export const useSavePoints = () => useQuery({ queryKey: ["save-points"], queryFn: async () => (await (api as any)["save-points"].$get()).json() as Promise<SavePoint[]> });

export function useCreateSavePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name?: string; note?: string | null }) => (await (api as any)["save-points"].$post({ json: vars })).json() as Promise<SavePoint>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["save-points"] }),
  });
}

export function useRestoreSavePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await (api as any)["save-points"][":id"].restore.$post({ param: { id: String(id) } })).json(),
    onSuccess: () => refreshAll(qc),
  });
}

export function useDeleteSavePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await (api as any)["save-points"][":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["save-points"] }),
  });
}

// ---- session-scoped multi-step undo/redo (snapshot-based, mobile: buttons only) ----
type EntrySnap = { sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId: number | null; roomId: number | null }[];
const HIST_MAX = 50;
const undoStack: EntrySnap[] = [];
const redoStack: EntrySnap[] = [];
const histListeners = new Set<() => void>();
const notifyHist = () => histListeners.forEach((l) => l());
const stripSnap = (e: ScheduleEntry[]): EntrySnap =>
  e.map((x) => ({ sectionId: x.sectionId, dayOfWeek: x.dayOfWeek, timeSlotId: x.timeSlotId, subjectId: x.subjectId, teacherId: x.teacherId, roomId: x.roomId }));

export function useHistory() {
  const qc = useQueryClient();
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    histListeners.add(force);
    return () => { histListeners.delete(force); };
  }, []);
  const apply = async (snap: EntrySnap) => {
    await (api as any).entries.replace.$post({ json: { entries: snap } });
    qc.invalidateQueries({ queryKey: ["entries"] });
    qc.invalidateQueries({ queryKey: ["conflicts"] });
  };
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    record: (current: ScheduleEntry[] | undefined) => {
      if (!current) return;
      undoStack.push(stripSnap(current));
      if (undoStack.length > HIST_MAX) undoStack.shift();
      redoStack.length = 0;
      notifyHist();
    },
    undo: async () => {
      if (!undoStack.length) return;
      const current = qc.getQueryData<ScheduleEntry[]>(["entries"]) ?? [];
      const prev = undoStack.pop()!;
      redoStack.push(stripSnap(current));
      notifyHist();
      await apply(prev);
    },
    redo: async () => {
      if (!redoStack.length) return;
      const current = qc.getQueryData<ScheduleEntry[]>(["entries"]) ?? [];
      const next = redoStack.pop()!;
      undoStack.push(stripSnap(current));
      notifyHist();
      await apply(next);
    },
  };
}
