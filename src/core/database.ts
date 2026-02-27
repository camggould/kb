import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { METADATA_FIELDS, FTS_FIELDS, ALL_FIELD_NAMES, FILTERABLE_FIELDS } from "./schema.js";

// Core fields are always present; metadata fields are generated from schema
export interface NoteRow {
  id: string;
  title: string;
  body: string;
  tags: string | null;
  source: string | null;
  context: string | null;
  workspace: string | null;
  links: string | null;
  created: string;
  modified: string;
  file_path: string;
  [key: string]: string | null;
}

export function openDb(kbPath: string): Database.Database {
  const dbPath = path.join(kbPath, ".kb", "index.db");
  fs.mkdirSync(path.join(kbPath, ".kb"), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  const metaCols = ALL_FIELD_NAMES.map(n => `      ${n} TEXT`).join(",\n");
  const ftsFields = FTS_FIELDS.map(f => f.name).join(", ");
  const ftsFieldsNew = FTS_FIELDS.map(f => `new.${f.name}`).join(", ");
  const ftsFieldsOld = FTS_FIELDS.map(f => `old.${f.name}`).join(", ");

  // Note: db.exec here is better-sqlite3's Database.exec(), not child_process
  const schema = `
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
${metaCols},
      created TEXT NOT NULL,
      modified TEXT NOT NULL,
      file_path TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, body, ${ftsFields},
      content='notes',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, body, ${ftsFields})
      VALUES (new.rowid, new.title, new.body, ${ftsFieldsNew});
    END;

    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, body, ${ftsFields})
      VALUES ('delete', old.rowid, old.title, old.body, ${ftsFieldsOld});
    END;

    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, body, ${ftsFields})
      VALUES ('delete', old.rowid, old.title, old.body, ${ftsFieldsOld});
      INSERT INTO notes_fts(rowid, title, body, ${ftsFields})
      VALUES (new.rowid, new.title, new.body, ${ftsFieldsNew});
    END;
  `;
  db.exec(schema);
  migrateSchema(db);
}

function migrateSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(notes)").all() as { name: string }[];
  const existing = new Set(columns.map(c => c.name));
  for (const name of ALL_FIELD_NAMES) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE notes ADD COLUMN ${name} TEXT`);
    }
  }
}

export function insertNote(db: Database.Database, note: NoteRow): void {
  const allCols = ["id", "title", "body", ...ALL_FIELD_NAMES, "created", "modified", "file_path"];
  const colList = allCols.join(", ");
  const placeholders = allCols.map(c => `@${c}`).join(", ");
  db.prepare(`INSERT OR REPLACE INTO notes (${colList}) VALUES (${placeholders})`).run(note);
}

export function deleteNote(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  return result.changes > 0;
}

export function getNote(db: Database.Database, id: string): NoteRow | undefined {
  return db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow | undefined;
}

export function getAllNotes(db: Database.Database): NoteRow[] {
  return db.prepare("SELECT * FROM notes ORDER BY created DESC").all() as NoteRow[];
}

export function getAllTags(db: Database.Database): { tag: string; count: number }[] {
  const rows = db.prepare("SELECT tags FROM notes WHERE tags IS NOT NULL").all() as { tags: string }[];
  const tagCounts = new Map<string, number>();
  for (const row of rows) {
    try {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    } catch {
      // skip malformed tags
    }
  }
  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export interface ListNotesOptions {
  [key: string]: string | string[] | number | undefined;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export function listNotes(db: Database.Database, opts: ListNotesOptions = {}): NoteRow[] {
  const limit = (opts.limit as number | undefined) ?? 100;
  let sql = "SELECT * FROM notes WHERE 1=1";
  const params: unknown[] = [];

  for (const field of FILTERABLE_FIELDS) {
    const val = opts[field.name];
    if (val === undefined || val === null) continue;

    if (field.type === "tags") {
      const tags = val as string[];
      if (tags.length > 0) {
        for (const tag of tags) {
          sql += ` AND ${field.name} LIKE ?`;
          params.push(`%${tag}%`);
        }
      }
    } else if (field.filterMode === "exact") {
      sql += ` AND ${field.name} = ?`;
      params.push(val);
    } else {
      sql += ` AND ${field.name} LIKE ?`;
      params.push(`%${val}%`);
    }
  }

  if (opts.dateFrom) {
    sql += " AND created >= ?";
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    sql += " AND created <= ?";
    params.push(opts.dateTo);
  }

  sql += " ORDER BY created DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params) as NoteRow[];
}

export function getFieldValues(db: Database.Database, fieldName: string): { value: string; count: number }[] {
  const rows = db.prepare(
    `SELECT ${fieldName} as value, COUNT(*) as count FROM notes WHERE ${fieldName} IS NOT NULL AND ${fieldName} != '' GROUP BY ${fieldName} ORDER BY count DESC`
  ).all() as { value: string; count: number }[];
  return rows;
}

export function getAllContexts(db: Database.Database): { context: string; count: number }[] {
  return getFieldValues(db, "context").map(r => ({ context: r.value, count: r.count }));
}

export function findBacklinks(db: Database.Database, noteId: string): NoteRow[] {
  return db.prepare(
    "SELECT * FROM notes WHERE links LIKE ? ORDER BY created DESC"
  ).all(`%${noteId}%`) as NoteRow[];
}

export function clearAllNotes(db: Database.Database): void {
  db.exec("DELETE FROM notes");
}
