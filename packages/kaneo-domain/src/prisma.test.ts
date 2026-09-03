import { describe, expect, it } from "bun:test";
import { kaneoSchema } from "./kaneo";
import { DEFAULT_EXCLUDE, DEFAULT_RENAME, toPrismaFragment } from "./prisma";

const fragment = toPrismaFragment(kaneoSchema, {
	exclude: DEFAULT_EXCLUDE,
	rename: DEFAULT_RENAME,
});

describe("kaneo prisma fragment", () => {
	it("emits every non-excluded kaneo table", () => {
		const kept = kaneoSchema.tables.filter(
			(t) => !DEFAULT_EXCLUDE.includes(t.name),
		);
		for (const def of kept) {
			expect(fragment).toContain(`@@map("${def.name}")`);
		}
		expect(fragment.match(/^model /gm)).toHaveLength(kept.length);
	});

	it("skips the excluded tables", () => {
		for (const table of DEFAULT_EXCLUDE) {
			expect(fragment).not.toContain(`@@map("${table}")`);
		}
	});

	it("renames the collisions", () => {
		expect(fragment).toContain("model ProjectTask");
		expect(fragment).toContain("model ProjectColumn");
		expect(fragment).toContain("model TaskActivity");
		expect(fragment).toContain("model TaskComment");
	});

	it("never combines a scalar and a relation on one line", () => {
		for (const line of fragment.split("\n")) {
			expect(line).not.toMatch(
				/^ {2}\w+ (String|Int|Boolean|DateTime|Json|Bytes)\?* \w+ [A-Z]\w* @relation/,
			);
		}
	});

	it("maps columns to kaneo's snake_case physical names", () => {
		expect(fragment).toContain('@map("project_id")');
		expect(fragment).toContain('@map("created_at")');
		expect(fragment).toContain('@map("joined_at")');
	});
});
