import { writeFileSync } from "node:fs";
import path from "node:path";
import {
	DEFAULT_EXCLUDE,
	DEFAULT_RENAME,
	kaneoSchema,
	toPrismaFragment,
} from "../src/index";

const fragment = toPrismaFragment(kaneoSchema, {
	exclude: DEFAULT_EXCLUDE,
	rename: DEFAULT_RENAME,
});
writeFileSync(path.join(import.meta.dir, "..", "kaneo.prisma"), fragment);
console.log(`wrote kaneo.prisma (${fragment.split("\n").length} lines)`);
