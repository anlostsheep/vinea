import { test, expect, vi } from "vitest";
import { executeCommand } from "../../src/application.js";
import { makeRepoFixture, testMeta } from "../helpers/kernel-fixture.js";
import { discoverRepository, newActor } from "../../src/kernel/repository.js";
import * as io from "../../src/kernel/io.js";

test("host storage denial is actionable without exposing the raw filesystem error", async () => {
  const fixture=await makeRepoFixture(), context=await discoverRepository(fixture.root);
  const fail=vi.spyOn(io,"writeJson").mockRejectedValue(Object.assign(new Error("private raw error content"),{code:"EPERM"}));
  try {
    const result=await executeCommand(context,"init",{meta:testMeta(newActor("codex")),payload:{summary:"initialize fixture",reference:null}});
    expect(result.error?.code).toBe("STORAGE_PERMISSION_DENIED");
    expect(result.error?.details.storeRoot).toBe(context.storeRoot);
    expect(JSON.stringify(result)).not.toContain("private raw error content");
  } finally { fail.mockRestore(); }
});
