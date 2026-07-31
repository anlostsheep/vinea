const { realpathSync, writeFileSync } = require("node:fs");
const fsPromises = require("node:fs/promises");
const { syncBuiltinESMExports } = require("node:module");

const originalMkdir = fsPromises.mkdir;
const marker = process.env.VINEA_TEST_TASK_LOCK_CONTENDED_MARKER;
const taskLockDirectory = process.env.VINEA_TEST_TASK_LOCK_DIRECTORY;
const resolvedTaskLockDirectory = taskLockDirectory ? realpathSync(taskLockDirectory) : undefined;

fsPromises.mkdir = async function observedMkdir(path, ...args) {
  try {
    return await originalMkdir.call(this, path, ...args);
  } catch (error) {
    if (
      error?.code === "EEXIST"
      && marker
      && resolvedTaskLockDirectory !== undefined
      && realpathSync(path) === resolvedTaskLockDirectory
    ) {
      writeFileSync(marker, "contended\n", { flag: "w" });
    }
    throw error;
  }
};

syncBuiltinESMExports();
