import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openDb } from "../../src/core/database.js";
import { createNote, readNote, removeNote, reindexKb, generateNoteId, parseNoteFile, noteToMarkdown } from "../../src/core/notes.js";
import type Database from "better-sqlite3";

const TEST_DIR = path.join(os.tmpdir(), "kb-test-notes-" + Date.now());
let db: Database.Database;

beforeEach(() => {
  fs.mkdirSync(path.join(TEST_DIR, "notes"), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, ".kb"), { recursive: true });
  db = openDb(TEST_DIR);
});

afterEach(() => {
  db.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("notes", () => {
  it("should generate note IDs with timestamp and slug", () => {
    const id = generateNoteId("My Great Note");
    expect(id).toMatch(/^\d{8}T\d{6}-my-great-note$/);
  });

  it("should create a note file and DB entry", () => {
    const note = createNote(db, TEST_DIR, {
      title: "Test Creation",
      body: "This is a test note body.",
      tags: ["test", "creation"],
      source: "unit test",
    });

    expect(note.meta.title).toBe("Test Creation");
    expect(note.meta.tags).toEqual(["test", "creation"]);

    // Check file exists
    const filePath = path.join(TEST_DIR, "notes", `${note.meta.id}.md`);
    expect(fs.existsSync(filePath)).toBe(true);

    // Check DB entry
    const fromDb = readNote(db, TEST_DIR, note.meta.id);
    expect(fromDb).not.toBeNull();
    expect(fromDb!.meta.title).toBe("Test Creation");
  });

  it("should remove a note (file + DB)", () => {
    const note = createNote(db, TEST_DIR, {
      title: "To Remove",
      body: "Will be removed.",
    });
    const filePath = path.join(TEST_DIR, "notes", `${note.meta.id}.md`);
    expect(fs.existsSync(filePath)).toBe(true);

    const removed = removeNote(db, TEST_DIR, note.meta.id);
    expect(removed).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("should reindex from markdown files", () => {
    // Create notes
    createNote(db, TEST_DIR, { title: "Reindex A", body: "AAA" });
    createNote(db, TEST_DIR, { title: "Reindex B", body: "BBB" });

    // Clear DB and reindex
    const count = reindexKb(db, TEST_DIR);
    expect(count).toBe(2);
  });

  it("should round-trip note through markdown", () => {
    const note = createNote(db, TEST_DIR, {
      title: "Round Trip",
      body: "Testing round-trip serialization.",
      tags: ["meta", "test"],
      source: "vitest",
      context: "unit testing",
      links: ["other-note-id"],
    });

    const filePath = path.join(TEST_DIR, "notes", `${note.meta.id}.md`);
    const parsed = parseNoteFile(filePath);
    expect(parsed.meta.title).toBe("Round Trip");
    expect(parsed.body).toBe("Testing round-trip serialization.");
    expect(parsed.meta.tags).toEqual(["meta", "test"]);
    expect(parsed.meta.source).toBe("vitest");
    expect(parsed.meta.links).toEqual(["other-note-id"]);
  });
});
