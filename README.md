# kb — Zettelkasten Knowledge Base

A CLI + MCP server for managing Zettelkasten-style atomic knowledge bases. Use `kb` from the terminal, or let LLMs commit/search/read notes via MCP.

Notes are atomic (one idea per note), stored as Markdown files with YAML frontmatter, and indexed in SQLite with FTS5 for full-text search.

## Install

```bash
npm install
npm run build
npm link  # makes `kb` available globally
```

## CLI Usage

```bash
# Create a new knowledge base
kb create ~/cooking-kb

# List registered KBs
kb list

# Add a note
kb add cooking-kb -t "Pasta Water Tip" -b "Salt your pasta water generously." --tags "cooking,pasta,tips"

# Read from stdin
echo "Long note body..." | kb add cooking-kb -t "My Note" --stdin

# Full-text search (supports prefix*, AND/OR/NOT, column:scoped)
kb search cooking-kb "pasta"
kb search cooking-kb "pasta AND NOT lasagna" --tags "italian" --limit 10

# Read a specific note
kb get cooking-kb 20260226T143000-pasta-water-tip

# List all tags with counts
kb tags cooking-kb

# Delete a note
kb remove cooking-kb 20260226T143000-pasta-water-tip

# Rebuild index from markdown files
kb reindex cooking-kb

# Unregister a KB (doesn't delete files)
kb unregister cooking-kb
```

## MCP Server

Configure in Claude Code settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "kb": {
      "command": "node",
      "args": ["/absolute/path/to/kb/dist/index.js"]
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `kb_list_kbs` | List all registered knowledge bases |
| `kb_create` | Create a new KB at a given path |
| `kb_add_note` | Create a new atomic note (title, body, tags, source, context, workspace, links) |
| `kb_search` | Full-text search with optional filters (tags, date range, source, context, workspace) |
| `kb_get_note` | Retrieve full note by ID |
| `kb_list_tags` | List all tags with counts |
| `kb_list_notes` | List notes with optional filters |
| `kb_list_contexts` | List all unique contexts with counts |
| `kb_list_field_values` | List unique values for any metadata field |
| `kb_remove_note` | Delete a note |
| `kb_backlinks` | Find all notes that link to a given note |
| `kb_distill` | Accept markdown content for the LLM to decompose into atomic notes |

## KB Structure

```
my-kb/
├── .kb/
│   ├── index.db          # SQLite + FTS5 index
│   └── config.json       # Per-KB config
├── notes/
│   ├── 20260226T143000-spaghetti-recipe.md
│   ├── 20260226T143500-pasta-water-tip.md
│   └── ...
```

## Note Format

```markdown
---
id: 20260226T143000-spaghetti-recipe
created: 2026-02-26T14:30:00Z
modified: 2026-02-26T14:30:00Z
tags: [cooking, italian, pasta]
source: "conversation with Claude"
context: "meal planning session"
links: [20260226T143500-pasta-water-tip]
---

# Spaghetti Recipe from Nonna

The best spaghetti sauce uses San Marzano tomatoes...
```

## Search Syntax

FTS5 supports:
- **Keywords**: `spaghetti`
- **Prefix**: `spag*`
- **Boolean**: `pasta AND NOT lasagna`
- **Column-scoped**: `tags:italian`
- **Phrases**: `"san marzano tomatoes"`

## Development

```bash
npm run dev        # watch mode
npm test           # run tests
npm run build      # compile TypeScript
```

## Extending Metadata Fields

Note metadata is defined by a single schema in `src/core/schema.ts`. Adding a new field requires **one edit** — everything else (DB columns, FTS indexing, frontmatter serialization, CLI flags, MCP tool parameters, search filters, and display formatting) is derived automatically.

### Adding a field

Add an entry to the `METADATA_FIELDS` array in `src/core/schema.ts`:

```ts
export const METADATA_FIELDS: MetadataFieldDef[] = [
  // ...existing fields...
  { name: "project", type: "text", description: "Project name", filterable: true, filterMode: "exact", fts: true, showInList: true },
];
```

Then rebuild (`npm run build`). For existing KBs, run `kb reindex <kb_name>` to pick up the new column.

### Field definition options

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | DB column name, frontmatter key, and CLI flag name |
| `type` | `"text" \| "tags" \| "links"` | `text` = plain string, `tags`/`links` = JSON string array |
| `description` | `string` | Used in CLI `--help` and MCP tool descriptions |
| `filterable` | `boolean` | Whether this field gets a `--flag` on CLI and a param on MCP tools |
| `filterMode` | `"exact" \| "like"` | SQL filter: `= val` vs `LIKE %val%` |
| `fts` | `boolean` | Include in the FTS5 full-text search index |
| `showInList` | `boolean` | Display in `kb notes` and `kb get` output |

### What stays outside the schema

These are structural, not metadata, and remain hardcoded:

- Core note fields: `id`, `title`, `body`, `created`, `modified`, `file_path`
- Query parameters: `dateFrom`, `dateTo`, `limit`
- Behavioral logic: `detectWorkspace()` auto-detection, `findBacklinks()` cross-note query

## Integration with ws-cli / ws-mcp

`kb` integrates with [ws-cli](https://github.com/camggould/ws-cli) and [ws-mcp](https://github.com/camggould/ws-mcp) for workspace-aware note capture. When adding a note, `kb` automatically detects the current workspace by walking up the directory tree looking for a `.workspace.yaml` file (the same format used by `ws-cli`). The detected workspace name is stored in the note's `workspace` metadata field.

This means notes created inside a workspace are automatically tagged with that workspace — no `--workspace` flag needed:

```bash
cd ~/projects/my-app   # contains .workspace.yaml with name: my-app
kb add my-kb -t "Bug fix approach" -b "Use retry logic for transient failures."
# workspace: "my-app" is set automatically
```

You can then filter notes by workspace in both the CLI and MCP:

```bash
kb notes my-kb --workspace my-app
kb search my-kb "retry" --workspace my-app
```

When both `kb` and `ws-mcp` are registered as MCP servers, an LLM can use `ws-mcp` to discover the active workspace and pass it to `kb_add_note`, or rely on the CLI's auto-detection when invoked from within a workspace directory.

## Global Registry

KBs are tracked in `~/.config/kb/registry.json`, mapping names to absolute paths. The KB name is the folder name (e.g., `/home/user/cooking-kb` → `cooking-kb`).
