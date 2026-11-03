import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// Grade levels (e.g. Grade 7, Grade 8...)
export const gradeLevels = sqliteTable("grade_levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Student sections (e.g. 7-Einstein) belong to a grade level
export const sections = sqliteTable("sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  gradeLevelId: integer("grade_level_id").notNull().references(() => gradeLevels.id, { onDelete: "cascade" }),
  adviser: text("adviser"),
  homeroomId: integer("homeroom_id"),
  studentCount: integer("student_count"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Subjects (e.g. Math, English) with a display color
export const subjects = sqliteTable("subjects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Rooms this subject must use (e.g. Science -> labs). Empty/null = any room.
  roomIds: text("room_ids", { mode: "json" }).$type<number[]>(),
  // "morning" | "afternoon" | null (any time). Auto-fill prefers it.
  timePreference: text("time_preference"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Teachers. subjectIds stored as JSON array of subject ids they can teach.
export const teachers = sqliteTable("teachers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email"),
  subjectIds: text("subject_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
  gradeLevelIds: text("grade_level_ids", { mode: "json" }).$type<number[]>().notNull().default([]),
  maxLoad: integer("max_load"),
  maxPerDay: integer("max_per_day"),
  // Secret token for the read-only schedule link (server version).
  shareToken: text("share_token"),
  color: text("color").notNull().default("#007041"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Rooms / classrooms
export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  capacity: integer("capacity"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Time slots / periods. These are the rows of the timetable (shared across days).
export const timeSlots = sqliteTable("time_slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  startTime: text("start_time").notNull(), // "08:00"
  endTime: text("end_time").notNull(),     // "08:50"
  sortOrder: integer("sort_order").notNull().default(0),
  isBreak: integer("is_break", { mode: "boolean" }).notNull().default(false), // recess/lunch — not schedulable
  // Bell schedules: which grade levels and days use this period. Empty/null = all.
  gradeLevelIds: text("grade_level_ids", { mode: "json" }).$type<number[]>(),
  days: text("days", { mode: "json" }).$type<number[]>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Blocked times: a specific day+slot is unavailable (assembly, flag ceremony, etc.)
// Scope resolution (in priority): sectionIds (specific sections) > gradeLevelId (whole grade) > sectionId (legacy single) > null (all sections).
export const blockedTimes = sqliteTable("blocked_times", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dayOfWeek: integer("day_of_week").notNull(), // 1=Mon .. 7=Sun
  timeSlotId: integer("time_slot_id").notNull().references(() => timeSlots.id, { onDelete: "cascade" }),
  sectionId: integer("section_id").references(() => sections.id, { onDelete: "cascade" }), // legacy single-section (null = all)
  gradeLevelId: integer("grade_level_id").references(() => gradeLevels.id, { onDelete: "cascade" }), // whole grade level
  sectionIds: text("section_ids", { mode: "json" }).$type<number[]>(), // specific multiple sections
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Subject time allocation: how many periods/week a subject needs for a grade level.
export const subjectAllocations = sqliteTable("subject_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gradeLevelId: integer("grade_level_id").notNull().references(() => gradeLevels.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  periodsPerWeek: integer("periods_per_week").notNull().default(0),
  // Periods scheduled back-to-back as one block (2 = double periods).
  blockSize: integer("block_size").notNull().default(1),
  // Most periods of this subject a section may have on one day (null = no limit).
  maxPerDay: integer("max_per_day"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Schedule entries: a placed block in the timetable.
export const scheduleEntries = sqliteTable("schedule_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 1=Mon..7=Sun
  timeSlotId: integer("time_slot_id").notNull().references(() => timeSlots.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").references(() => teachers.id, { onDelete: "set null" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// App settings (single row): which days are active.
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  activeDays: text("active_days", { mode: "json" }).$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  schoolName: text("school_name").notNull().default("My School"),
  // Mobile bottom-tab customization: ordered list of tab keys + visibility.
  tabConfig: text("tab_config", { mode: "json" }).$type<{ key: string; visible: boolean }[]>(),
  // Lockdown mode: read-only protection. locked=true hides editing menus + greys out actions.
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  // Password required to unlock / change lock state. null = not yet set (first lock sets it).
  lockPassword: text("lock_password"),
  // Print template: a single PDF page rendered to a PNG data URI, used as a full-page
  // background for printed schedules (8.5x11 portrait). null = plain print, no background.
  printTemplate: text("print_template"),
  // Optional heading text printed above the grade-level/teacher line on every printout.
  printHeading: text("print_heading"),
  // Vertical offset (in inches, can be negative) to nudge where the schedule table
  // starts printing on the page — useful to clear a letterhead area on the template.
  printOffset: real("print_offset"),
  // Printed row height (in pixels). null = default. Taller rows = more readable,
  // but capped on the UI side so the table still fits one 8.5x11 page.
  printRowHeight: real("print_row_height"),
});

// Save points: full-configuration snapshots the user can name, list, and roll
// back to. `payload` is a JSON blob holding every table's rows at capture time
// (grade levels, sections, subjects, teachers, rooms, time slots, blocked times,
// allocations, schedule entries) plus a slice of settings.
export const savePoints = sqliteTable("save_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  note: text("note"),
  // Cached counts for quick list display without deserializing the payload.
  entryCount: integer("entry_count").notNull().default(0),
  sectionCount: integer("section_count").notNull().default(0),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Teaching loads: which teacher teaches a subject to a section.
export const teachingLoads = sqliteTable("teaching_loads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Times a teacher can't teach (part-time, admin duties...).
export const teacherUnavailability = sqliteTable("teacher_unavailability", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teacherId: integer("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  timeSlotId: integer("time_slot_id").notNull().references(() => timeSlots.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Substitutions: who covers a class on a given date when its teacher is absent.
export const substitutions = sqliteTable("substitutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  sectionId: integer("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  subjectId: integer("subject_id").references(() => subjects.id, { onDelete: "set null" }),
  timeSlotId: integer("time_slot_id").notNull().references(() => timeSlots.id, { onDelete: "cascade" }),
  absentTeacherId: integer("absent_teacher_id").references(() => teachers.id, { onDelete: "set null" }),
  substituteTeacherId: integer("substitute_teacher_id").references(() => teachers.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// Server version: accounts and sessions.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("viewer"), // admin | editor | viewer
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});

// Activity log: one row per change.
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(), // ms since epoch
  user: text("user"),
  action: text("action").notNull(),
  details: text("details"),
});

// Undo / redo history: compressed snapshots taken before each change.
export const undoLog = sqliteTable("undo_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stack: text("stack").notNull(), // "undo" | "redo"
  label: text("label").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
});

// School years / semesters. The active term's data lives in the normal tables;
// the others are stored as snapshots in `payload`.
export const terms = sqliteTable("terms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  payload: text("payload"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type SavePoint = typeof savePoints.$inferSelect;

export type GradeLevel = typeof gradeLevels.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Teacher = typeof teachers.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type TimeSlot = typeof timeSlots.$inferSelect;
export type BlockedTime = typeof blockedTimes.$inferSelect;
export type SubjectAllocation = typeof subjectAllocations.$inferSelect;
export type ScheduleEntry = typeof scheduleEntries.$inferSelect;
export type Settings = typeof settings.$inferSelect;
