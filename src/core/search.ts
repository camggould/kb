import type Database from "better-sqlite3";
import type { NoteRow } from "./database.js";
import { FILTERABLE_FIELDS } from "./schema.js";

export interface SearchOptions {
  [key: string]: string | string[] | number | undefined;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface SearchResult {
  note: NoteRow;
  rank: number;
  snippet: string;
}

export function searchNotes(
  db: Database.Database,
  query: string,
  opts: SearchOptions = {}
): SearchResult[] {
  const limit = opts.limit ?? 20;

  let sql = `
    SELECT notes.*, notes_fts.rank,
      snippet(notes_fts, 1, '>>>', '<<<', '...', 40) as snippet
    FROM notes_fts
    JOIN notes ON notes.rowid = notes_fts.rowid
    WHERE notes_fts MATCH ?
  `;
  const params: unknown[] = [query];

  for (const field of FILTERABLE_FIELDS) {
    const val = opts[field.name];
    if (val === undefined || val === null) continue;

    if (field.type === "tags") {
      const tags = val as string[];
      if (tags.length > 0) {
        for (const tag of tags) {
          sql += ` AND notes.${field.name} LIKE ?`;
          params.push(`%${tag}%`);
        }
      }
    } else if (field.filterMode === "exact") {
      sql += ` AND notes.${field.name} = ?`;
      params.push(val);
    } else {
      sql += ` AND notes.${field.name} LIKE ?`;
      params.push(`%${val}%`);
    }
  }

  if (opts.dateFrom) {
    sql += ` AND notes.created >= ?`;
    params.push(opts.dateFrom);
  }
  if (opts.dateTo) {
    sql += ` AND notes.created <= ?`;
    params.push(opts.dateTo);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as (NoteRow & { rank: number; snippet: string })[];
  return rows.map((row) => {
    const { rank, snippet, ...noteFields } = row;
    return { note: noteFields as NoteRow, rank, snippet };
  });
}
