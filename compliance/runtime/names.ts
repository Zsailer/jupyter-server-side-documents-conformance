/**
 * What a story is called. A story is named `group/what-happens`; the name it had before is kept as an alias, so that
 * anything written with the old one (a known-gaps file, `COMPLIANCE_DECISIONS`, a command line) still finds the story.
 */
export interface Named {
  id: string;
  aliases?: string[];
}

/** The entry of a table keyed by story name for this story: under its name, or else under one of its old names. */
export function byName<T>(table: Record<string, T> | undefined, story: Named): T | undefined {
  if (!table) {
    return undefined;
  }
  for (const name of [story.id, ...(story.aliases ?? [])]) {
    if (Object.prototype.hasOwnProperty.call(table, name)) {
      return table[name];
    }
  }
  return undefined;
}

/** The name as part of a file name: no folder, no capital. (`crash/dies-before-save` is `crash-dies-before-save`.) */
export function fileNameOf(story: Named): string {
  return story.id.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase();
}
