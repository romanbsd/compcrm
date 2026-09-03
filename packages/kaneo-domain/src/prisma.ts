import type {
	ColumnDef,
	ColumnRef,
	ForeignKeyDef,
	IndexDef,
	RefAction,
	SchemaDef,
	TableDef,
} from "./dsl";

export interface PrismaBindingOptions {
	exclude: string[];
	rename: Record<string, string>;
}

export const DEFAULT_EXCLUDE = [
	"user",
	"session",
	"account",
	"verification",
	"apikey",
];

export const DEFAULT_RENAME = {
	task: "ProjectTask",
	column: "ProjectColumn",
	comment: "TaskComment",
	activity: "TaskActivity",
	workspace_invitation: "WorkspaceInvitation",
} as const satisfies Record<string, string>;

const REF_ACTIONS = {
	cascade: "Cascade",
	"set null": "SetNull",
	restrict: "Restrict",
} as const satisfies Record<string, string>;

interface Edge {
	localColumns: string[];
	refColumns: string[];
	target: string;
	onDelete?: RefAction;
	onUpdate?: RefAction;
}

interface PrismaRelation {
	model: string;
	field: string;
	target: string;
	localKeys: string[];
	refKeys: string[];
	onDelete?: RefAction;
	onUpdate?: RefAction;
	named?: string;
	backField: string;
}

