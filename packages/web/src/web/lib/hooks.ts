import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, request } from "./api";
import type {
  GradeLevel, Section, Subject, Teacher, Room, TimeSlot,
  BlockedTime, Allocation, ScheduleEntry, AppSettings, Conflict, SuggestedEntry, SavePoint,
  TeachingLoad, Unavailability, Substitution, SubPlan, AutofillResult, AuditRow, Term, Account,
} from "./types";
import { useAccess } from "./access";
import { notify } from "./save-file";

// ---- queries ----
export const useGradeLevels = () => useQuery({ queryKey: ["grade-levels"], queryFn: async () => (await api["grade-levels"].$get()).json() as Promise<GradeLevel[]> });
export const useSections = () => useQuery({ queryKey: ["sections"], queryFn: async () => (await api.sections.$get()).json() as Promise<Section[]> });
export const useSubjects = () => useQuery({ queryKey: ["subjects"], queryFn: async () => (await api.subjects.$get()).json() as Promise<Subject[]> });
export const useTeachers = () => useQuery({ queryKey: ["teachers"], queryFn: async () => (await api.teachers.$get()).json() as Promise<Teacher[]> });
export const useRooms = () => useQuery({ queryKey: ["rooms"], queryFn: async () => (await api.rooms.$get()).json() as Promise<Room[]> });
export const useTimeSlots = () => useQuery({ queryKey: ["time-slots"], queryFn: async () => (await api["time-slots"].$get()).json() as Promise<TimeSlot[]> });
export const useBlockedTimes = () => useQuery({ queryKey: ["blocked-times"], queryFn: async () => (await api["blocked-times"].$get()).json() as Promise<BlockedTime[]> });
export const useAllocations = () => useQuery({ queryKey: ["allocations"], queryFn: async () => (await api.allocations.$get()).json() as Promise<Allocation[]> });
export const useEntries = () => useQuery({ queryKey: ["entries"], queryFn: async () => (await api.entries.$get()).json() as Promise<ScheduleEntry[]> });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: async () => (await api.settings.$get()).json() as Promise<AppSettings> });
export const useConflicts = () => useQuery({ queryKey: ["conflicts"], queryFn: async () => (await api.conflicts.$get()).json() as Promise<{ conflicts: Conflict[] }> });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { activeDays?: number[]; schoolName?: string; tabConfig?: { key: string; visible: boolean }[]; printTemplate?: string | null; printHeading?: string | null; printOffset?: number | null; printRowHeight?: number | null }) =>
      (await api.settings.$put({ json: patch as any })).json() as Promise<AppSettings>,
    // optimistic so reorder/toggle feels instant
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<AppSettings>(["settings"]);
      if (prev) qc.setQueryData<AppSettings>(["settings"], { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}

// ---- lockdown ----
/** Is editing turned off here (lockdown mode, a view-only account, or view-only sharing)? */
export function useLocked(): boolean {
  const { data } = useSettings();
  const access = useAccess();
  return !!data?.locked || access.readOnly;
}

export function useLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      const res = await api.settings.lock.$post({ json: { password } });
      if (!res.ok) throw new Error((await res.json() as any).error ?? "Failed to lock");
      return res.json() as Promise<AppSettings>;
    },
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (password: string) => {
      const res = await api.settings.unlock.$post({ json: { password } });
      if (!res.ok) throw new Error((await res.json() as any).error ?? "Failed to unlock");
      return res.json() as Promise<AppSettings>;
    },
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useChangeLockPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { current?: string; next: string }) => {
      const res = await api.settings["lock-password"].$post({ json: vars });
      if (!res.ok) throw new Error((await res.json() as any).error ?? "Failed to change password");
      return res.json() as Promise<AppSettings>;
    },
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

