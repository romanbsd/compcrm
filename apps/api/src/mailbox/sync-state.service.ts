import {
	GoogleSyncStatus,
	type MailboxSyncModel as MailboxSync,
	type Prisma,
} from "@crm/db";
import { currentOrganizationId } from "@crm/db/tenant-context";
import type { ScopedDb } from "@crm/db/tenant-scope";
import { Injectable, Logger } from "@nestjs/common";
import { InjectScopedDatabase } from "../database/database.constants";
import type { SyncSource } from "./mailbox.constants";

export const SYNC_LEASE_MS = 300_000;

@Injectable()
export class SyncStateService {
	private readonly logger = new Logger(SyncStateService.name);

	constructor(@InjectScopedDatabase() private readonly db: ScopedDb) {}

	async get(userId: string, source: SyncSource): Promise<MailboxSync | null> {
		return this.db.mailboxSync.findUnique({
			where: {
				organizationId_userId_source: {
					organizationId: currentOrganizationId(),
					userId,
					source,
				},
			},
		});
	}

	async listForUser(
		userId: string,
		sources?: readonly SyncSource[],
	): Promise<MailboxSync[]> {
		const where: Prisma.MailboxSyncWhereInput = { userId };
		if (sources) where.source = { in: [...sources] };

		return this.db.mailboxSync.findMany({ where });
	}

	async due(now: Date): Promise<MailboxSync[]> {
		return this.db.mailboxSync.findMany({
			where: dueWhere(now),
			orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
		});
	}

	async claim(row: MailboxSync, now: Date): Promise<boolean> {
		const { count } = await this.db.mailboxSync.updateMany({
			where: { id: row.id, updatedAt: row.updatedAt, ...dueWhere(now) },
			data: {
				status: GoogleSyncStatus.RUNNING,
				retryAfter: new Date(now.getTime() + SYNC_LEASE_MS),
			},
		});

		return count === 1;
	}

	async release(id: string): Promise<void> {
		await this.db.mailboxSync.updateMany({
			where: { id },
			data: { retryAfter: null },
		});
	}

	async ensure(
		userId: string,
		source: SyncSource,
		options: { autoCreate: boolean },
	): Promise<MailboxSync> {
		return this.db.mailboxSync.upsert({
			where: {
				organizationId_userId_source: {
					organizationId: currentOrganizationId(),
					userId,
					source,
				},
			},
			create: {
				userId,
				source,
				status: GoogleSyncStatus.IDLE,
				autoCreate: options.autoCreate,
			},
			update: {
				status: GoogleSyncStatus.IDLE,
				lastError: null,
				retryAfter: null,
			},
		});
	}

	async markRunning(id: string): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: { status: GoogleSyncStatus.RUNNING, lastError: null },
		});
	}

	async settle(
		id: string,
		update: {
			cursor?: string | null;
			status: GoogleSyncStatus;
		},
	): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: {
				...update,
				lastSyncedAt: new Date(),
				lastError: null,
				retryAfter: null,
			},
		});
	}

	async clearCursor(id: string, reason: string): Promise<void> {
		this.logger.warn({
			message: "Sync cursor invalidated — resuming from now",
			syncId: id,
			reason,
		});

		await this.db.mailboxSync.update({
			where: { id },
			data: {
				cursor: null,
				status: GoogleSyncStatus.IDLE,
				lastError: null,
				retryAfter: null,
			},
		});
	}

	async markNeedsReconnect(id: string, reason: string): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: {
				status: GoogleSyncStatus.NEEDS_RECONNECT,
				lastError: reason,
				retryAfter: null,
			},
		});
	}

	async markRateLimited(id: string, retryAfterMs: number): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: {
				status: GoogleSyncStatus.IDLE,
				retryAfter: new Date(Date.now() + retryAfterMs),
			},
		});
	}

	async markFailed(id: string, reason: string): Promise<void> {
		await this.db.mailboxSync.update({
			where: { id },
			data: {
				status: GoogleSyncStatus.FAILED,
				lastError: reason,
				retryAfter: null,
			},
		});
	}

	async setAutoCreate(
		userId: string,
		source: SyncSource,
		enabled: boolean,
	): Promise<void> {
		await this.db.mailboxSync.updateMany({
			where: { userId, source },
			data: { autoCreate: enabled },
		});
	}

	async remove(userId: string, source?: SyncSource): Promise<void> {
		const where: Prisma.MailboxSyncWhereInput = { userId };
		if (source) where.source = source;

		await this.db.mailboxSync.deleteMany({ where });
	}
}

function dueWhere(now: Date) {
	return {
		status: { notIn: [GoogleSyncStatus.NEEDS_RECONNECT] },
		OR: [{ retryAfter: null }, { retryAfter: { lte: now } }],
	};
}
