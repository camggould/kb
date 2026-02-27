import type { NoteRow } from "../core/database.js";
import type { SearchResult } from "../core/search.js";
import type { Registry } from "../core/registry.js";
import { METADATA_FIELDS } from "../core/schema.js";

export function formatKbList(registry: Registry): string {
  const entries = Object.entries(registry);
  if (entries.length === 0) return "No knowledge bases registered.";
  const lines = entries.map(([name, p]) => `  ${name}  →  ${p}`);
  return `Registered KBs:\n${lines.join("\n")}`;
}

function formatFieldValue(note: NoteRow, fieldName: string, fieldType: string): string | null {
  const val = note[fieldName];
  if (!val) return null;
  if (fieldType === "tags" || fieldType === "links") {
    try {
      const arr: string[] = JSON.parse(val);
      if (arr.length === 0) return null;
      return `${capitalize(fieldName)}: ${arr.join(", ")}`;
    } catch {
      return null;
    }
  }
  return `${capitalize(fieldName)}: ${val}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatNote(note: NoteRow): string {
  const lines: string[] = [
    `# ${note.title}`,
    `ID: ${note.id}`,
    `Created: ${note.created}`,
  ];

  for (const field of METADATA_FIELDS) {
    const formatted = formatFieldValue(note, field.name, field.type);
    if (formatted) lines.push(formatted);
  }

  lines.push("", note.body);
  return lines.join("\n");
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  const lines = results.map((r, i) => {
    const tags = r.note.tags ? JSON.parse(r.note.tags).join(", ") : "";
    return [
      `${i + 1}. ${r.note.title}`,
      `   ID: ${r.note.id}`,
      tags ? `   Tags: ${tags}` : null,
      `   ${r.snippet}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return lines.join("\n\n");
}

export function formatTags(tags: { tag: string; count: number }[]): string {
  if (tags.length === 0) return "No tags found.";
  return tags.map((t) => `  ${t.tag} (${t.count})`).join("\n");
}

export function formatNoteList(notes: NoteRow[]): string {
  if (notes.length === 0) return "No notes found.";
  return notes
    .map((n, i) => {
      const parts = [
        `${i + 1}. ${n.title}`,
        `   ID: ${n.id}`,
        `   Created: ${n.created}`,
      ];
      for (const field of METADATA_FIELDS) {
        if (!field.showInList) continue;
        const formatted = formatFieldValue(n, field.name, field.type);
        if (formatted) parts.push(`   ${formatted}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

export function formatFieldValues(values: { value: string; count: number }[], fieldName: string): string {
  if (values.length === 0) return `No ${fieldName}s found.`;
  return values.map((v) => `  ${v.value} (${v.count})`).join("\n");
}

export function formatContexts(contexts: { context: string; count: number }[]): string {
  if (contexts.length === 0) return "No contexts found.";
  return contexts.map((c) => `  ${c.context} (${c.count})`).join("\n");
}

export function formatBacklinks(notes: NoteRow[], noteId: string): string {
  if (notes.length === 0) return `No notes link to ${noteId}.`;
  return notes
    .map((n, i) => {
      const tags = n.tags ? JSON.parse(n.tags).join(", ") : "";
      const parts = [`${i + 1}. ${n.title}`, `   ID: ${n.id}`];
      if (tags) parts.push(`   Tags: ${tags}`);
      return parts.join("\n");
    })
    .join("\n\n");
}
