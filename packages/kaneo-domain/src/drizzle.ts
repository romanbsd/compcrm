import { createId } from "@paralleldrive/cuid2";
import { sql, Table } from "drizzle-orm";
import {
	boolean,
	customType,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
	ColumnDef,
	ColumnRef,
	ForeignKeyDef,
	IndexDef,
	SchemaDef,
	TableDef,
} from "./dsl";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
	dataType() {
		return "bytea";
	},
});

type PgTable = ReturnType<typeof pgTable>;
type Column = ReturnType<typeof text>;

const tableNameSymbol = (
	Table as unknown as { Symbol: { Name: symbol; Columns: symbol } }
).Symbol;

export interface DrizzleSchema {
	tables: Record<string, PgTable>;
	columns: Record<string, Record<string, Column>>;
}

function buildColumn(
	def: ColumnDef,
	resolveRef: (ref: ColumnRef) => Column,
): any {
	let col: any;
	switch (def.type) {
		case "text":
			col = text(def.name);
			break;
		case "boolean":
			col = boolean(def.name);
			break;
		case "integer":
			col = integer(def.name);
			break;
		case "timestamp":
			col = timestamp(def.name, {
				mode: "date",
				withTimezone: def.withTimezone,
			});
			break;
		case "jsonb":
			col = jsonb(def.name);
			break;
		case "bytea":
			col = bytea(def.name);
			break;
	}

	if (def.primary) {
		col = col.primaryKey();
	}
	if (def.notNull) {
		col = col.notNull();
	}
	if (def.unique !== null) {
		col = def.unique === "" ? col.unique() : col.unique(def.unique);
	}
	const defaultValue = def.default;
	if (defaultValue) {
		switch (defaultValue.kind) {
			case "literal":
				col = col.default(defaultValue.value);
				break;
			case "now":
				col = col.defaultNow();
				break;
			case "cuid":
				col = col.$defaultFn(() => createId());
				break;
			case "client":
				col =
					defaultValue.value === false
						? col.$defaultFn(() => false)
						: defaultValue.value === true
							? col.$defaultFn(() => true)
							: col.$defaultFn(() => defaultValue.value);
				break;
		}
	}
	if (def.onUpdateNow) {
		col = col.$onUpdate(() => new Date());
	}
	const ref = def.ref;
	if (ref) {
		col = col.references(() => resolveRef(ref), {
			onDelete: ref.onDelete,
			onUpdate: ref.onUpdate,
		});
	}
	return col;
}

function buildIndexes(def: TableDef, t: Record<string, any>) {
	const build = (idx: IndexDef) => {
		const cols = idx.columns.map((c) => t[c]) as [any, ...any[]];
		switch (idx.kind) {
			case "unique":
				return unique(idx.name).on(...cols);
			case "uniqueIndex":
				return idx.where
					? uniqueIndex(idx.name)
							.on(...cols)
							.where(sql.raw(idx.where))
					: uniqueIndex(idx.name).on(...cols);
			case "index":
				return index(idx.name).on(...cols);
		}
	};
	return (def.indexes ?? []).map(build);
}

function buildForeignKeys(
	def: TableDef,
	t: Record<string, any>,
	resolveTargetColumn: (table: string, column: string) => Column,
) {
	const build = (fk: ForeignKeyDef) => {
		const localColumns: any = fk.columns.map((c) => t[c]);
		const foreignColumns: any = fk.refColumns.map((c) =>
			resolveTargetColumn(fk.refTable, c),
		);
		const fkBuilder = foreignKey({ columns: localColumns, foreignColumns });
		if (fk.onDelete) {
			fkBuilder.onDelete(fk.onDelete);
		}
		if (fk.onUpdate) {
			fkBuilder.onUpdate(fk.onUpdate);
		}
		return fkBuilder;
	};
	return (def.foreignKeys ?? []).map(build);
}

export function toDrizzleSchema(schema: SchemaDef): DrizzleSchema {
	const built: Record<string, PgTable> = {};
	const columns: Record<string, Record<string, Column>> = {};

	const resolveRef = (ref: ColumnRef): Column => {
		const tableColumns = columns[ref.table];
		if (!tableColumns) {
			throw new Error(
				`kaneo domain: ref target table ${ref.table} is not built`,
			);
		}
		const refColumn = ref.columns[0];
		if (!refColumn) {
			throw new Error(
				`kaneo domain: ref target column ${ref.table} has no columns`,
			);
		}
		const col = tableColumns[refColumn];
		if (!col) {
			throw new Error(
				`kaneo domain: ref target column ${ref.table}.${refColumn} is not built`,
			);
		}
		return col;
	};

	const attachedColumns = (table: unknown) =>
		(table as Record<PropertyKey, unknown>)[tableNameSymbol.Columns] as
			| Record<string, Column>
			| undefined;

	for (const def of schema.tables) {
		const columnBuilders: Record<string, Column> = {};
		for (const column of def.columns) {
			columnBuilders[column.key] = buildColumn(column, resolveRef);
		}
		const table = pgTable(def.name, columnBuilders, (t) => [
			...buildIndexes(def, t),
			...buildForeignKeys(def, t, (tableName, columnName) => {
				const targetColumns = columns[tableName];
				const column = targetColumns?.[columnName];
				if (!column) {
					throw new Error(
						`kaneo domain: fk target column ${tableName}.${columnName} is not built`,
					);
				}
				return column;
			}),
		]);
		built[def.name] = table;
		const tableColumnsMap: Record<string, Column> = {};
		columns[def.name] = tableColumnsMap;
		for (const column of Object.values(attachedColumns(table) ?? {})) {
			const loose = column as unknown as {
				config?: { name?: string };
				name?: string;
			};
			const physical = loose.config?.name ?? loose.name ?? "";
			tableColumnsMap[physical] = column;
		}
	}

	return { tables: built, columns };
}