function pascalCase(name: string): string {
	return name
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

function camelCase(name: string): string {
	return name.charAt(0).toLowerCase() + name.slice(1);
}

function pluralize(name: string): string {
	if (/[^aeiou]y$/i.test(name)) {
		return `${name.slice(0, -1)}ies`;
	}
	return `${name}s`;
}

function prismaType(column: ColumnDef): string {
	switch (column.type) {
		case "text":
			return "String";
		case "boolean":
			return "Boolean";
		case "integer":
			return "Int";
		case "timestamp":
			return "DateTime";
		case "jsonb":
			return "Json";
		case "bytea":
			return "Bytes";
	}
}

function defaultAttribute(column: ColumnDef): string | null {
	const value = column.default;
	if (!value) {
		return null;
	}
	switch (value.kind) {
		case "cuid":
			return "@default(cuid())";
		case "now":
			return "@default(now())";
		case "literal":
			if (typeof value.value === "string") {
				return `@default("${value.value}")`;
			}
			return `@default(${value.value})`;
		case "client":
			return null;
	}
}

function scalarAttributes(column: ColumnDef): string {
	const parts: string[] = [];
	if (column.primary) {
		parts.push("@id");
	}
	if (column.unique !== null) {
		parts.push(
			column.unique === "" ? "@unique" : `@unique(map: "${column.unique}")`,
		);
	}
	const def = defaultAttribute(column);
	if (def) {
		parts.push(def);
	}
	if (column.onUpdateNow) {
		parts.push("@updatedAt");
	}
	return parts.join(" ");
}

function relationName(
	model: string,
	target: string,
	index: number,
): string | undefined {
	if (index === 0) {
		return undefined;
	}
	return `${model}To${target}_${index}`;
}

function relationFieldName(localKeys: string[], target: string): string {
	if (localKeys.length === 1) {
		const key = localKeys[0];
		if (key) {
			const stripped = key.replace(/Id$/, "");
			if (stripped) {
				return stripped;
			}
		}
	}
	return camelCase(target);
}

function keyMap(def: TableDef): Map<string, string> {
	return new Map(def.columns.map((c) => [c.name, c.key]));
}

function collectEdges(def: TableDef): Edge[] {
	const fromColumn = (column: ColumnDef, ref: ColumnRef): Edge => ({
		localColumns: [column.name],
		refColumns: ref.columns,
		target: ref.table,
		onDelete: ref.onDelete,
		onUpdate: ref.onUpdate,
	});
	const fromFk = (fk: ForeignKeyDef): Edge => ({
		localColumns: fk.columns,
		refColumns: fk.refColumns,
		target: fk.refTable,
		onDelete: fk.onDelete,
		onUpdate: fk.onUpdate,
	});
	const columnEdges = def.columns
		.filter((c) => c.ref)
		.map((c) => fromColumn(c, c.ref!));
	return [...columnEdges, ...(def.foreignKeys ?? []).map(fromFk)];
}

export function toPrismaFragment(
	schema: SchemaDef,
	options: PrismaBindingOptions,
): string {
	const tables = schema.tables.filter((t) => !options.exclude.includes(t.name));
	const modelName = (physical: string) =>
		options.rename[physical] ?? pascalCase(physical);
	const keyMaps = new Map(tables.map((t) => [t.name, keyMap(t)]));

	const relations: PrismaRelation[] = [];
	for (const def of tables) {
		const edges = collectEdges(def);
		const seen = new Map<string, number>();
		for (const edge of edges) {
			const pairKey = `${def.name}>${edge.target}`;
			const index = seen.get(pairKey) ?? 0;
			seen.set(pairKey, index + 1);
			const targetMap = keyMaps.get(edge.target);
			if (!targetMap) {
				continue;
			}
			const localMap = keyMaps.get(def.name)!;
			const localKeys = edge.localColumns.map((c) => localMap.get(c) ?? c);
			const refKeys = edge.refColumns.map((c) => targetMap.get(c) ?? c);
			const named = relationName(
				modelName(def.name),
				modelName(edge.target),
				index,
			);
			relations.push({
				model: modelName(def.name),
				field: relationFieldName(localKeys, modelName(edge.target)),
				target: modelName(edge.target),
				localKeys,
				refKeys,
				onDelete: edge.onDelete,
				onUpdate: edge.onUpdate,
				named,
				backField: pluralize(camelCase(modelName(def.name))),
			});
		}
	}

	const blocks: string[] = [];
	for (const def of tables) {
		const name = modelName(def.name);
		const modelRelations = relations.filter((r) => r.model === name);
		const backRelations = relations.filter((r) => r.target === name);
		const usedBackFields = new Set<string>();

		const lines: string[] = [];
		for (const column of def.columns) {
			const base = `${column.key} ${prismaType(column)}${column.notNull || column.primary ? "" : "?"}`;
			const columnMap =
				column.key === column.name ? "" : ` @map("${column.name}")`;
			const attrs = scalarAttributes(column);
			lines.push(`${base}${columnMap}${attrs ? ` ${attrs}` : ""}`);
		}

		for (const relation of modelRelations) {
			const optional = relation.localKeys.some((key) => {
				const column = def.columns.find((c) => c.key === key);
				return column ? !column.notNull && !column.primary : false;
			});
			lines.push(
				`${relation.field} ${relation.target}${optional ? "?" : ""} @relation(${relationArgs(relation)})`,
			);
		}

		for (const relation of backRelations) {
			let backField = relation.backField;
			let suffix = 2;
			while (usedBackFields.has(backField)) {
				backField = `${relation.backField}${suffix}`;
				suffix += 1;
			}
			usedBackFields.add(backField);
			const relName = relation.named ? `"${relation.named}"` : "";
			lines.push(
				`${backField} ${relation.model}[]${relName ? ` @relation(${relName})` : ""}`,
			);
		}

		for (const idx of def.indexes ?? []) {
			if (idx.kind === "unique") {
				lines.push(`@@unique([${idx.columns.join(", ")}], map: "${idx.name}")`);
			}
		}
		for (const idx of def.indexes ?? []) {
			if (idx.kind === "index") {
				lines.push(`@@index([${idx.columns.join(", ")}], map: "${idx.name}")`);
			}
		}

		blocks.push(
			`model ${name} {\n${lines.map((l) => `  ${l}`).join("\n")}\n  @@map("${def.name}")\n}`,
		);
	}

	return blocks.join("\n\n");

	function relationArgs(relation: PrismaRelation): string {
		const parts = [
			`fields: [${relation.localKeys.join(", ")}]`,
			`references: [${relation.refKeys.join(", ")}]`,
		];
		if (relation.named) {
			parts.unshift(`"${relation.named}"`);
		}
		if (relation.onDelete) {
			parts.push(`onDelete: ${REF_ACTIONS[relation.onDelete]}`);
		}
		if (relation.onUpdate) {
			parts.push(`onUpdate: ${REF_ACTIONS[relation.onUpdate]}`);
		}
		return parts.join(", ");
	}
}
