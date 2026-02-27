import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import slugify from "slugify";
import type Database from "better-sqlite3";
import { insertNote, deleteNote as dbDeleteNote, getNote, clearAllNotes, type NoteRow } from "./database.js";
import { METADATA_FIELDS } from "./schema.js";

export interface NoteMeta {
  id: string;
  title: string;
  created: string;
  modified: string;
  tags: string[];
  source: string;
  context: string;
  workspace: string;
  links: string[];
  [key: string]: string | string[];
}

export interface Note {
  meta: NoteMeta;
  body: string;
}

export function generateNoteId(title: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace("Z", "");
  const slug = slugify(title, { lower: true, strict: true }).slice(0, 60);
  return `${ts}-${slug}`;
}

export function noteToMarkdown(note: Note): string {
  const frontmatter: Record<string, unknown> = {
    id: note.meta.id,
    created: note.meta.created,
    modified: note.meta.modified,
  };

  for (const field of METADATA_FIELDS) {
    const val = note.meta[field.name];
    if (field.type === "tags" || field.type === "links") {
      if (Array.isArray(val) && val.length > 0) frontmatter[field.name] = val;
    } else {
      if (val) frontmatter[field.name] = val;
    }
  }

  return matter.stringify(`\n# ${note.meta.title}\n\n${note.body}\n`, frontmatter);
}

export function parseNoteFile(filePath: string): Note {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : (data.id ?? path.basename(filePath, ".md"));

  let body = content;
  if (titleMatch) {
    const idx = content.indexOf(titleMatch[0]);
    body = content.slice(idx + titleMatch[0].length).trim();
  }

  const meta: NoteMeta = {
    id: data.id ?? path.basename(filePath, ".md"),
    title,
    created: data.created ?? new Date().toISOString(),
    modified: data.modified ?? new Date().toISOString(),
    tags: [],
    source: "",
    context: "",
    workspace: "",
    links: [],
  };

  for (const field of METADATA_FIELDS) {
    if (field.type === "tags" || field.type === "links") {
      meta[field.name] = Array.isArray(data[field.name]) ? data[field.name] : [];
    } else {
      meta[field.name] = data[field.name] ?? "";
    }
  }

  return { meta, body };
}

function noteToRow(note: Note, filePath: string): NoteRow {
  const row: NoteRow = {
    id: note.meta.id,
    title: note.meta.title,
    body: note.body,
    tags: null,
    source: null,
    context: null,
    workspace: null,
    links: null,
    created: note.meta.created,
    modified: note.meta.modified,
    file_path: filePath,
  };

  for (const field of METADATA_FIELDS) {
    const val = note.meta[field.name];
    if (field.type === "tags" || field.type === "links") {
      row[field.name] = Array.isArray(val) && val.length > 0 ? JSON.stringify(val) : null;
    } else {
      row[field.name] = (val as string) || null;
    }
  }

  return row;
}

/**
 * Walk up from `startDir` looking for `.workspace.yaml`.
 * Returns the workspace name if found, empty string otherwise.
 */
export function detectWorkspace(startDir?: string): string {
  let dir = startDir ?? process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const wsFile = path.join(dir, ".workspace.yaml");
    if (fs.existsSync(wsFile)) {
      const raw = fs.readFileSync(wsFile, "utf-8");
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      return nameMatch ? nameMatch[1].trim() : path.basename(dir);
    }
    dir = path.dirname(dir);
  }
  return "";
}

export interface CreateNoteOpts {
  title: string;
  body: string;
  [key: string]: string | string[] | undefined;
}

export function createNote(
  db: Database.Database,
  kbPath: string,
  opts: CreateNoteOpts
): Note {
  const id = generateNoteId(opts.title);
  const now = new Date().toISOString();

  const meta: NoteMeta = {
    id,
    title: opts.title,
    created: now,
    modified: now,
    tags: [],
    source: "",
    context: "",
    workspace: "",
    links: [],
  };

  for (const field of METADATA_FIELDS) {
    if (field.type === "tags" || field.type === "links") {
      meta[field.name] = (opts[field.name] as string[] | undefined) ?? [];
    } else {
      meta[field.name] = (opts[field.name] as string | undefined) ?? "";
    }
  }

  const note: Note = { meta, body: opts.body };

  const fileName = `${id}.md`;
  const filePath = path.join(kbPath, "notes", fileName);
  const relPath = path.join("notes", fileName);

  fs.mkdirSync(path.join(kbPath, "notes"), { recursive: true });
  fs.writeFileSync(filePath, noteToMarkdown(note), "utf-8");
  insertNote(db, noteToRow(note, relPath));

  return note;
}

export function readNote(db: Database.Database, kbPath: string, noteId: string): Note | null {
  const row = getNote(db, noteId);
  if (!row) return null;
  const filePath = path.join(kbPath, row.file_path);
  if (!fs.existsSync(filePath)) return null;
  return parseNoteFile(filePath);
}

export function removeNote(db: Database.Database, kbPath: string, noteId: string): boolean {
  const row = getNote(db, noteId);
  if (!row) return false;
  const filePath = path.join(kbPath, row.file_path);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return dbDeleteNote(db, noteId);
}

export function reindexKb(db: Database.Database, kbPath: string): number {
  clearAllNotes(db);

  const notesDir = path.join(kbPath, "notes");
  if (!fs.existsSync(notesDir)) return 0;

  const files = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md"));
  let count = 0;
  for (const file of files) {
    const filePath = path.join(notesDir, file);
    const note = parseNoteFile(filePath);
    const relPath = path.join("notes", file);
    insertNote(db, noteToRow(note, relPath));
    count++;
  }
  return count;
}
