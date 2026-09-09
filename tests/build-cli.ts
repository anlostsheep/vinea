import { execFile } from "node:child_process";
import { promisify } from "node:util";

export default async function setup() {
  await promisify(execFile)(process.execPath, ["scripts/build.mjs"], { cwd: process.cwd() });
}
