// SQL that mirrors schema.ts. Every statement is idempotent (IF NOT EXISTS),
// so it is safe to run on every startup. Keep in sync with schema.ts.
export const INIT_SQL = `
CREATE TABLE IF NOT EXISTS grade_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  grade_level_id INTEGER NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  adviser TEXT,
  homeroom_id INTEGER,
  student_count INTEGER,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  room_ids TEXT,
  time_preference TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  subject_ids TEXT DEFAULT '[]' NOT NULL,
  grade_level_ids TEXT DEFAULT '[]' NOT NULL,
  max_load INTEGER,
  max_per_day INTEGER,
  share_token TEXT,
  color TEXT DEFAULT '#007041' NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS time_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  label TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  is_break INTEGER DEFAULT 0 NOT NULL,
  grade_level_ids TEXT,
  days TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blocked_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  day_of_week INTEGER NOT NULL,
  time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  grade_level_id INTEGER REFERENCES grade_levels(id) ON DELETE CASCADE,
  section_ids TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subject_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  grade_level_id INTEGER NOT NULL REFERENCES grade_levels(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  periods_per_week INTEGER DEFAULT 0 NOT NULL,
  block_size INTEGER DEFAULT 1 NOT NULL,
  max_per_day INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  active_days TEXT DEFAULT '[1,2,3,4,5]' NOT NULL,
  school_name TEXT DEFAULT 'My School' NOT NULL,
  tab_config TEXT,
  locked INTEGER DEFAULT 0 NOT NULL,
  lock_password TEXT,
  print_template TEXT,
  print_heading TEXT,
  print_offset REAL,
  print_row_height REAL
);
CREATE TABLE IF NOT EXISTS save_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  entry_count INTEGER DEFAULT 0 NOT NULL,
  section_count INTEGER DEFAULT 0 NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS teaching_loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS teaching_loads_section_subject ON teaching_loads(section_id, subject_id);
CREATE TABLE IF NOT EXISTS teacher_unavailability (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS substitutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  date TEXT NOT NULL,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  time_slot_id INTEGER NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  absent_teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  substitute_teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS substitutions_date ON substitutions(date);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT DEFAULT 'viewer' NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  at INTEGER NOT NULL,
  user TEXT,
  action TEXT NOT NULL,
  details TEXT
);
CREATE TABLE IF NOT EXISTS undo_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  stack TEXT NOT NULL,
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER DEFAULT 0 NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);
`;

// Columns added after the first release. Older database files get them on
// startup (ALTER TABLE ... ADD COLUMN), so existing data keeps working.
export const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "sections", column: "student_count", ddl: "student_count INTEGER" },
  { table: "subjects", column: "room_ids", ddl: "room_ids TEXT" },
  { table: "subjects", column: "time_preference", ddl: "time_preference TEXT" },
  { table: "teachers", column: "max_per_day", ddl: "max_per_day INTEGER" },
  { table: "teachers", column: "share_token", ddl: "share_token TEXT" },
  { table: "time_slots", column: "grade_level_ids", ddl: "grade_level_ids TEXT" },
  { table: "time_slots", column: "days", ddl: "days TEXT" },
  { table: "subject_allocations", column: "block_size", ddl: "block_size INTEGER DEFAULT 1 NOT NULL" },
  { table: "subject_allocations", column: "max_per_day", ddl: "max_per_day INTEGER" },
];
