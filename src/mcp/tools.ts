import { z } from "zod";
import { initKb, listKbs, resolveKb } from "../core/registry.js";
import { openDb, getAllTags, getNote, listNotes, getAllContexts, findBacklinks, getFieldValues } from "../core/database.js";
import { createNote, removeNote, reindexKb } from "../core/notes.js";
import { searchNotes } from "../core/search.js";
import { METADATA_FIELDS, FILTERABLE_FIELDS } from "../core/schema.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function buildAddNoteSchema(): Record<string, z.ZodType> {
  const schema: Record<string, z.ZodType> = {
    kb_name: z.string().describe("Name of the knowledge base"),
    title: z.string().describe("Note title (one idea)"),
    body: z.string().describe("Note body in markdown"),
  };
  for (const field of METADATA_FIELDS) {
    if (field.type === "tags" || field.type === "links") {
      schema[field.name] = z.array(z.string()).optional().describe(field.description);
    } else {
      schema[field.name] = z.string().optional().describe(field.description);
    }
  }
  return schema;
}

function buildFilterSchema(): Record<string, z.ZodType> {
  const schema: Record<string, z.ZodType> = {
    kb_name: z.string().describe("Name of the knowledge base"),
  };
  for (const field of FILTERABLE_FIELDS) {
    if (field.type === "tags") {
      schema[field.name] = z.array(z.string()).optional().describe(`Filter by ${field.name}`);
    } else {
      schema[field.name] = z.string().optional().describe(`Filter by ${field.name}`);
    }
  }
  return schema;
}

