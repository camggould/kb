import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openDb, listNotes, getAllContexts, findBacklinks } from "../../src/core/database.js";
import { createNote } from "../../src/core/notes.js";
import { searchNotes } from "../../src/core/search.js";
import type Database from "better-sqlite3";

const TEST_DIR = path.join(os.tmpdir(), "kb-test-search-" + Date.now());
let db: Database.Database;

beforeEach(() => {
  fs.mkdirSync(path.join(TEST_DIR, "notes"), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, ".kb"), { recursive: true });
  db = openDb(TEST_DIR);

  const pasta = createNote(db, TEST_DIR, {
    title: "Italian Pasta",
    body: "Spaghetti with San Marzano tomatoes and fresh basil.",
    tags: ["cooking", "italian"],
    source: "recipe book",
    context: "meal planning",
  });
  createNote(db, TEST_DIR, {
    title: "French Bread",
    body: "Baguette requires high-gluten flour and long fermentation.",
    tags: ["cooking", "french"],
    source: "bakery visit",
    context: "meal planning",
    links: [pasta.meta.id],
  });
  createNote(db, TEST_DIR, {
    title: "TypeScript Generics",
    body: "Generics allow creating reusable components with type safety.",
    tags: ["programming", "typescript"],
    source: "documentation",
    context: "debugging session",
  });
});

afterEach(() => {
  db.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("search", () => {
  it("should find notes by keyword", () => {
    const results = searchNotes(db, "spaghetti");
    expect(results.length).toBe(1);
    expect(results[0].note.title).toBe("Italian Pasta");
  });

  it("should find notes by prefix query", () => {
    const results = searchNotes(db, "spag*");
    expect(results.length).toBe(1);
  });

  it("should filter by tags", () => {
    const results = searchNotes(db, "cooking", { tags: ["french"] });
    expect(results.length).toBe(1);
    expect(results[0].note.title).toBe("French Bread");
  });

  it("should filter by source", () => {
    const results = searchNotes(db, "cooking", { source: "recipe" });
    expect(results.length).toBe(1);
    expect(results[0].note.title).toBe("Italian Pasta");
  });

  it("should return empty for no match", () => {
    const results = searchNotes(db, "quantum physics");
    expect(results.length).toBe(0);
  });

  it("should respect limit", () => {
    const results = searchNotes(db, "cooking OR programming", { limit: 1 });
    expect(results.length).toBe(1);
  });

  it("should filter by context", () => {
    const results = searchNotes(db, "cooking", { context: "meal planning" });
    expect(results.length).toBe(2);
  });
});

describe("listNotes", () => {
  it("should list all notes without filters", () => {
    const notes = listNotes(db);
    expect(notes.length).toBe(3);
  });

  it("should filter by context", () => {
    const notes = listNotes(db, { context: "meal planning" });
    expect(notes.length).toBe(2);
    expect(notes.every((n) => n.context === "meal planning")).toBe(true);
  });

  it("should filter by tags", () => {
    const notes = listNotes(db, { tags: ["cooking"] });
    expect(notes.length).toBe(2);
  });

  it("should combine filters", () => {
    const notes = listNotes(db, { tags: ["cooking"], context: "meal planning" });
    expect(notes.length).toBe(2);
  });

  it("should filter by source", () => {
    const notes = listNotes(db, { source: "recipe" });
    expect(notes.length).toBe(1);
    expect(notes[0].title).toBe("Italian Pasta");
  });
});

describe("contexts", () => {
  it("should list all contexts with counts", () => {
    const contexts = getAllContexts(db);
    expect(contexts.length).toBe(2);
    const meal = contexts.find((c) => c.context === "meal planning");
    expect(meal?.count).toBe(2);
    const debug = contexts.find((c) => c.context === "debugging session");
    expect(debug?.count).toBe(1);
  });
});

describe("backlinks", () => {
  it("should find notes that link to a given note", () => {
    // French Bread links to Italian Pasta
    const notes = listNotes(db, { tags: ["italian"] });
    const pastaId = notes[0].id;
    const backlinks = findBacklinks(db, pastaId);
    expect(backlinks.length).toBe(1);
    expect(backlinks[0].title).toBe("French Bread");
  });

  it("should return empty for notes with no backlinks", () => {
    const notes = listNotes(db, { tags: ["typescript"] });
    const tsId = notes[0].id;
    const backlinks = findBacklinks(db, tsId);
    expect(backlinks.length).toBe(0);
  });
});
