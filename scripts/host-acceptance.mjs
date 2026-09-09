import { execFile, spawn, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, cp, realpath, symlink, access, readdir, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("..", import.meta.url));
const baseline = "049f1720bf1a3fd3d2e0f753d55c166e66633322";
const common = "Only modify this disposable fixture's src/ and tests/. Do not commit, push, deploy, install dependencies, access credentials, use the network except model inference, delegate, or touch another repository. Preserve unrelated files. You are authorized to implement and test now; standard quality, single agent. Do not ask process questions. Deliver an uncommitted result and report actual verification. Test commands are authorized; framework metadata, when applicable, may be written in this fixture only.";
const cases = {
  tags: {
    file: "tags.mjs",
    seed: 'export const tagTitle = "Tags";\nexport function normalizeTags(input) { return input; }\n',
    request: "Implement normalizeTags(input) in src/tags.mjs. Accept a comma-separated string or an array of strings; trim and lowercase tags, discard empty strings, remove duplicates preserving first appearance, and never mutate an input array. Reject other input types or any non-string array element with TypeError. Preserve tagTitle. Add meaningful node:test tests.",
    assertions: `const {normalizeTags,tagTitle}=await import(target); assert.equal(tagTitle,"Tags"); assert.deepEqual(normalizeTags(" Red, BLUE,red, ,blue, Green "),["red","blue","green"]); const a=[" A ","a",""]; assert.deepEqual(normalizeTags(a),["a"]); assert.deepEqual(a,[" A ","a",""]); assert.deepEqual(normalizeTags(""),[]); for(const x of [null,undefined,42,{},["x",1]]) assert.throws(()=>normalizeTags(x),TypeError);`,
  },
  duration: {
    file: "duration.mjs",
    seed: 'export function formatDuration(seconds) { if (!seconds) return "--"; return `${Math.round(seconds / 60)}:${seconds % 60}`; }\nexport const durationUnit = "seconds";\n',
    request: "Fix formatDuration(seconds) in src/duration.mjs. It accepts only nonnegative safe integer numbers and returns HH:MM:SS, with every field padded to at least two digits and hours not truncated. Examples: 0 -> 00:00:00, 59 -> 00:00:59, 3661 -> 01:01:01, 360000 -> 100:00:00. Invalid types, negative, fractional, non-finite and unsafe integers must throw TypeError. Preserve durationUnit. Add meaningful node:test regressions.",
    assertions: `const {formatDuration,durationUnit}=await import(target); assert.equal(durationUnit,"seconds"); for(const [n,s] of [[0,"00:00:00"],[59,"00:00:59"],[60,"00:01:00"],[3599,"00:59:59"],[3661,"01:01:01"],[360000,"100:00:00"]]) assert.equal(formatDuration(n),s); for(const x of [-1,0.5,NaN,Infinity,"60",null,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>formatDuration(x),TypeError);`,
  },
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function json(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }); }
function gitEnvironment() {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
  for (const key of ["GIT_DIR","GIT_WORK_TREE","GIT_COMMON_DIR","GIT_INDEX_FILE"]) delete env[key];
  return env;
}
async function git(cwd, ...args) { return (await exec("git", args, { cwd, env: gitEnvironment() })).stdout.trim(); }

