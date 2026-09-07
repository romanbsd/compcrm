import type { Db } from "./client";
import {
	DEFAULT_REPORTING_CURRENCY,
	isCurrencyCode,
	normalizeCurrency,
} from "./currency";
import type { Prisma } from "./generated/prisma/client";
import { currentOrganizationId } from "./tenant-context";

type SettingsDb = Pick<Db, "appSetting">;

export const DEFAULT_AGENT_MODEL = {
	id: "zai/glm-5.2-fast",
	contextWindowTokens: 1_000_000,
} as const;

export interface AgentModelSetting {
	id: string;
	contextWindowTokens: number;
	isDefault: boolean;
}

type AgentModelReader = {
	appSetting: {
		findUnique(args: {
			where: { organizationId: string };
			select: {
				agentModelId: true;
				agentModelContextWindow: true;
			};
		}): PromiseLike<{
			agentModelId: string | null;
			agentModelContextWindow: number | null;
		} | null>;
	};
};

export async function readAgentModel(
	db: AgentModelReader,
): Promise<AgentModelSetting> {
	const row = await db.appSetting.findUnique({
		where: { organizationId: currentOrganizationId() },
		select: { agentModelId: true, agentModelContextWindow: true },
	});

	if (!row?.agentModelId) {
		return { ...DEFAULT_AGENT_MODEL, isDefault: true };
	}

	return {
		id: row.agentModelId,
		contextWindowTokens:
			row.agentModelContextWindow ?? DEFAULT_AGENT_MODEL.contextWindowTokens,
		isDefault: false,
	};
}

export async function writeAgentModel(
	db: SettingsDb,
	model: { id: string; contextWindowTokens: number } | null,
): Promise<void> {
	await writeAppSetting(db, {
		agentModelId: model?.id ?? null,
		agentModelContextWindow: model?.contextWindowTokens ?? null,
	});
}

export const CONTEXT_DEV_SIGNUP_URL = "https://link.context.dev/crm";

export const CONTEXT_DEV_DISCOUNT_CODE = "CRM";

export async function readContextDevKey(
	db: SettingsDb,
): Promise<string | null> {
	const row = await db.appSetting.findUnique({
		where: { organizationId: currentOrganizationId() },
		select: { contextDevApiKey: true },
	});

	return row?.contextDevApiKey?.trim() || null;
}

export async function writeContextDevKey(
	db: SettingsDb,
	key: string,
): Promise<void> {
	await writeAppSetting(db, { contextDevApiKey: key.trim() });
}

export async function readReportingCurrency(db: SettingsDb): Promise<string> {
	const row = await db.appSetting.findUnique({
		where: { organizationId: currentOrganizationId() },
		select: { reportingCurrency: true },
	});

	const stored = normalizeCurrency(row?.reportingCurrency);

	return isCurrencyCode(stored) ? stored : DEFAULT_REPORTING_CURRENCY;
}

export async function writeReportingCurrency(
	db: SettingsDb,
	code: string,
): Promise<string> {
	const reportingCurrency = normalizeCurrency(code);

	await writeAppSetting(db, { reportingCurrency });

	return reportingCurrency;
}

export async function readRatesRefreshedAt(
	db: SettingsDb,
): Promise<Date | null> {
	const row = await db.appSetting.findUnique({
		where: { organizationId: currentOrganizationId() },
		select: { ratesRefreshedAt: true },
	});

	return row?.ratesRefreshedAt ?? null;
}

export async function writeRatesRefreshedAt(
	db: SettingsDb,
	ratesRefreshedAt: Date,
): Promise<void> {
	await writeAppSetting(db, { ratesRefreshedAt });
}

export const DEFAULT_ARCHIVE_RETENTION_DAYS = 180;

export const MIN_ARCHIVE_RETENTION_DAYS = 1;

export const MAX_ARCHIVE_RETENTION_DAYS = 3650;

export async function readArchiveRetentionDays(
	db: SettingsDb,
): Promise<number> {
	const organizationId = currentOrganizationId();
	const row = await db.appSetting.findUnique({
		where: { organizationId },
		select: { archiveRetentionDays: true },
	});

	return row?.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
}

export async function writeArchiveRetentionDays(
	db: SettingsDb,
	days: number,
): Promise<number> {
	const archiveRetentionDays = Math.min(
		Math.max(Math.round(days), MIN_ARCHIVE_RETENTION_DAYS),
		MAX_ARCHIVE_RETENTION_DAYS,
	);

	await writeAppSetting(db, { archiveRetentionDays });

	return archiveRetentionDays;
}

export function maskKey(key: string): string {
	const trimmed = key.trim();
	return trimmed.length > 4 ? `••••${trimmed.slice(-4)}` : "••••";
}

type AppSettingFields = Omit<
	Prisma.AppSettingUncheckedCreateInput,
	"organizationId"
>;

async function writeAppSetting(
	db: SettingsDb,
	fields: AppSettingFields,
): Promise<void> {
	const organizationId = currentOrganizationId();

	await db.appSetting.upsert({
		where: { organizationId },
		create: fields,
		update: fields,
	});
}