const inv = (qc: ReturnType<typeof useQueryClient>, keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

// ---- generic CRUD mutation helpers ----
export function useCrud() {
  const qc = useQueryClient();
  const refreshAll = () => inv(qc, ["grade-levels", "sections", "subjects", "teachers", "rooms", "time-slots", "blocked-times", "allocations", "entries", "settings", "conflicts"]);
  return { qc, inv: (keys: string[]) => inv(qc, keys), refreshAll };
}

// schedule entry mutations
export function useEntryMutations() {
  const qc = useQueryClient();
  const refresh = () => inv(qc, ["entries", "conflicts"]);
  const create = useMutation({
    mutationFn: async (e: { sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId?: number | null; roomId?: number | null }) =>
      (await api.entries.$post({ json: e })).json(),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, ...e }: { id: number; dayOfWeek?: number; timeSlotId?: number; subjectId?: number; teacherId?: number | null; roomId?: number | null; sectionId?: number }) =>
      request("PUT", `/entries/${id}`, e),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => (await api.entries[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: refresh,
  });
  const bulk = useMutation({
    mutationFn: async (entries: SuggestedEntry[]) => (await api.entries.bulk.$post({ json: { entries } })).json(),
    onSuccess: refresh,
  });
  const clear = useMutation({
    mutationFn: async (sectionId?: number) => (await api.entries.clear.$post({ json: { sectionId } })).json(),
    onSuccess: refresh,
  });
  return { create, update, remove, bulk, clear };
}

export function useAutofill() {
  return useMutation({
    mutationFn: async (vars: { sectionIds: number[]; fresh?: boolean }) => request<AutofillResult>("POST", "/autofill", vars),
  });
}

export function useSeed() {
  const { refreshAll } = useCrud();
  return useMutation({ mutationFn: async () => (await api.seed.$post()).json(), onSuccess: refreshAll });
}

// ---- save points (full-config snapshots + rollback) ----
export const useSavePoints = () => useQuery({ queryKey: ["save-points"], queryFn: async () => (await api["save-points"].$get()).json() as Promise<SavePoint[]> });

export function useCreateSavePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name?: string; note?: string | null }) => (await api["save-points"].$post({ json: vars })).json() as Promise<SavePoint>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["save-points"] }),
  });
}

export function useRestoreSavePoint() {
  const { refreshAll } = useCrud();
  return useMutation({
    mutationFn: async (id: number) => (await api["save-points"][":id"].restore.$post({ param: { id: String(id) } })).json(),
    onSuccess: refreshAll,
  });
}

export function useDeleteSavePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api["save-points"][":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["save-points"] }),
  });
}

// ---- newer data ----
export const useTeachingLoads = () => useQuery({ queryKey: ["teaching-loads"], queryFn: () => request<TeachingLoad[]>("GET", "/teaching-loads") });
export const useUnavailability = () => useQuery({ queryKey: ["teacher-unavailability"], queryFn: () => request<Unavailability[]>("GET", "/teacher-unavailability") });
export const useSubstitutions = (range?: { from?: string; to?: string; date?: string }) => {
  const qs = new URLSearchParams(Object.entries(range ?? {}).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ["substitutions", qs], queryFn: () => request<Substitution[]>("GET", `/substitutions${qs ? `?${qs}` : ""}`) });
};
export const useSubPlan = (date: string, teacherId: number | null) =>
  useQuery({ queryKey: ["substitutions", "plan", date, teacherId], enabled: !!date && teacherId != null, queryFn: () => request<SubPlan>("GET", `/substitutions/plan?date=${date}&teacherId=${teacherId}`) });
export const useAudit = (limit = 200) => useQuery({ queryKey: ["audit", limit], queryFn: () => request<AuditRow[]>("GET", `/audit?limit=${limit}`) });
export const useTerms = () => useQuery({ queryKey: ["terms"], queryFn: () => request<Term[]>("GET", "/terms") });
export const useAccounts = (enabled: boolean) => useQuery({ queryKey: ["accounts"], enabled, queryFn: () => request<Account[]>("GET", "/auth/users") });

/**
 * Run an API call, refresh data, and show a short message. Errors are shown
 * as a notice and resolve to undefined, so callers don't need try/catch.
 */
export function useAct() {
  const qc = useQueryClient();
  return async function act<T = any>(method: string, path: string, body?: unknown, opts: { success?: string | ((r: T) => string); invalidate?: string[] } = {}): Promise<T | undefined> {
    try {
      const r = await request<T>(method, path, body);
      if (opts.invalidate) await Promise.all(opts.invalidate.map((k) => qc.invalidateQueries({ queryKey: [k] })));
      else await qc.invalidateQueries();
      if (opts.success) notify(typeof opts.success === "function" ? opts.success(r) : opts.success);
      return r;
    } catch (e: any) {
      notify(e?.message ?? String(e), "error");
      return undefined;
    }
  };
}

/** Id → record maps for names and colors, plus print settings. */
export function useLookups() {
  const subjects = useSubjects();
  const teachers = useTeachers();
  const rooms = useRooms();
  const sections = useSections();
  const settings = useSettings();
  const maps = useMemo(() => ({
    subjMap: new Map((subjects.data ?? []).map((s) => [s.id, s])),
    teacherMap: new Map((teachers.data ?? []).map((t) => [t.id, t])),
    roomMap: new Map((rooms.data ?? []).map((r) => [r.id, r])),
    sectionMap: new Map((sections.data ?? []).map((s) => [s.id, s])),
  }), [subjects.data, teachers.data, rooms.data, sections.data]);
  const s = settings.data;
  const printOpts = { template: s?.printTemplate, heading: s?.printHeading, offset: s?.printOffset, rowHeight: s?.printRowHeight };
  return { maps, printOpts };
}