function inlineToml(value) {
  if (Array.isArray(value)) return `[${value.map(inlineToml).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).map(([k,v]) => `${JSON.stringify(k)}=${inlineToml(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function createHome(root, arm, sourceConfig) {
  const home = join(root, "homes", arm), codexHome = join(home, ".codex");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  const config = Object.entries(sourceConfig).map(([k,v]) => `${k} = ${inlineToml(v)}`).join("\n")
    + '\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n';
  await writeFile(join(codexHome, "config.toml"), config, { mode: 0o600 });
  const auth = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");
  if (await access(auth).then(() => true, () => false)) await symlink(auth, join(codexHome, "auth.json"));
  return { home, codexHome };
}
function environment(home) {
  return { ...process.env, HOME: home.home, CODEX_HOME: home.codexHome, XDG_CONFIG_HOME: join(home.home, ".config"),
    GIT_CONFIG_GLOBAL: "/dev/null", NODE_USE_ENV_PROXY: "0" };
}
async function fixture(root, name, kind) {
  const cwd = join(root, "fixtures", name);
  await mkdir(join(root,"fixtures"), { recursive: true });
  await mkdir(cwd);
  await mkdir(join(cwd, "src")); await mkdir(join(cwd, "tests"));
  await writeFile(join(cwd, "src", cases[kind].file), cases[kind].seed);
  await writeFile(join(cwd, "tests", "baseline.test.mjs"), 'import {test} from "node:test"; import assert from "node:assert/strict"; test("fixture baseline",()=>assert.equal(1,1));\n');
  await writeFile(join(cwd, "unrelated.txt"), "PRESERVE THIS FILE\n");
  await writeFile(join(cwd, "AGENTS.md"), "# Fixture scope\n\n" + common + "\n");
  await git(cwd, "init");
  if (await realpath(await git(cwd,"rev-parse","--show-toplevel")) !== await realpath(cwd)) throw new Error("Fixture Git root mismatch");
  await git(cwd, "add", "src", "tests", "AGENTS.md", "unrelated.txt");
  await git(cwd, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-c", "user.name=Vinea Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "fixture baseline");
  return { cwd, kind, base: await git(cwd, "rev-parse", "HEAD") };
}
export async function prepare() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vinea-host-acceptance-")));
  await mkdir(join(root, "results"), { mode: 0o700 });
  await mkdir(join(root, "packages/new/.agents/plugins"), { recursive: true });
  await cp(join(repo, "plugins/vinea"), join(root, "packages/new/plugins/vinea"), { recursive: true });
  await cp(join(repo, ".agents/plugins/marketplace.json"), join(root, "packages/new/.agents/plugins/marketplace.json"));
  await mkdir(join(root, "packages/old"), { recursive: true });
  const archive = execFileSync("git", ["archive", baseline, "plugins/vinea", ".agents/plugins/marketplace.json"], { cwd: repo, env: gitEnvironment() });
  execFileSync("tar", ["-xf", "-", "-C", join(root, "packages/old")], { input: archive });
  const sourceConfig = JSON.parse(execFileSync("python3", ["-c", 'import os,json,tomllib; p=os.path.join(os.environ.get("CODEX_HOME",os.path.expanduser("~/.codex")),"config.toml"); d=tomllib.load(open(p,"rb")); ks=["model","model_provider","model_providers","model_reasoning_effort","model_catalog_json","model_context_window","model_auto_compact_token_limit"]; print(json.dumps({k:d[k] for k in ks if k in d}))'], { encoding: "utf8" }));
  if (sourceConfig.model_catalog_json?.startsWith("~/")) sourceConfig.model_catalog_json = join(homedir(), sourceConfig.model_catalog_json.slice(2));
  const homes = {}, fixtures = {};
  for (const arm of ["old", "new", "control"]) {
    homes[arm] = await createHome(root, arm, sourceConfig);
    if (arm !== "control") {
      const env = environment(homes[arm]);
      await exec("codex", ["plugin", "marketplace", "add", join(root, "packages", arm), "--json"], { env });
      await exec("codex", ["plugin", "add", "vinea@vinea", "--json"], { env });
    }
    for (const kind of Object.keys(cases)) fixtures[`${arm}-${kind}`] = await fixture(root, `${arm}-${kind}`, kind);
  }
  fixtures["codex-acceptance"] = await fixture(root, "codex-acceptance", "tags");
  fixtures["claude-acceptance"] = await fixture(root, "claude-acceptance", "tags");
  fixtures["relay"] = await fixture(root, "relay", "tags");
  await git(fixtures.relay.cwd, "worktree", "add", "--detach", join(root, "fixtures/relay-peer"));
  const manifest = { root, createdAt: new Date().toISOString(), sourceHead: await git(repo, "rev-parse", "HEAD"), baseline,
    bundleSha256: hash(await readFile(join(root, "packages/new/plugins/vinea/bin/vinea.mjs"))),
    model: sourceConfig.model, reasoning: sourceConfig.model_reasoning_effort, homes, fixtures };
  await json(join(root, "manifest.json"), manifest);
  console.log(JSON.stringify({ root, model: manifest.model, reasoning: manifest.reasoning, bundleSha256: manifest.bundleSha256, fixtures: Object.keys(fixtures) }));
}

export async function prepareScoped(root) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const target = await fixture(root, "new-scoped-tags", "tags");
  const source = JSON.parse(execFileSync("python3", ["-c", 'import json,tomllib,sys; d=tomllib.load(open(sys.argv[1],"rb")); print(json.dumps({k:v for k,v in d.items() if k.startswith("model")}))', join(manifest.homes.new.codexHome, "config.toml")], { encoding: "utf8" }));
  const home = await createHome(root, "new-scoped", source);
  const config = Object.entries(source).map(([k,v]) => `${k} = ${inlineToml(v)}`).join("\n")
    + `\napproval_policy = "never"\ndefault_permissions = "vinea-local"\n[permissions.vinea-local]\nextends = ":workspace"\n[permissions.vinea-local.filesystem]\n${JSON.stringify(join(target.cwd,".git"))} = "read"\n${JSON.stringify(join(target.cwd,".git/vinea"))} = "write"\n`;
  await writeFile(join(home.codexHome,"config.toml"), config, { mode: 0o600 });
  home.permissionProfile = "vinea-local";
  const env = environment(home);
  await exec("codex", ["plugin","marketplace","add",join(root,"packages/new"),"--json"], {env});
  await exec("codex", ["plugin","add","vinea@vinea","--json"], {env});
  target.homeKey = "new-scoped";
  manifest.homes["new-scoped"] = home; manifest.fixtures["new-scoped-tags"] = target;
  await json(join(root,"manifest.json"), manifest);
  console.log(JSON.stringify({ fixture: target.cwd, permissionProfile: home.permissionProfile, unchangedDefaultInstallation: true }));
}

export async function tokenTelemetry(root, arm, threadId, before) {
  const manifest = JSON.parse(await readFile(join(root,"manifest.json"),"utf8"));
  let last = null;
  async function walk(directory) {
    for (const item of await readdir(directory,{withFileTypes:true})) {
      const path=join(directory,item.name);
      if(item.isDirectory()) await walk(path);
      else if(item.name.endsWith(".jsonl")&&item.name.includes(threadId)) {
        for(const line of (await readFile(path,"utf8")).split("\n")) {
          try { const e=JSON.parse(line); if(e.type==="event_msg"&&e.payload?.type==="token_count"&&e.payload.info?.total_token_usage
            && (!before || Date.parse(e.timestamp) <= Date.parse(before)))
            if(!last || e.timestamp >= last.timestamp) last={timestamp:e.timestamp,usage:e.payload.info.total_token_usage,source:"native-token-count-telemetry",threadId}; } catch {}
        }
      }
    }
  }
  await walk(join(manifest.homes[arm].codexHome,"sessions"));
  return last;
}

export async function exportReport(root, outputPath = join(root,"results/benchmark.json")) {
  const manifest=JSON.parse(await readFile(join(root,"manifest.json"),"utf8"));
  const trials=[];
  for(const name of (await readdir(join(root,"results"))).filter(n=>n.endsWith(".summary.json"))) {
    const summary=JSON.parse(await readFile(join(root,"results",name),"utf8"));
    if(summary.host!=="codex"||summary.phase!=="benchmark") continue;
    const fixture=manifest.fixtures[summary.name];
    const cutoff=new Date(Date.parse(summary.startedAt)+summary.elapsedMs).toISOString();
    let telemetry=null;
    if(!summary.usage) {
      const sidecar=join(root,"results",`${summary.recordId}.telemetry.json`);
      telemetry=await readFile(sidecar,"utf8").then(JSON.parse,()=>null);
      if(!telemetry || telemetry.cutoff !== cutoff) {
        const measured=await tokenTelemetry(root,fixture.homeKey||summary.arm,summary.threadId,cutoff);
        telemetry=measured?{...measured,cutoff}:null;
        if(telemetry) await json(sidecar,telemetry);
      }
    }
    const usage=summary.usage||telemetry?.usage;
    const row={name:summary.name,recordId:summary.recordId,threadId:summary.threadId,configuredModel:summary.model,
      reasoning:manifest.reasoning,fixtureBase:fixture.base,fixtureTree:await git(fixture.cwd,"rev-parse",`${fixture.base}^{tree}`),
      startedAt:summary.startedAt,cutoff,elapsedMs:summary.elapsedMs,
      timedOut:summary.timedOut,conversationCompleted:summary.resultStatus==="completed",businessAcceptance:summary.externalAcceptance,
      inputTokens:usage?.input_tokens??null,cachedInputTokens:usage?.cached_input_tokens??null,outputTokens:usage?.output_tokens??null,
      totalTokens:usage?usage.input_tokens+usage.output_tokens:null,tokenMeasurement:summary.usage?"completed-turn":"reported-before-cutoff-lower-bound",
      tokenTimestamp:telemetry?.timestamp??cutoff,toolCalls:summary.toolCalls,unchangedHead:summary.unchangedHead,
      unrelatedPreserved:summary.unrelatedPreserved,kernelDeliveriesBeforeCutoff:[]};
    const path=join(fixture.cwd,".git/vinea/tasks/state.json");
    if(await access(path).then(()=>true,()=>false)) {
      const state=JSON.parse(await readFile(path,"utf8"));
      row.kernelDeliveriesBeforeCutoff=Object.values(state.tasks).flatMap(t=>Object.values(t.deliveries)
        .filter(d=>Date.parse(d.createdAt)<=Date.parse(cutoff)).map(d=>({taskId:t.id,deliveryId:d.id,snapshotId:d.snapshotId,
          createdAt:d.createdAt,elapsedToRecordMs:Date.parse(d.createdAt)-Date.parse(summary.startedAt),acceptedGaps:d.acceptedGaps.length})));
    }
    trials.push(row);
  }
  trials.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  const report={version:1,generatedAt:new Date().toISOString(),baseline:manifest.baseline,bundleSha256:manifest.bundleSha256,
    configuredModel:manifest.model,reasoning:manifest.reasoning,trials,
    limitations:["One small implementation task, not repeated samples or a general efficiency result",
      "Cached input is included in total input and is not a billing estimate",
      "Timeout token counts are reported lower bounds from telemetry before cutoff",
      "Default-workspace and explicitly scoped-store runs are separate conditions",
      "Model conversation completion and durable task delivery are separate outcomes",
      "Light acceptance activity, caching and provider variation limit wall-time comparisons"]};
  await json(outputPath,report);
  console.log(JSON.stringify(report));
}

export async function cleanupHostHomes(root) {
  const canonical=await realpath(root);
  const manifest=JSON.parse(await readFile(join(canonical,"manifest.json"),"utf8"));
  if(manifest.root!==canonical || !canonical.split("/").at(-1).startsWith("vinea-host-acceptance-")) throw new Error("Not an owned acceptance root");
  const removed=[];
  for(const [name,home] of Object.entries(manifest.homes)) {
    const actual=await realpath(home.home).catch(()=>null);
    if(!actual) continue;
    if(!actual.startsWith(join(canonical,"homes")+"/")) throw new Error("Refusing cleanup outside fixture host homes");
    await rm(actual,{recursive:true,force:true}); removed.push(name);
  }
  console.log(JSON.stringify({removedTemporaryHostHomes:removed,fixturesAndReviewedResultsPreserved:true}));
}

export async function collectProcess(command, args, { cwd, env, prompt, timeoutMs }) {
  const started = Date.now(), events = []; let stderr = "", timedOut = false, pending = "";
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let escalation;
  const stop = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch {} } };
  const timer = setTimeout(() => { timedOut = true; stop("SIGTERM"); escalation = setTimeout(() => stop("SIGKILL"), 1500); }, timeoutMs);
  function consume(line) {
    try {
      const e = JSON.parse(line);
      if (e.item?.type === "reasoning") return;
      if (e.message?.content) e.message.content = e.message.content.filter(x => !["thinking", "redacted_thinking"].includes(x.type));
      events.push(e);
    } catch {}
  }
  child.stdout.on("data", b => { pending += b; const lines = pending.split("\n"); pending = lines.pop(); lines.forEach(consume); });
  child.stderr.on("data", b => { if (stderr.length < 8000) stderr += b; });
  child.stdin.end(prompt);
  let exitCode;
  try { exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  finally { clearTimeout(timer); clearTimeout(escalation); }
  if (pending.trim()) consume(pending);
  return { startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, exitCode, timedOut, events, stderr };
}
export async function run(root, name, host = "codex", promptOverride, resume) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const target = manifest.fixtures[name]; if (!target) throw new Error("Unknown fixture");
  const arm = name.startsWith("old-") ? "old" : name.startsWith("control-") ? "control" : "new";
  const prefix = arm === "control" ? "Complete this coding task directly." : arm === "old" ? "Use Vinea's installed vinea:propose entry and its workflow to complete this task." : "Use the installed vinea:run entry to complete this task.";
  const prompt = promptOverride || `${prefix}\n\n${cases[target.kind].request}\n\n${common}`;
  const plugin = join(root, "packages/new/plugins/vinea");
  let args, env;
  if (host === "codex") {
    const home = manifest.homes[target.homeKey || arm];
    env = environment(home);
    args = resume ? ["exec", "resume", resume, "--json", "-"] : home.permissionProfile
      ? ["exec", "--json", "--color", "never", "-"]
      : ["exec", "--json", "--color", "never", "--sandbox", "workspace-write", "--add-dir", root, "-"];
  } else {
    const settings = JSON.parse(await readFile(join(homedir(), ".claude/settings.json"), "utf8"));
    const sessionSettings = { disableAllHooks: true, enabledPlugins: Object.fromEntries(Object.keys(settings.enabledPlugins || {}).map(k => [k, false])) };
    env = { ...process.env, NODE_USE_ENV_PROXY: "0" };
    args = ["-p", "--output-format", "stream-json", "--verbose", "--setting-sources", "user", "--settings", JSON.stringify(sessionSettings),
      "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--tools", "Read,Edit,Write,Bash,Glob,Grep,Skill", "--permission-mode", "acceptEdits",
      "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Skill", "Bash(node *)", "Bash(git status*)", "Bash(git diff*)", "Bash(git rev-parse*)",
      "--plugin-dir", plugin];
    if (resume) args.push("--resume", resume);
  }
  const result = await collectProcess(host === "codex" ? "codex" : "claude", args, { cwd: target.cwd, env, prompt, timeoutMs: 300000 });
  const recordId = `${host}-${name}-${randomUUID()}`;
  const codexDone = result.events.findLast(e => e.type === "turn.completed"), claudeDone = result.events.findLast(e => e.type === "result");
  const texts = result.events.flatMap(e => e.type === "item.completed" && e.item?.type === "agent_message" ? [e.item.text]
    : e.type === "assistant" ? (e.message?.content || []).filter(x => x.type === "text").map(x => x.text) : []);
  const summary = { recordId, name, host, arm, startedAt: result.startedAt, elapsedMs: result.elapsedMs, exitCode: result.exitCode, timedOut: result.timedOut,
    threadId: result.events.find(e => e.type === "thread.started")?.thread_id ?? claudeDone?.session_id ?? result.events.find(e => e.type === "system")?.session_id,
    model: host === "codex" ? manifest.model : result.events.find(e => e.type === "system" && e.subtype === "init")?.model,
    usage: codexDone?.usage ?? claudeDone?.usage ?? null, modelUsage: claudeDone?.modelUsage ?? null,
    resultStatus: claudeDone?.subtype ?? (codexDone ? "completed" : "incomplete"),
    lastVisibleText: texts.at(-1) ?? claudeDone?.result ?? null,
    finalText: codexDone || claudeDone?.subtype === "success" ? texts.at(-1) ?? claudeDone?.result ?? null : null,
    phase: promptOverride ? "host-acceptance" : "benchmark",
    toolCalls: result.events.filter(e => e.type === "item.completed" && ["command_execution", "file_change", "mcp_tool_call"].includes(e.item?.type)).length
      + result.events.flatMap(e => e.type === "assistant" ? e.message?.content || [] : []).filter(e => e.type === "tool_use").length,
    gitStatus: await git(target.cwd, "status", "--short"), unchangedHead: (await git(target.cwd, "rev-parse", "HEAD")) === target.base };
  try {
    const grader = `import assert from 'node:assert/strict'; const target=${JSON.stringify(pathToFileURL(join(target.cwd, "src", cases[target.kind].file)).href)}; ${cases[target.kind].assertions}`;
    await exec(process.execPath, ["--input-type=module", "-e", grader], { cwd: target.cwd }); summary.externalAcceptance = "pass";
  } catch { summary.externalAcceptance = "fail"; }
  summary.observedCodeCheck = summary.externalAcceptance;
  if (promptOverride) summary.externalAcceptance = "scenario-specific-host-acceptance";
  summary.unrelatedPreserved = (await readFile(join(target.cwd, "unrelated.txt"), "utf8")) === "PRESERVE THIS FILE\n";
  summary.newStoreExists = await access(join(target.cwd, ".git/vinea/tasks/state.json")).then(() => true, () => false);
  summary.legacyStateExists = await access(join(target.cwd, ".vinea")).then(() => true, () => false);
  summary.permissionProfile = host === "codex" ? manifest.homes[target.homeKey || arm]?.permissionProfile ?? "legacy-workspace-write" : "claude-acceptEdits";
  if (summary.newStoreExists) {
    const state=JSON.parse(await readFile(join(target.cwd,".git/vinea/tasks/state.json"),"utf8"));
    summary.kernelTasks=Object.values(state.tasks).map(t=>({id:t.id,status:t.status,contractVersion:t.contracts.at(-1).version,
      deliveries:Object.values(t.deliveries).map(d=>({id:d.id,createdAt:d.createdAt,acceptedGaps:d.acceptedGaps.length})),userAcceptances:t.userAcceptances.length}));
  }
  if(host==="codex" && !summary.usage && summary.threadId) summary.partialUsage=await tokenTelemetry(root,target.homeKey||arm,summary.threadId);
  await json(join(root, "results", `${recordId}.events.json`), { prompt, ...result });
  await json(join(root, "results", `${recordId}.summary.json`), summary);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, root, name, host, promptFile, resume] = process.argv.slice(2);
  if (command === "prepare") await prepare();
  else if (command === "run") await run(root, name, host, promptFile ? await readFile(promptFile, "utf8") : undefined, resume);
  else if (command === "prepare-scoped") await prepareScoped(root);
  else if (command === "telemetry") console.log(JSON.stringify(await tokenTelemetry(root,name,host)));
  else if (command === "report") await exportReport(root,name);
  else if (command === "cleanup-host-homes") await cleanupHostHomes(root);
  else if (command) throw new Error("Use prepare, prepare-scoped ROOT, run ROOT NAME [HOST] [PROMPT_FILE] [SESSION_ID], telemetry ROOT HOME THREAD, report ROOT [OUTPUT], or cleanup-host-homes ROOT");
}
