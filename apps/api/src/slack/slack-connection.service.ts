import { canManageConnections, isSlackConfigured } from "@crm/auth";
import type { Db, Prisma } from "@crm/db";
import { currentOrganizationId } from "@crm/db/tenant-context";
import { type ScopedDb, scopedTransaction } from "@crm/db/tenant-scope";
import { schemas } from "@crm/validation";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { AgentAccessService } from "../agent/agent-access.service";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import {
	InjectDatabase,
	InjectScopedDatabase,
} from "../database/database.constants";
import type {
	SlackChannelsInput,
	SlackChannelsResult,
	SlackCreateChannelInput,
	SlackCreateChannelResult,
	SlackDisconnectResult,
	SlackJoinChannelInput,
	SlackJoinChannelResult,
	SlackMatches,
	SlackRefreshPeopleResult,
	SlackStatus,
} from "./slack.contracts";
import { SlackChannelsService } from "./slack-channels.service";
import { SLACK, type SlackSyncState } from "./slack-config";

const SLACK_WORKSPACE_RESOURCE_ID =
	schemas.agents.CAPABILITY_RESOURCE_IDS.slack;

@Injectable()
export class SlackConnectionService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		@InjectScopedDatabase() private readonly scoped: ScopedDb,
		private readonly agent: AgentTriggerService,
		private readonly slackChannels: SlackChannelsService,
		private readonly access: AgentAccessService,
	) {}

	async status(userId: string): Promise<SlackStatus> {
		const role = await this.access.assertMember(userId);
		const [grant, agents, matches, memberCount] = await Promise.all([
			this.scoped.slackWorkspaceGrant.findFirst({
				select: {
					id: true,
					teamName: true,
					botToken: true,
					botScopes: true,
					userToken: true,
					updatedAt: true,
				},
			}),
			this.scoped.agentDefinition.findMany({
				where: {
					status: { in: ["LIVE", "PAUSED"] },
					deletedAt: null,
					currentVersionId: { not: null },
					currentVersion: {
						manifest: {
							path: ["dataScope", "resources"],
							array_contains: [{ id: SLACK_WORKSPACE_RESOURCE_ID }],
						},
					},
				},
				orderBy: { updatedAt: "desc" },
				take: 30,
				select: { id: true, name: true, description: true, status: true },
			}),
			this.scoped.slackMemberMatch.findMany({
				where: {
					crmUser: {
						members: { some: { organizationId: currentOrganizationId() } },
					},
				},
				select: { slackUserId: true, updatedAt: true },
			}),
			this.db.member.count({
				where: { organizationId: currentOrganizationId() },
			}),
		]);

		const connection = grant?.botToken ? grant : null;
		const matched = matches.filter((match) => match.slackUserId).length;
		const reviewed = matches.length;
		const inventoryFresh =
			connection &&
			reviewed === memberCount &&
			matches.every((match) => match.updatedAt >= connection.updatedAt);
		if (connection && !inventoryFresh) {
			await this.agent.slackPeopleRequested(
				"Match workspace members to Slack accounts by exact email",
			);
		}

		return {
			configured: isSlackConfigured(),
			connected: Boolean(connection),
			workspace: connection?.teamName ?? null,
			lastConnectedAt: connection?.updatedAt.toISOString() ?? null,
			scopes: (connection?.botScopes ?? "")
				.split(",")
				.map((scope) => scope.trim())
				.filter(Boolean),
			canInviteItself: Boolean(grant?.userToken),
			canManage: canManageConnections(role),
			agents,
			people: { matched, reviewed },
		};
	}

	async matches(userId: string): Promise<SlackMatches> {
		await this.access.assertMember(userId);
		const [members, syncing] = await Promise.all([
			this.db.member.findMany({
				where: { organizationId: currentOrganizationId() },
				orderBy: { user: { name: "asc" } },
				select: {
					user: {
						select: {
							id: true,
							name: true,
							email: true,
							slackMemberMatch: {
								select: {
									slackUserId: true,
									slackHandle: true,
									slackEmail: true,
								},
							},
						},
					},
				},
			}),
			this.peopleSyncState(),
		]);

		return {
			rows: members.map(({ user }) => ({
				crmUserId: user.id,
				name: user.name,
				email: user.email,
				match: user.slackMemberMatch,
			})),
			sync: syncing,
		};
	}

	private async peopleSyncState(): Promise<SlackSyncState> {
		const pending = await this.scoped.agentTask.findFirst({
			where: { kind: "slack-people-match", finishedAt: null },
			orderBy: { createdAt: "desc" },
			select: { createdAt: true, startedAt: true, leasedUntil: true },
		});
		if (!pending) return "idle";

		const now = Date.now();
		const leaseHeld = pending.leasedUntil
			? pending.leasedUntil.getTime() > now
			: false;
		if (leaseHeld || pending.startedAt) return "syncing";

		return now - pending.createdAt.getTime() < SLACK.sync.stalledAfterMs
			? "syncing"
			: "stalled";
	}

	async refreshPeople(userId: string): Promise<SlackRefreshPeopleResult> {
		await this.access.assertMember(userId);
		const connection = await this.scoped.slackWorkspaceGrant.findFirst({
			where: { botToken: { not: null } },
			select: { id: true },
		});
		if (!connection) throw new NotFoundException("Slack is not connected.");

		await this.agent.slackPeopleRequested(
			"Refresh Slack people and channels from the connection page",
			true,
		);

		return { requested: true };
	}

	async channels(
		input: SlackChannelsInput,
		userId: string,
	): Promise<SlackChannelsResult> {
		await this.access.assertMember(userId);

		const take = input.limit ?? SLACK.channels.pageSize;
		const needle = input.query?.trim() ?? "";

		const where: Prisma.SlackChannelWhereInput = { available: true };
		if (needle) where.name = { contains: needle, mode: "insensitive" };

		const [rows, grant, sync] = await Promise.all([
			this.scoped.slackChannel.findMany({
				where,
				orderBy: [{ isMember: "desc" }, { name: "asc" }, { id: "asc" }],
				take: take + 1,
				cursor: input.cursor ? { id: input.cursor } : undefined,
				skip: input.cursor ? 1 : undefined,
				select: {
					id: true,
					name: true,
					memberCount: true,
					isPrivate: true,
					isMember: true,
					classifiedAt: true,
					inviteRequestedAt: true,
				},
			}),
			this.scoped.slackWorkspaceGrant.findFirst({ select: { id: true } }),
			this.peopleSyncState(),
		]);

		const page = rows.slice(0, take);

		return {
			canInviteItself: Boolean(grant),
			sync,
			nextCursor: rows.length > take ? (page.at(-1)?.id ?? null) : null,
			rows: page.map(({ classifiedAt, ...row }) => ({
				...row,
				classified: classifiedAt !== null,
				inviteRequestedAt: row.inviteRequestedAt?.toISOString() ?? null,
			})),
		};
	}

	async joinChannel(
		input: SlackJoinChannelInput,
		userId: string,
	): Promise<SlackJoinChannelResult> {
		await this.access.assertMember(userId);
		const channel = await this.scoped.slackChannel.findUnique({
			where: { id: input.channelId },
			select: { id: true, name: true, isMember: true, isPrivate: true },
		});
		if (!channel) throw new NotFoundException("No such Slack channel.");
		if (channel.isMember) return { queued: false, alreadyJoined: true };

		const grant = await this.scoped.slackWorkspaceGrant.findFirst({
			select: { id: true },
		});
		if (channel.isPrivate && !grant) {
			await this.scoped.slackChannel.update({
				where: { id: channel.id },
				data: { inviteRequestedAt: new Date() },
			});
			return { queued: false, alreadyJoined: false };
		}

		await this.agent.slackChannelJoinRequested(channel.id, channel.name);
		return { queued: true, alreadyJoined: false };
	}

	async createChannel(
		input: SlackCreateChannelInput,
		userId: string,
	): Promise<SlackCreateChannelResult> {
		await this.access.assertMember(userId);
		const existing = await this.scoped.slackChannel.findFirst({
			where: { name: input.name },
			select: { id: true },
		});
		if (existing) {
			throw new BadRequestException("A channel with that name already exists.");
		}

		return this.slackChannels.create(input.name, input.isPrivate);
	}

	async disconnect(userId: string): Promise<SlackDisconnectResult> {
		const role = await this.access.assertMember(userId);

		if (!canManageConnections(role)) {
			throw new ForbiddenException(
				"Only an owner or an admin can disconnect Slack.",
			);
		}

		const grant = await this.scoped.slackWorkspaceGrant.findFirst({
			select: { id: true },
		});
		if (!grant) throw new NotFoundException("Slack is not connected.");

		await scopedTransaction(this.scoped, async (tx) => {
			await tx.slackChannel.deleteMany({});
			await tx.slackWorkspaceGrant.delete({ where: { id: grant.id } });
		});

		return { disconnected: true };
	}
}
