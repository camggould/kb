export interface MetadataFieldDef {
  name: string;
  type: "text" | "tags" | "links";
  description: string;
  filterable: boolean;
  filterMode: "exact" | "like";
  fts: boolean;
  showInList: boolean;
}

export const METADATA_FIELDS: MetadataFieldDef[] = [
  { name: "tags",      type: "tags",  description: "Tags for categorization",       filterable: true,  filterMode: "like",  fts: true,  showInList: true  },
  { name: "source",    type: "text",  description: "Where the info came from",      filterable: true,  filterMode: "like",  fts: true,  showInList: false },
  { name: "context",   type: "text",  description: "Why/when it was captured",      filterable: true,  filterMode: "like",  fts: true,  showInList: true  },
  { name: "workspace", type: "text",  description: "Workspace name (from ws-cli)",  filterable: true,  filterMode: "exact", fts: true,  showInList: true  },
  { name: "links",     type: "links", description: "IDs of related notes",          filterable: false, filterMode: "like",  fts: false, showInList: false },
];

export const FILTERABLE_FIELDS = METADATA_FIELDS.filter(f => f.filterable);
export const FTS_FIELDS = METADATA_FIELDS.filter(f => f.fts);
export const ALL_FIELD_NAMES = METADATA_FIELDS.map(f => f.name);
