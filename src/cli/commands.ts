import { Command } from "commander";
import fs from "node:fs";
import { initKb, listKbs, resolveKb, unregisterKb } from "../core/registry.js";
import { openDb, getAllTags, getNote, listNotes, getAllContexts, findBacklinks, getFieldValues } from "../core/database.js";
import { createNote, readNote, removeNote, reindexKb, detectWorkspace } from "../core/notes.js";
import { searchNotes } from "../core/search.js";
import { formatKbList, formatNote, formatSearchResults, formatTags, formatNoteList, formatContexts, formatBacklinks, formatFieldValues } from "./formatter.js";
import { METADATA_FIELDS, FILTERABLE_FIELDS } from "../core/schema.js";

export function buildCli(): Command {
  const program = new Command();
  program
    .name("kb")
    .description("Zettelkasten-style atomic knowledge base manager")
    .version("1.0.0");

  program
    .command("create <path>")
    .description("Initialize a new KB at path and register it globally")
    .action((targetPath: string) => {
      const { name, absPath } = initKb(targetPath);
      console.log(`Created KB "${name}" at ${absPath}`);
    });

  program
    .command("list")
    .description("List all registered KBs")
    .action(() => {
      console.log(formatKbList(listKbs()));
    });

  // Build "add" command with schema-driven options
  const addCmd = program
    .command("add <kb_name>")
    .description("Add a note to a KB")
    .requiredOption("-t, --title <title>", "Note title")
    .option("-b, --body <body>", "Note body", "");

  for (const field of METADATA_FIELDS) {
    if (field.type === "tags" || field.type === "links") {
      addCmd.option(`--${field.name} <${field.name}>`, `Comma-separated ${field.description.toLowerCase()}`);
    } else {
      const extra = field.name === "workspace" ? " (auto-detected from .workspace.yaml if omitted)" : "";
      addCmd.option(`--${field.name} <${field.name}>`, `${field.description}${extra}`);
    }
  }
  addCmd
    .option("--stdin", "Read body from stdin")
    .action(async (kbName: string, opts) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found. Run "kb list" to see registered KBs.`);
        process.exit(1);
      }
      let body = opts.body;
      if (opts.stdin) {
        body = fs.readFileSync(0, "utf-8").trim();
      }

      // Build createNote opts from schema
      const noteOpts: Record<string, string | string[] | undefined> = {
        title: opts.title,
        body,
      };
      for (const field of METADATA_FIELDS) {
        if (field.type === "tags" || field.type === "links") {
          noteOpts[field.name] = opts[field.name]
            ? opts[field.name].split(",").map((s: string) => s.trim())
            : undefined;
        } else if (field.name === "workspace") {
          noteOpts[field.name] = opts.workspace ?? (detectWorkspace() || undefined);
        } else {
          noteOpts[field.name] = opts[field.name];
        }
      }

      const db = openDb(kbPath);
      try {
        const note = createNote(db, kbPath, noteOpts as { title: string; body: string; [key: string]: string | string[] | undefined });
        console.log(`Added note: ${note.meta.id}`);
      } finally {
        db.close();
      }
    });

  // Build "search" command with schema-driven filter options
  const searchCmd = program
    .command("search <kb_name> <query>")
    .description("Full-text search in a KB");

  for (const field of FILTERABLE_FIELDS) {
    if (field.type === "tags") {
      searchCmd.option(`--${field.name} <${field.name}>`, `Filter by comma-separated ${field.name}`);
    } else {
      searchCmd.option(`--${field.name} <${field.name}>`, `Filter by ${field.name}`);
    }
  }
  searchCmd
    .option("--from <date>", "Filter by start date (ISO 8601)")
    .option("--to <date>", "Filter by end date (ISO 8601)")
    .option("-n, --limit <n>", "Max results", "20")
    .action((kbName: string, query: string, opts) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        const searchOpts: Record<string, string | string[] | number | undefined> = {
          dateFrom: opts.from,
          dateTo: opts.to,
          limit: parseInt(opts.limit, 10),
        };
        for (const field of FILTERABLE_FIELDS) {
          if (field.type === "tags") {
            searchOpts[field.name] = opts[field.name]
              ? opts[field.name].split(",").map((s: string) => s.trim())
              : undefined;
          } else {
            searchOpts[field.name] = opts[field.name];
          }
        }
        const results = searchNotes(db, query, searchOpts);
        console.log(formatSearchResults(results));
      } finally {
        db.close();
      }
    });

  program
    .command("get <kb_name> <note_id>")
    .description("Read a specific note")
    .action((kbName: string, noteId: string) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        const row = getNote(db, noteId);
        if (!row) {
          console.error(`Note "${noteId}" not found.`);
          process.exit(1);
        }
        console.log(formatNote(row));
      } finally {
        db.close();
      }
    });

  program
    .command("tags <kb_name>")
    .description("List all tags in a KB")
    .action((kbName: string) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        console.log(formatTags(getAllTags(db)));
      } finally {
        db.close();
      }
    });

  program
    .command("remove <kb_name> <note_id>")
    .description("Delete a note")
    .action((kbName: string, noteId: string) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        if (removeNote(db, kbPath, noteId)) {
          console.log(`Removed note: ${noteId}`);
        } else {
          console.error(`Note "${noteId}" not found.`);
          process.exit(1);
        }
      } finally {
        db.close();
      }
    });

  program
    .command("reindex <kb_name>")
    .description("Rebuild SQLite index from markdown files")
    .action((kbName: string) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        const count = reindexKb(db, kbPath);
        console.log(`Reindexed ${count} notes.`);
      } finally {
        db.close();
      }
    });

  // Build "notes" command with schema-driven filter options
  const notesCmd = program
    .command("notes <kb_name>")
    .description("List notes, optionally filtered by metadata fields or date");

  for (const field of FILTERABLE_FIELDS) {
    if (field.type === "tags") {
      notesCmd.option(`--${field.name} <${field.name}>`, `Filter by comma-separated ${field.name}`);
    } else {
      notesCmd.option(`--${field.name} <${field.name}>`, `Filter by ${field.name}`);
    }
  }
  notesCmd
    .option("--from <date>", "Filter by start date (ISO 8601)")
    .option("--to <date>", "Filter by end date (ISO 8601)")
    .option("-n, --limit <n>", "Max results", "100")
    .action((kbName: string, opts) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        const listOpts: Record<string, string | string[] | number | undefined> = {
          dateFrom: opts.from,
          dateTo: opts.to,
          limit: parseInt(opts.limit, 10),
        };
        for (const field of FILTERABLE_FIELDS) {
          if (field.type === "tags") {
            listOpts[field.name] = opts[field.name]
              ? opts[field.name].split(",").map((s: string) => s.trim())
              : undefined;
          } else {
            listOpts[field.name] = opts[field.name];
          }
        }
        const notes = listNotes(db, listOpts);
        console.log(formatNoteList(notes));
      } finally {
        db.close();
      }
    });

  program
    .command("contexts <kb_name>")
    .description("List all contexts with counts")
    .action((kbName: string) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        console.log(formatContexts(getAllContexts(db)));
      } finally {
        db.close();
      }
    });

  program
    .command("backlinks <kb_name> <note_id>")
    .description("Find all notes that link to a given note")
    .action((kbName: string, noteId: string) => {
      const kbPath = resolveKb(kbName);
      if (!kbPath) {
        console.error(`KB "${kbName}" not found.`);
        process.exit(1);
      }
      const db = openDb(kbPath);
      try {
        const notes = findBacklinks(db, noteId);
        console.log(formatBacklinks(notes, noteId));
      } finally {
        db.close();
      }
    });

  program
    .command("unregister <kb_name>")
    .description("Remove KB from registry (doesn't delete files)")
    .action((kbName: string) => {
      unregisterKb(kbName);
      console.log(`Unregistered KB "${kbName}".`);
    });

  return program;
}