export function registerTools(server: McpServer): void {
  server.tool(
    "kb_list_kbs",
    "List all registered knowledge bases",
    {},
    async () => {
      const kbs = listKbs();
      return {
        content: [{ type: "text", text: JSON.stringify(kbs, null, 2) }],
      };
    }
  );

  server.tool(
    "kb_create",
    "Create a new knowledge base at a given path",
    { path: z.string().describe("Absolute or relative path for the new KB") },
    async ({ path: targetPath }) => {
      const { name, absPath } = initKb(targetPath);
      return {
        content: [{ type: "text", text: `Created KB "${name}" at ${absPath}` }],
      };
    }
  );

  server.tool(
    "kb_add_note",
    "Create a new atomic note in a knowledge base",
    buildAddNoteSchema(),
    async (args) => {
      const kbPath = resolveKb(args.kb_name as string);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${args.kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const noteOpts: Record<string, string | string[] | undefined> = {
          title: args.title as string,
          body: args.body as string,
        };
        for (const field of METADATA_FIELDS) {
          if (args[field.name] !== undefined) {
            noteOpts[field.name] = args[field.name] as string | string[];
          }
        }
        const note = createNote(db, kbPath, noteOpts as { title: string; body: string; [key: string]: string | string[] | undefined });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { id: note.meta.id, title: note.meta.title, created: note.meta.created },
                null,
                2
              ),
            },
          ],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_search",
    "Full-text search with optional filters",
    {
      ...buildFilterSchema(),
      query: z.string().describe("FTS5 search query (supports prefix*, boolean AND/OR/NOT, column:scoped)"),
      date_from: z.string().optional().describe("Start date filter (ISO 8601)"),
      date_to: z.string().optional().describe("End date filter (ISO 8601)"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
    async (rawArgs) => {
      const args = rawArgs as Record<string, unknown>;
      const kbPath = resolveKb(args.kb_name as string);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${args.kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const searchOpts: Record<string, string | string[] | number | undefined> = {
          dateFrom: args.date_from as string | undefined,
          dateTo: args.date_to as string | undefined,
          limit: args.limit as number | undefined,
        };
        for (const field of FILTERABLE_FIELDS) {
          if (args[field.name] !== undefined) {
            searchOpts[field.name] = args[field.name] as string | string[];
          }
        }
        const results = searchNotes(db, args.query as string, searchOpts);
        const output = results.map((r) => ({
          id: r.note.id,
          title: r.note.title,
          tags: r.note.tags ? JSON.parse(r.note.tags) : [],
          snippet: r.snippet,
          rank: r.rank,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_get_note",
    "Retrieve a full note by ID",
    {
      kb_name: z.string().describe("Name of the knowledge base"),
      note_id: z.string().describe("Note ID"),
    },
    async ({ kb_name, note_id }) => {
      const kbPath = resolveKb(kb_name);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const row = getNote(db, note_id);
        if (!row) {
          return {
            content: [{ type: "text", text: `Note "${note_id}" not found.` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_list_tags",
    "List all tags with counts in a knowledge base",
    {
      kb_name: z.string().describe("Name of the knowledge base"),
    },
    async ({ kb_name }) => {
      const kbPath = resolveKb(kb_name);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const tags = getAllTags(db);
        return {
          content: [{ type: "text", text: JSON.stringify(tags, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_remove_note",
    "Delete a note from a knowledge base",
    {
      kb_name: z.string().describe("Name of the knowledge base"),
      note_id: z.string().describe("Note ID to delete"),
    },
    async ({ kb_name, note_id }) => {
      const kbPath = resolveKb(kb_name);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        if (removeNote(db, kbPath, note_id)) {
          return {
            content: [{ type: "text", text: `Removed note: ${note_id}` }],
          };
        }
        return {
          content: [{ type: "text", text: `Note "${note_id}" not found.` }],
          isError: true,
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_list_notes",
    "List notes with optional filters (tags, context, source, date range). No search query needed.",
    {
      ...buildFilterSchema(),
      date_from: z.string().optional().describe("Start date filter (ISO 8601)"),
      date_to: z.string().optional().describe("End date filter (ISO 8601)"),
      limit: z.number().optional().describe("Max results (default 100)"),
    },
    async (rawArgs) => {
      const args = rawArgs as Record<string, unknown>;
      const kbPath = resolveKb(args.kb_name as string);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${args.kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const listOpts: Record<string, string | string[] | number | undefined> = {
          dateFrom: args.date_from as string | undefined,
          dateTo: args.date_to as string | undefined,
          limit: args.limit as number | undefined,
        };
        for (const field of FILTERABLE_FIELDS) {
          if (args[field.name] !== undefined) {
            listOpts[field.name] = args[field.name] as string | string[];
          }
        }
        const notes = listNotes(db, listOpts);
        const output = notes.map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags ? JSON.parse(n.tags) : [],
          context: n.context,
          created: n.created,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_list_contexts",
    "List all unique contexts with note counts in a knowledge base",
    {
      kb_name: z.string().describe("Name of the knowledge base"),
    },
    async ({ kb_name }) => {
      const kbPath = resolveKb(kb_name);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const contexts = getAllContexts(db);
        return {
          content: [{ type: "text", text: JSON.stringify(contexts, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_list_field_values",
    "List all unique values for a metadata field with note counts",
    {
      kb_name: z.string().describe("Name of the knowledge base"),
      field: z.string().describe("Field name (e.g. context, workspace, source)"),
    },
    async ({ kb_name, field }) => {
      const kbPath = resolveKb(kb_name);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const values = getFieldValues(db, field);
        return {
          content: [{ type: "text", text: JSON.stringify(values, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_backlinks",
    "Find all notes that link to a given note (backlink discovery)",
    {
      kb_name: z.string().describe("Name of the knowledge base"),
      note_id: z.string().describe("Note ID to find backlinks for"),
    },
    async ({ kb_name, note_id }) => {
      const kbPath = resolveKb(kb_name);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${kb_name}" not found.` }],
          isError: true,
        };
      }
      const db = openDb(kbPath);
      try {
        const notes = findBacklinks(db, note_id);
        const output = notes.map((n) => ({
          id: n.id,
          title: n.title,
          tags: n.tags ? JSON.parse(n.tags) : [],
        }));
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        };
      } finally {
        db.close();
      }
    }
  );

  server.tool(
    "kb_distill",
    "Accept markdown content to be broken into atomic notes. Returns structured guidance for the LLM to decompose and commit each atomic fact via kb_add_note.",
    {
      kb_name: z.string().describe("Name of the knowledge base"),
      content: z.string().describe("Markdown content to distill into atomic notes"),
      source: z.string().optional().describe("Source of the content"),
      context: z.string().optional().describe("Context for the content"),
      tags: z.array(z.string()).optional().describe("Default tags to apply"),
    },
    async ({ kb_name, content, source, context, tags }) => {
      const kbPath = resolveKb(kb_name);
      if (!kbPath) {
        return {
          content: [{ type: "text", text: `KB "${kb_name}" not found.` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                instruction:
                  "Break the following content into atomic notes (one idea per note). For each atomic fact, call kb_add_note with a clear title, the fact as the body, and appropriate tags. Link related notes together.",
                kb_name,
                content,
                default_source: source ?? "",
                default_context: context ?? "",
                default_tags: tags ?? [],
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
