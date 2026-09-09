import { test, expect } from "vitest";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { makeRepoFixture } from "../helpers/kernel-fixture.js";
import { mkdir, writeFile, readFile, symlink, access } from "node:fs/promises";

const { collectProcess, tokenTelemetry, cleanupHostHomes } = await import(pathToFileURL(join(process.cwd(),"scripts/host-acceptance.mjs")).href);

test("host harness retains visible events but excludes structured reasoning", async () => {
  const f=await makeRepoFixture();
  const output=[{type:"item.completed",item:{type:"reasoning",text:"do-not-store"}},
    {type:"item.completed",item:{type:"agent_message",text:"visible result"}},
    {type:"turn.completed",usage:{input_tokens:10,output_tokens:2}}];
  const result=await collectProcess(process.execPath,["-e",`for(const e of ${JSON.stringify(output)})console.log(JSON.stringify(e))`],
    {cwd:f.root,env:process.env,prompt:"",timeoutMs:1000});
  expect(result.exitCode).toBe(0); expect(result.events).toHaveLength(2);
  expect(JSON.stringify(result.events)).not.toContain("do-not-store");
});

test("host harness times out its own process even when SIGTERM is ignored", async () => {
  const f=await makeRepoFixture();
  const result=await collectProcess(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    {cwd:f.root,env:process.env,prompt:"",timeoutMs:200});
  expect(result.timedOut).toBe(true); expect(result.elapsedMs).toBeLessThan(4000);
});

test("censored telemetry excludes later resumed-turn counters", async () => {
  const f=await makeRepoFixture(), home=join(f.directory,"host"), sessions=join(home,"sessions");
  await mkdir(sessions,{recursive:true});
  await writeFile(join(f.directory,"manifest.json"),JSON.stringify({homes:{test:{codexHome:home}}}));
  const event=(timestamp:string,input:number)=>({timestamp,type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{input_tokens:input,output_tokens:10}}}});
  await writeFile(join(sessions,"rollout-session-1.jsonl"),[
    event("2026-09-08T10:00:00.000Z",100), event("2026-09-08T10:02:00.000Z",300),
  ].map(value=>JSON.stringify(value)).join("\n"));
  const before=await tokenTelemetry(f.directory,"test","session-1","2026-09-08T10:01:00.000Z");
  expect(before.usage.input_tokens).toBe(100);
  expect((await tokenTelemetry(f.directory,"test","session-1")).usage.input_tokens).toBe(300);
});

test("fixture host cleanup unlinks auth references without deleting their target", async () => {
  const f=await makeRepoFixture(), root=join(f.directory,"vinea-host-acceptance-owned"), home=join(root,"homes/test"), auth=join(f.directory,"auth-target");
  await mkdir(join(home,".codex"),{recursive:true});
  await writeFile(auth,"fixture-credential");
  await symlink(auth,join(home,".codex/auth.json"));
  await writeFile(join(root,"manifest.json"),JSON.stringify({root,homes:{test:{home}}}));
  await cleanupHostHomes(root);
  expect(await readFile(auth,"utf8")).toBe("fixture-credential");
  await expect(access(home)).rejects.toMatchObject({code:"ENOENT"});
});

test("fixture host cleanup refuses a manifest pointing outside owned homes", async () => {
  const f=await makeRepoFixture(), root=join(f.directory,"vinea-host-acceptance-owned");
  await mkdir(root);
  await writeFile(join(root,"manifest.json"),JSON.stringify({root,homes:{test:{home:f.root}}}));
  await expect(cleanupHostHomes(root)).rejects.toThrow("outside fixture host homes");
  await expect(access(f.root)).resolves.toBeUndefined();
});
