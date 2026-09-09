import { readdir, readFile, lstat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { safePath } from "../kernel/io.js";
import { canonicalJson, record, text } from "../kernel/schema.js";

export interface LegacyRecord {
  path: string; fingerprint: string; originalId: string; originalStatus: string;
  title: string; goal: string; constraints: string[]; historicalEvidence: unknown[];
  quality: "standard" | "tdd";
}
function issueCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (typeof code === "string" && /^[A-Z_]+$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return /^LEGACY_[A-Z_]+$/.test(message) ? message : "LEGACY_INVALID";
}
export async function inspectLegacy(sourceRoot: string): Promise<{ records: LegacyRecord[]; fingerprint: string; issues: Array<{ path: string; code: string }> }> {
  const root = resolve(sourceRoot), files = new Map<string, Buffer>(), records: LegacyRecord[] = [], issues: Array<{ path: string; code: string }> = [];
  let total = 0;
  async function read(path: string): Promise<Buffer> {
    await safePath(root, path);
    const info = await lstat(path);
    if (!info.isFile() || info.size > 4 * 1024 * 1024 || (total += info.size) > 32 * 1024 * 1024) throw new Error("LEGACY_LIMIT");
    const bytes = await readFile(path); files.set(relative(root, path), bytes); return bytes;
  }
  try {
    const config = record(JSON.parse((await read(join(root, "config.json"))).toString()));
    if (![1, 2].includes(config.schemaVersion as number)) throw new Error("LEGACY_SCHEMA_UNSUPPORTED");
    const walk = async (directory: string): Promise<void> => {
      await safePath(root, directory);
      const children = await readdir(directory, { withFileTypes: true }).catch(e => { if (e.code === "ENOENT") return []; throw e; });
      if (children.some(e => e.name === "task.json")) {
        try {
          const bytes = await read(join(directory, "task.json")), task = record(JSON.parse(bytes.toString()));
          if (![1, 2].includes(task.schemaVersion as number)) throw new Error("LEGACY_SCHEMA_UNSUPPORTED");
          text(task.id); text(task.title); text(task.status);
          let evidence: unknown[] = [];
          if (children.some(e => e.name === "evidence.jsonl")) evidence = (await read(join(directory, "evidence.jsonl"))).toString().split("\n").filter(Boolean).map(line => JSON.parse(line));
          const constraints = Array.isArray(task.requirements) ? task.requirements.map(r => record(r).text).filter((t): t is string => typeof t === "string" && !!t.trim()) : [];
          for (const entry of children) if (entry.isFile() && !["task.json", "evidence.jsonl"].includes(entry.name)) await read(join(directory, entry.name));
          const journal = files.get(relative(root, join(directory, "journal.md")))?.toString() ?? "";
          const pending = new Set<string>();
          for (const line of journal.split("\n").filter(l => l.trim().startsWith("{"))) {
            const event = record(JSON.parse(line));
            if (typeof event.operationId === "string") {
              if (String(event.type).endsWith("_intent")) pending.add(event.operationId); else pending.delete(event.operationId);
            }
          }
          if (pending.size) throw new Error("LEGACY_PENDING_MUTATION");
          records.push({ path: directory, fingerprint: createHash("sha256").update(bytes).digest("hex"), originalId: task.id as string,
            originalStatus: task.status as string, title: task.title as string, goal: constraints.join("\n") || task.title as string,
            constraints, historicalEvidence: evidence, quality: task.qualityMode === "tdd" ? "tdd" : "standard" });
        } catch (error) { issues.push({ path: directory, code: issueCode(error) }); }
      }
      for (const child of children) {
        if (child.isSymbolicLink()) { issues.push({ path: join(directory, child.name), code: "UNSAFE_PATH" }); continue; }
        if (child.isDirectory()) await walk(join(directory, child.name));
      }
    };
    await walk(join(root, "tasks", "active")); await walk(join(root, "tasks", "archive"));
    const migration = join(root, ".runtime", "schema-migration.json");
    try {
      const value = record(JSON.parse((await read(migration)).toString()));
      if (value.phase === "intent") issues.push({ path: migration, code: "LEGACY_PENDING_MIGRATION" });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  } catch (error) { issues.push({ path: root, code: issueCode(error) }); }
  const fingerprints = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, createHash("sha256").update(bytes).digest("hex")]);
  return { records, fingerprint: createHash("sha256").update(canonicalJson(fingerprints)).digest("hex"), issues };
}
