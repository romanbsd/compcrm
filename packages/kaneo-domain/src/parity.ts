import { Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

const tableNameSymbol = (Table as unknown as { Symbol: { Name: symbol } })
	.Symbol.Name;

function sqlText(chunk: unknown, out: string[]): void {
	if (Array.isArray(chunk)) {
		if (typeof chunk[0] === "string") {
			out.push(chunk[0]);
		} else {
			for (const inner of chunk) {
				sqlText(inner, out);
			}
		}
		return;
	}
	if (chunk !== null && typeof chunk === "object") {
		const obj = chunk as Record<string, unknown>;
		if (Array.isArray(obj.queryChunks)) {
			for (const inner of obj.queryChunks as unknown[]) {
				sqlText(inner, out);
			}
			return;
		}
		if (Array.isArray(obj.value)) {
			for (const inner of obj.value as unknown[]) {
				sqlText(inner, out);
			}
			return;
		}
		if (
			typeof obj.getSQL === "function" &&
			typeof obj.name === "string" &&
			obj.table
		) {
			out.push(obj.name as string);
			return;
		}
		if (typeof obj.isTable === "boolean" && obj.isTable) {
			out.push(obj.name as string);
			return;
		}
		out.push(String(obj.name ?? chunk));
		return;
	}
	out.push(String(chunk));
}

function normalizeSql(sql: unknown): string {
	const out: string[] = [];
	sqlText(sql, out);
	return out.join("").replaceAll('"', "").replace(/\s+/g, " ").trim();
}

function tableName(table: unknown): string {
	if (table === null || typeof table !== "object") {
		return String(table);
	}
	const t = table as Record<PropertyKey, unknown>;
	const name = t[tableNameSymbol];
	if (typeof name === "string") {
		return name;
	}
	const config = t.config as { name?: string } | undefined;
	if (config?.name) {
		return config.name;
	}
	return String(t.name);
}

function tokenizeDefault(column: {
	defaultFn?: unknown;
	default?: unknown;
}): string {
	if (column.defaultFn) {
		const src = String(column.defaultFn)
			.replaceAll("!1", "false")
			.replaceAll("!0", "true");
		if (src.includes("createId")) {
			return "cuid";
		}
		return `fn:${src.slice(0, 60)}`;
	}
	if (column.default === undefined || column.default === null) {
		return "-";
	}
	if (typeof column.default === "object") {
		return `sql:${normalizeSql(column.default)}`;
	}
	return `lit:${String(column.default)}`;
}

interface DrizzleColumn {
	name: string;
	notNull: boolean;
	primary: boolean;
	isUnique: boolean;
	uniqueName?: string;
	default?: unknown;
	defaultFn?: unknown;
	onUpdateFn?: unknown;
	getSQLType(): string;
}

export function renderTable(table: unknown): string {
	const cfg = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
	const lines: string[] = [];
	lines.push(`TABLE ${cfg.name}`);
	for (const col of cfg.columns as DrizzleColumn[]) {
		const uniqueName = col.isUnique ? (col.uniqueName ?? "auto") : "-";
		lines.push(
			`COL ${col.name} type=${col.getSQLType()} nn=${col.notNull} pk=${col.primary} uq=${uniqueName} def=${tokenizeDefault(col)} upd=${col.onUpdateFn ? 1 : 0}`,
		);
	}
	for (const idx of cfg.indexes ?? []) {
		const c = (
			idx as unknown as {
				config: {
					name: string;
					unique: boolean;
					columns: { name: string }[];
					where?: unknown;
				};
			}
		).config;
		const where = c.where ? normalizeSql(c.where) : "-";
		lines.push(
			`IDX ${c.name} unique=${c.unique} cols=[${c.columns.map((x) => x.name).join(",")}] where=${where}`,
		);
	}
	for (const uc of cfg.uniqueConstraints ?? []) {
		const columns = (uc.columns as unknown[]).map(
			(c) => (c as { name?: string }).name ?? String(c),
		);
		lines.push(`UC ${uc.name} cols=[${columns.join(",")}]`);
	}
	for (const fk of cfg.foreignKeys ?? []) {
		const ref = fk.reference() as {
			name?: string;
			columns: DrizzleColumn[];
			foreignTable: unknown;
			foreignColumns: DrizzleColumn[];
		};
		const local = ref.columns.map((c) => c.name).join(",");
		const foreign = ref.foreignColumns.map((c) => c.name).join(",");
		lines.push(
			`FK ${ref.name ?? "-"} local=[${local}] -> ${tableName(ref.foreignTable)}(${foreign}) del=${fk.onDelete ?? "-"} upd=${fk.onUpdate ?? "-"}`,
		);
	}
	return lines.join("\n");
}
