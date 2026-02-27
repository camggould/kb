import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openDb, insertNote, getNote, deleteNote, getAllNotes, getAllTags, type NoteRow } from "../../src/core/database.js";
import { ALL_FIELD_NAMES } from "../../src/core/schema.js";
import type Database from "better-sqlite3";

const TEST_DIR = path.join(os.tmpdir(), "kb-test-db-" + Date.now());
let db: Database.Database;

function makeNote(id: string, title: string, tags?: string[]): NoteRow {
  const row: NoteRow = {
    id,
    title,
    body: `Body of ${title}`,
    tags: tags ? JSON.stringify(tags) : null,
    source: null,
    context: null,
    workspace: null,
    links: null,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    file_path: `notes/${id}.md`,
  };
  // Ensure all schema fields have at least null
  for (const name of ALL_FIELD_NAMES) {
    if (!(name in row)) {
      row[name] = null;
    }
  }
  return row;
}

beforeEach(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  db = openDb(TEST_DIR);
});

afterEach(() => {
  db.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("database", () => {
  it("should insert and retrieve a note", () => {
    const note = makeNote("test-1", "Test Note");
    insertNote(db, note);
    const retrieved = getNote(db, "test-1");
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Test Note");
  });

  it("should delete a note", () => {
    insertNote(db, makeNote("test-2", "To Delete"));
    expect(deleteNote(db, "test-2")).toBe(true);
    expect(getNote(db, "test-2")).toBeUndefined();
  });

  it("should return false when deleting nonexistent note", () => {
    expect(deleteNote(db, "nonexistent")).toBe(false);
  });

  it("should list all notes", () => {
    insertNote(db, makeNote("n1", "Note 1"));
    insertNote(db, makeNote("n2", "Note 2"));
    const all = getAllNotes(db);
    expect(all.length).toBe(2);
  });

  it("should aggregate tags with counts", () => {
    insertNote(db, makeNote("t1", "Note 1", ["cooking", "italian"]));
    insertNote(db, makeNote("t2", "Note 2", ["cooking", "french"]));
    const tags = getAllTags(db);
    expect(tags.find((t) => t.tag === "cooking")?.count).toBe(2);
    expect(tags.find((t) => t.tag === "italian")?.count).toBe(1);
  });
});
