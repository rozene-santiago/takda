export interface GradeLevel { id: number; name: string; sortOrder: number; createdAt: string }
export interface Section { id: number; name: string; gradeLevelId: number; adviser: string | null; homeroomId: number | null; studentCount: number | null; sortOrder: number; createdAt: string }
export interface Subject { id: number; name: string; code: string | null; color: string | null; sortOrder: number; roomIds: number[] | null; timePreference: "morning" | "afternoon" | null; createdAt: string }
export interface Teacher { id: number; name: string; email: string | null; subjectIds: number[]; gradeLevelIds: number[]; maxLoad: number | null; maxPerDay: number | null; hasShareLink?: boolean; color: string; createdAt: string }
export interface Room { id: number; name: string; capacity: number | null; createdAt: string }
export interface TimeSlot { id: number; label: string; startTime: string; endTime: string; sortOrder: number; isBreak: boolean; gradeLevelIds: number[] | null; days: number[] | null; createdAt: string }
export interface BlockedTime { id: number; dayOfWeek: number; timeSlotId: number; sectionId: number | null; gradeLevelId?: number | null; sectionIds?: number[] | null; reason: string | null; createdAt: string }
export interface Allocation { id: number; gradeLevelId: number; subjectId: number; periodsPerWeek: number; blockSize: number; maxPerDay: number | null; createdAt: string }
export interface ScheduleEntry { id: number; sectionId: number; dayOfWeek: number; timeSlotId: number; subjectId: number; teacherId: number | null; roomId: number | null; createdAt: string }
export interface AppSettings { id: number; activeDays: number[]; schoolName: string; tabConfig?: { key: string; visible: boolean }[] | null; locked?: boolean; hasLockPassword?: boolean; printTemplate?: string | null; printHeading?: string | null; printOffset?: number | null; printRowHeight?: number | null }

export type ConflictType =
  | "teacher_double" | "section_double" | "room_double" | "blocked" | "slot_not_used" | "teacher_unavailable"
  | "over_allocation" | "under_allocation" | "teacher_subject_mismatch" | "teacher_grade_mismatch" | "teacher_overload"
  | "teacher_daily_overload" | "load_mismatch" | "room_capacity" | "room_type" | "subject_daily_limit";

export interface Conflict {
  type: ConflictType;
  severity: "error" | "warning";
  message: string;
  entryIds: number[];
  sectionId?: number;
  subjectId?: number;
  teacherId?: number;
  roomId?: number;
  dayOfWeek?: number;
  timeSlotId?: number;
}

export interface SuggestedEntry {
  sectionId: number; dayOfWeek: number; timeSlotId: number;
  subjectId: number; teacherId: number | null; roomId: number | null;
}

export interface SavePoint {
  id: number; name: string; note: string | null;
  entryCount: number; sectionCount: number; createdAt: string;
}

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_FULL = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface TeachingLoad { id: number; sectionId: number; subjectId: number; teacherId: number; createdAt: string }
export interface Unavailability { id: number; teacherId: number; dayOfWeek: number; timeSlotId: number; reason: string | null }
export interface Substitution { id: number; date: string; sectionId: number; subjectId: number | null; timeSlotId: number; absentTeacherId: number | null; substituteTeacherId: number | null; note: string | null; createdAt: string }
export interface SubCandidate { teacherId: number; score: number; qualified: boolean; periodsThatDay: number; recentSubs: number; note: string }
export interface SubPlan { date: string; day: number; classes: { sectionId: number; subjectId: number; timeSlotId: number; roomId: number | null; existing: Substitution | null; candidates: SubCandidate[] }[] }
export interface Unplaced { sectionId: number; subjectId: number; periods: number; reason: string }
export interface AutofillResult { suggestions: SuggestedEntry[]; unplaced: Unplaced[]; teacherless: number; projectedConflicts: Conflict[] }
export interface HistoryState { undo: { id: number; label: string; createdAt: number } | null; redo: { id: number; label: string; createdAt: number } | null; undoCount: number; redoCount: number }
export interface AuditRow { id: number; at: number; user: string | null; action: string; details: string | null }
export interface Term { id: number; name: string; startDate: string | null; endDate: string | null; isActive: boolean; stored: boolean; createdAt: string }
export interface Account { id: number; username: string; displayName: string; role: "admin" | "editor" | "viewer" }
export interface AuthStatus { mode: "server" | "local"; needsSetup?: boolean; user?: Account | null; email?: boolean }
