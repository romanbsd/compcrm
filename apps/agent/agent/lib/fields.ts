import type { Prisma } from "@crm/db";
import type { FieldEntity, FieldType } from "@crm/db/enums";
import {
	attachValues,
	type FieldDefinitionWithOptions,
	FieldValueError,
	fieldKeyFromLabel,
	type RecordField,
	readValue,
	recordColumn,
	type SerializedField,
	serializeField,
	usesOptions,
	writeValues,
} from "@crm/db/fields";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import { scopedTransaction } from "@crm/db/tenant-scope";
import { currentFocus } from "./focus";

const WITH_OPTIONS = { options: { orderBy: { position: "asc" } } } as const;

export type { FieldEntity, FieldType, RecordField, SerializedField };

async function definitionsFor(
	tx: Prisma.TransactionClient,
	entity: FieldEntity,
): Promise<FieldDefinitionWithOptions[]> {
	return tx.fieldDefinition.findMany({
		where: { entity, archivedAt: null },
		include: WITH_OPTIONS,
		orderBy: { position: "asc" },
	});
}

export async function listFields(
	entity: FieldEntity,
): Promise<SerializedField[]> {
	return scopedTransaction(async (tx) => {
		const definitions = await definitionsFor(tx, entity);
		return definitions.map(serializeField);
	});
}

export async function readFields(
	entity: FieldEntity,
	recordId: string,
): Promise<RecordField[]> {
	return scopedTransaction(async (tx) => {
		const column = recordColumn(entity);
		const [definitions, rows] = await Promise.all([
			definitionsFor(tx, entity),
			tx.fieldValue.findMany({
				where: { [column]: recordId },
			}),
		]);

		return attachValues(definitions, rows);
	});
}

export type WriteResult =
	| { written: true; key: string; value: unknown }
	| { written: false; reason: string };

export async function writeField(input: {
	entity: FieldEntity;
	recordId: string;
	key: string;
	value: unknown;
}): Promise<WriteResult> {
	try {
		return await scopedTransaction(async (tx) => {
			const definitions = await definitionsFor(tx, input.entity);
			const definition = definitions.find((entry) => entry.key === input.key);

			if (!definition) {
				return {
					written: false,
					reason: `There is no field called "${input.key}" on ${input.entity.toLowerCase()}s. Call list_fields to see what exists.`,
				};
			}

			if (!definition.agentFilled) {
				return {
					written: false,
					reason: `"${input.key}" is marked manual only, so a rep keeps it by hand.`,
				};
			}

			if (!(await recordExists(tx, input.entity, input.recordId))) {
				return {
					written: false,
					reason: `There is no ${input.entity.toLowerCase()} with id "${input.recordId}".`,
				};
			}

			const isBackfill = currentFocus().taskKind === "field-backfill";

			if (isBackfill) {
				const column = recordColumn(input.entity);
				await lockIdempotencyKey(
					tx,
					`field-value:${definition.id}:${input.recordId}`,
				);

				const row = await tx.fieldValue.findFirst({
					where: { fieldId: definition.id, [column]: input.recordId },
				});

				if (readValue(definition, row ?? undefined) !== null) {
					return {
						written: false,
						reason: `"${input.key}" already has a value on this record. Someone filled it since this task was queued — leave it as is.`,
					};
				}
			}

			await writeValues(tx, input.entity, input.recordId, definitions, {
				[input.key]: input.value,
			});

			return { written: true, key: input.key, value: input.value };
		});
	} catch (error) {
		if (error instanceof FieldValueError) {
			return { written: false, reason: error.message };
		}

		throw error;
	}
}

export async function createField(input: {
	entity: FieldEntity;
	label: string;
	type: FieldType;
	options?: string[];
	agentBrief?: string;
}): Promise<SerializedField | { created: false; reason: string }> {
	const key = fieldKeyFromLabel(input.label);

	if (!key) {
		return { created: false, reason: "That label does not make a usable key." };
	}

	if (usesOptions(input.type) && (input.options ?? []).length === 0) {
		return { created: false, reason: "A select needs at least one option." };
	}

	return scopedTransaction(async (tx) => {
		const taken = await tx.fieldDefinition.findFirst({
			where: { entity: input.entity, key },
			select: { id: true },
		});

		if (taken) {
			return {
				created: false,
				reason: `There is already a field called "${key}" on ${input.entity.toLowerCase()}s.`,
			};
		}

		const last = await tx.fieldDefinition.findFirst({
			where: { entity: input.entity },
			orderBy: { position: "desc" },
			select: { position: true },
		});

		const definition = await tx.fieldDefinition.create({
			data: {
				entity: input.entity,
				key,
				label: input.label,
				type: input.type,
				agentBrief: input.agentBrief ?? null,
				position: (last?.position ?? -1) + 1,
				options: usesOptions(input.type)
					? {
							create: (input.options ?? []).map((label, index) => ({
								label,
								position: index,
							})),
						}
					: undefined,
			},
			include: WITH_OPTIONS,
		});

		return serializeField(definition);
	});
}

export async function updateFieldBrief(input: {
	entity: FieldEntity;
	key: string;
	agentBrief: string | null;
	agentFilled?: boolean;
}): Promise<SerializedField | { updated: false; reason: string }> {
	return scopedTransaction(async (tx) => {
		const existing = await tx.fieldDefinition.findFirst({
			where: { entity: input.entity, key: input.key },
			select: { id: true },
		});

		if (!existing) {
			return {
				updated: false,
				reason: `There is no field called "${input.key}".`,
			};
		}

		const definition = await tx.fieldDefinition.update({
			where: { id: existing.id },
			data: { agentBrief: input.agentBrief, agentFilled: input.agentFilled },
			include: WITH_OPTIONS,
		});

		return serializeField(definition);
	});
}

export async function archiveField(input: {
	entity: FieldEntity;
	key: string;
}): Promise<{ archived: boolean; reason?: string }> {
	return scopedTransaction(async (tx) => {
		const existing = await tx.fieldDefinition.findFirst({
			where: { entity: input.entity, key: input.key },
			select: { id: true },
		});

		if (!existing) {
			return {
				archived: false,
				reason: `There is no field called "${input.key}".`,
			};
		}

		await tx.fieldDefinition.update({
			where: { id: existing.id },
			data: { archivedAt: new Date() },
		});

		return { archived: true };
	});
}

async function recordExists(
	tx: Prisma.TransactionClient,
	entity: FieldEntity,
	recordId: string,
): Promise<boolean> {
	switch (entity) {
		case "COMPANY":
			return Boolean(
				await tx.company.findFirst({
					where: { id: recordId },
					select: { id: true },
				}),
			);
		case "CONTACT":
			return Boolean(
				await tx.contact.findFirst({
					where: { id: recordId },
					select: { id: true },
				}),
			);
		case "DEAL":
			return Boolean(
				await tx.deal.findFirst({
					where: { id: recordId },
					select: { id: true },
				}),
			);
	}
}
