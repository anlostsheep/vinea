import { discoverRepository } from "../../src/kernel/repository.js";
import { mutateState } from "../../src/kernel/store.js";
import type { Meta } from "../../src/kernel/types.js";
const ctx = await discoverRepository(process.argv[2]!);
const meta = JSON.parse(process.argv[3]!) as Meta;
const result = await mutateState(ctx, meta, { worker: true }, () => ["observed"]);
console.log(JSON.stringify(result));
