export type ColumnType =
	| "text"
	| "boolean"
	| "integer"
	| "timestamp"
	| "jsonb"
	| "bytea";

export type RefAction = "cascade" | "set null" | "restrict";

export interface ColumnRef {
	table: string;
	columns: string[];
	onDelete?: RefAction;
	onUpdate?: RefAction;
}

export type ColumnDefault =
	| { kind: "literal"; value: string | number | boolean }
	| { kind: "now" }
	| { kind: "cuid" }
	| { kind: "client"; value: string | number | boolean };

export interface ColumnDef {
	key: string;
	name: string;
	type: ColumnType;
	withTimezone: boolean;
	notNull: boolean;
	primary: boolean;
	unique: string | null;
	default: ColumnDefault | null;
	onUpdateNow: boolean;
	ref: ColumnRef | null;
}

export interface IndexDef {
	name: string;
	columns: string[];
	kind: "index" | "unique" | "uniqueIndex";
	where?: string;
}

export interface ForeignKeyDef {
	name?: string;
	columns: string[];
	refTable: string;
	refColumns: string[];
	onDelete?: RefAction;
	onUpdate?: RefAction;
}

export interface TableDef {
	name: string;
	columns: ColumnDef[];
	indexes?: IndexDef[];
	foreignKeys?: ForeignKeyDef[];
}

export class ColumnBuilder {
	private readonly def: ColumnDef;

	constructor(key: string, name: string, type: ColumnType) {
		this.def = {
			key,
			name,
			type,
			withTimezone: false,
			notNull: false,
			primary: false,
			unique: null,
			default: null,
			onUpdateNow: false,
			ref: null,
		};
	}

	pk(): this {
		this.def.primary = true;
		return this;
	}

	notNull(): this {
		this.def.notNull = true;
		return this;
	}

	unique(name?: string): this {
		this.def.unique = name ?? "";
		return this;
	}

	default(value: string | number | boolean): this {
		this.def.default = { kind: "literal", value };
		return this;
	}

	defaultNow(): this {
		this.def.default = { kind: "now" };
		return this;
	}

	defaultCuid(): this {
		this.def.default = { kind: "cuid" };
		return this;
	}

	clientDefault(value: string | number | boolean): this {
		this.def.default = { kind: "client", value };
		return this;
	}

	onUpdateNow(): this {
		this.def.onUpdateNow = true;
		return this;
	}

	withTimezone(): this {
		this.def.withTimezone = true;
		return this;
	}

	ref(
		table: string,
		opts?: { columns?: string[]; onDelete?: RefAction; onUpdate?: RefAction },
	): this {
		this.def.ref = {
			table,
			columns: opts?.columns ?? ["id"],
			onDelete: opts?.onDelete,
			onUpdate: opts?.onUpdate,
		};
		return this;
	}

	toDef(): ColumnDef {
		return this.def;
	}
}

export const t = {
	text: (key: string, name: string) => new ColumnBuilder(key, name, "text"),
	boolean: (key: string, name: string) =>
		new ColumnBuilder(key, name, "boolean"),
	integer: (key: string, name: string) =>
		new ColumnBuilder(key, name, "integer"),
	timestamp: (key: string, name: string) =>
		new ColumnBuilder(key, name, "timestamp"),
	jsonb: (key: string, name: string) => new ColumnBuilder(key, name, "jsonb"),
	bytea: (key: string, name: string) => new ColumnBuilder(key, name, "bytea"),
};

export function table(
	name: string,
	columns: Record<string, ColumnBuilder>,
	opts?: { indexes?: IndexDef[]; foreignKeys?: ForeignKeyDef[] },
): TableDef {
	return {
		name,
		columns: Object.entries(columns).map(([key, builder]) => builder.toDef()),
		indexes: opts?.indexes,
		foreignKeys: opts?.foreignKeys,
	};
}

export function index(name: string, columns: string[]): IndexDef {
	return { name, columns, kind: "index" };
}

export function unique(name: string, columns: string[]): IndexDef {
	return { name, columns, kind: "unique" };
}

export function uniqueIndex(
	name: string,
	columns: string[],
	where?: string,
): IndexDef {
	return { name, columns, kind: "uniqueIndex", where };
}

export function foreignKey(def: {
	name?: string;
	columns: string[];
	refTable: string;
	refColumns: string[];
	onDelete?: RefAction;
	onUpdate?: RefAction;
}): ForeignKeyDef {
	return def;
}

export interface SchemaDef {
	tables: TableDef[];
}

export function defineSchema(tables: TableDef[]): SchemaDef {
	return { tables };
}

export function schemaTable(schema: SchemaDef, name: string): TableDef {
	const found = schema.tables.find((t) => t.name === name);
	if (!found) {
		throw new Error(`kaneo domain: no table named ${name}`);
	}
	return found;
}
