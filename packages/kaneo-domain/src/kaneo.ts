import {
	defineSchema,
	foreignKey,
	index,
	t,
	table,
	unique,
	uniqueIndex,
} from "./dsl";

export const kaneoSchema = defineSchema([
	table("user", {
		id: t.text("id", "id").pk().defaultCuid(),
		name: t.text("name", "name").notNull(),
		email: t.text("email", "email").notNull().unique(),
		emailVerified: t
			.boolean("emailVerified", "emailVerified")
			.notNull()
			.clientDefault(false),
		image: t.text("image", "image"),
		locale: t.text("locale", "locale"),
		createdAt: t.timestamp("createdAt", "createdAt").defaultNow().notNull(),
		updatedAt: t
			.timestamp("updatedAt", "updatedAt")
			.defaultNow()
			.onUpdateNow()
			.notNull(),
		isAnonymous: t.boolean("isAnonymous", "isAnonymous").default(false),
		role: t.text("role", "role"),
		banned: t.boolean("banned", "banned").default(false),
		banReason: t.text("banReason", "banReason"),
		banExpires: t.timestamp("banExpires", "banExpires"),
	}),
	table(
		"session",
		{
			id: t.text("id", "id").pk(),
			expiresAt: t.timestamp("expiresAt", "expiresAt").notNull(),
			token: t.text("token", "token").notNull().unique(),
			createdAt: t.timestamp("createdAt", "createdAt").defaultNow().notNull(),
			updatedAt: t.timestamp("updatedAt", "updatedAt").onUpdateNow().notNull(),
			ipAddress: t.text("ipAddress", "ipAddress"),
			userAgent: t.text("userAgent", "userAgent"),
			userId: t
				.text("userId", "userId")
				.notNull()
				.ref("user", { onDelete: "cascade" }),
			activeOrganizationId: t.text(
				"activeOrganizationId",
				"activeOrganizationId",
			),
			activeTeamId: t.text("activeTeamId", "activeTeamId"),
			impersonatedBy: t.text("impersonatedBy", "impersonatedBy"),
		},
		{
			indexes: [index("session_userId_idx", ["userId"])],
		},
	),
	table(
		"account",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			accountId: t.text("accountId", "accountId").notNull(),
			providerId: t.text("providerId", "providerId").notNull(),
			userId: t
				.text("userId", "userId")
				.notNull()
				.ref("user", { onDelete: "cascade" }),
			accessToken: t.text("accessToken", "accessToken"),
			refreshToken: t.text("refreshToken", "refreshToken"),
			idToken: t.text("idToken", "idToken"),
			accessTokenExpiresAt: t.timestamp(
				"accessTokenExpiresAt",
				"accessToken_expires_at",
			),
			refreshTokenExpiresAt: t.timestamp(
				"refreshTokenExpiresAt",
				"refreshToken_expires_at",
			),
			scope: t.text("scope", "scope"),
			password: t.text("password", "password"),
			createdAt: t.timestamp("createdAt", "createdAt").defaultNow().notNull(),
			updatedAt: t.timestamp("updatedAt", "updatedAt").onUpdateNow().notNull(),
		},
		{
			indexes: [index("account_userId_idx", ["userId"])],
		},
	),
	table(
		"user_avatar",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			userId: t
				.text("userId", "user_id")
				.notNull()
				.unique("user_avatar_user_id_unique")
				.ref("user", { onDelete: "cascade", onUpdate: "cascade" }),
			mimeType: t.text("mimeType", "mime_type").notNull(),
			size: t.integer("size", "size").notNull(),
			data: t.bytea("data", "data").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [index("user_avatar_userId_idx", ["userId"])],
		},
	),
	table(
		"verification",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			identifier: t.text("identifier", "identifier").notNull(),
			value: t.text("value", "value").notNull(),
			expiresAt: t.timestamp("expiresAt", "expiresAt").notNull(),
			createdAt: t.timestamp("createdAt", "createdAt").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updatedAt")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [index("verification_identifier_idx", ["identifier"])],
		},
	),
	table("workspace", {
		id: t.text("id", "id").pk().defaultCuid(),
		name: t.text("name", "name").notNull(),
		slug: t.text("slug", "slug").notNull().unique(),
		logo: t.text("logo", "logo"),
		metadata: t.text("metadata", "metadata"),
		description: t.text("description", "description"),
		createdAt: t.timestamp("createdAt", "created_at").notNull(),
	}),
	table(
		"workspace_member",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade" }),
			userId: t
				.text("userId", "user_id")
				.notNull()
				.ref("user", { onDelete: "cascade" }),
			role: t.text("role", "role").notNull().default("member"),
			joinedAt: t.timestamp("joinedAt", "joined_at").notNull(),
		},
		{
			indexes: [
				index("workspace_member_workspaceId_idx", ["workspaceId"]),
				index("workspace_member_userId_idx", ["userId"]),
			],
		},
	),
	table(
		"workspace_billing",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.unique("workspace_billing_workspace_id_unique")
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
			foundingFree: t
				.boolean("foundingFree", "founding_free")
				.notNull()
				.default(false),
			trialEndsAt: t.timestamp("trialEndsAt", "trial_ends_at"),
			creemCustomerId: t.text("creemCustomerId", "creem_customer_id"),
			creemSubscriptionId: t
				.text("creemSubscriptionId", "creem_subscription_id")
				.unique(),
			creemProductId: t.text("creemProductId", "creem_product_id"),
			plan: t.text("plan", "plan"),
			billingInterval: t.text("billingInterval", "billing_interval"),
			status: t.text("status", "status"),
			seats: t.integer("seats", "seats").notNull().default(1),
			currentPeriodEnd: t.timestamp("currentPeriodEnd", "current_period_end"),
			canceledAt: t.timestamp("canceledAt", "canceled_at"),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [index("workspace_billing_workspaceId_idx", ["workspaceId"])],
		},
	),
	table("trial_grant", {
		emailHash: t.text("emailHash", "email_hash").pk(),
		trialEndsAt: t.timestamp("trialEndsAt", "trial_ends_at").notNull(),
		createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
	}),
	table("billing_event", {
		id: t.text("id", "id").pk(),
		eventType: t.text("eventType", "event_type").notNull(),
		processedAt: t
			.timestamp("processedAt", "processed_at")
			.defaultNow()
			.notNull(),
	}),
	table(
		"team",
		{
			id: t.text("id", "id").pk(),
			name: t.text("name", "name").notNull(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade" }),
			createdAt: t.timestamp("createdAt", "created_at").notNull(),
			updatedAt: t.timestamp("updatedAt", "updated_at").onUpdateNow(),
		},
		{
			indexes: [index("team_workspaceId_idx", ["workspaceId"])],
		},
	),
	table(
		"team_member",
		{
			id: t.text("id", "id").pk(),
			teamId: t
				.text("teamId", "team_id")
				.notNull()
				.ref("team", { onDelete: "cascade" }),
			userId: t
				.text("userId", "user_id")
				.notNull()
				.ref("user", { onDelete: "cascade" }),
			createdAt: t.timestamp("createdAt", "created_at"),
		},
		{
			indexes: [
				index("teamMember_teamId_idx", ["teamId"]),
				index("teamMember_userId_idx", ["userId"]),
			],
		},
	),
	table(
		"workspace_invitation",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade" }),
			email: t.text("email", "email").notNull(),
			role: t.text("role", "role"),
			teamId: t.text("teamId", "team_id"),
			status: t.text("status", "status").notNull().default("pending"),
			expiresAt: t.timestamp("expiresAt", "expires_at").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			inviterId: t
				.text("inviterId", "inviter_id")
				.notNull()
				.ref("user", { onDelete: "cascade" }),
		},
		{
			indexes: [
				index("workspace_invitation_workspaceId_idx", ["workspaceId"]),
				index("workspace_invitation_email_idx", ["email"]),
				index("workspace_invitation_inviterId_idx", ["inviterId"]),
			],
		},
	),
	table(
		"workspace_role",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
			role: t.text("role", "role").notNull(),
			permission: t.text("permission", "permission").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("workspace_role_workspaceId_idx", ["workspaceId"]),
				index("workspace_role_role_idx", ["role"]),
			],
		},
	),
	table(
		"project",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
			slug: t.text("slug", "slug").notNull(),
			icon: t.text("icon", "icon").default("Layout"),
			name: t.text("name", "name").notNull(),
			description: t.text("description", "description"),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			isPublic: t.boolean("isPublic", "is_public").default(false),
			archivedAt: t.timestamp("archivedAt", "archived_at"),
			lastTaskNumber: t
				.integer("lastTaskNumber", "last_task_number")
				.notNull()
				.default(0),
			position: t.integer("position", "position").notNull().default(0),
		},
		{
			indexes: [
				unique("project_workspace_id_id_unique", ["workspaceId", "id"]),
				index("project_workspaceId_position_idx", ["workspaceId", "position"]),
			],
		},
	),
	table(
		"column",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			projectId: t
				.text("projectId", "project_id")
				.notNull()
				.ref("project", { onDelete: "cascade", onUpdate: "cascade" }),
			name: t.text("name", "name").notNull(),
			slug: t.text("slug", "slug").notNull(),
			position: t.integer("position", "position").notNull().default(0),
			icon: t.text("icon", "icon"),
			color: t.text("color", "color"),
			isFinal: t.boolean("isFinal", "is_final").notNull().default(false),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [index("column_projectId_idx", ["projectId"])],
		},
	),
	table(
		"workflow_rule",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			projectId: t
				.text("projectId", "project_id")
				.notNull()
				.ref("project", { onDelete: "cascade", onUpdate: "cascade" }),
			integrationType: t.text("integrationType", "integration_type").notNull(),
			eventType: t.text("eventType", "event_type").notNull(),
			columnId: t
				.text("columnId", "column_id")
				.notNull()
				.ref("column", { onDelete: "cascade", onUpdate: "cascade" }),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("workflow_rule_projectId_idx", ["projectId"]),
				index("workflow_rule_columnId_idx", ["columnId"]),
			],
		},
	),
	table(
		"task",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			projectId: t
				.text("projectId", "project_id")
				.notNull()
				.ref("project", { onDelete: "cascade", onUpdate: "cascade" }),
			position: t.integer("position", "position").default(0),
			number: t.integer("number", "number").default(1),
			userId: t
				.text("userId", "assignee_id")
				.ref("user", { onDelete: "set null", onUpdate: "cascade" }),
			title: t.text("title", "title").notNull(),
			description: t.text("description", "description"),
			status: t.text("status", "status").notNull().default("to-do"),
			columnId: t
				.text("columnId", "column_id")
				.ref("column", { onDelete: "set null", onUpdate: "cascade" }),
			priority: t.text("priority", "priority").notNull().default("low"),
			startDate: t.timestamp("startDate", "start_date"),
			dueDate: t.timestamp("dueDate", "due_date"),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("task_projectId_idx", ["projectId"]),
				index("task_dueDate_idx", ["dueDate"]),
				index("task_assigneeId_idx", ["userId"]),
				index("task_columnId_idx", ["columnId"]),
				unique("task_project_number_unique", ["projectId", "number"]),
			],
		},
	),
	table(
		"billing_reminder_sent",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			userId: t
				.text("userId", "user_id")
				.notNull()
				.ref("user", { onDelete: "cascade", onUpdate: "cascade" }),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
			reminderType: t.text("reminderType", "reminder_type").notNull(),
			trialEndsAt: t.timestamp("trialEndsAt", "trial_ends_at"),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("billing_reminder_sent_workspaceId_idx", ["workspaceId"]),
				index("billing_reminder_sent_userId_idx", ["userId"]),
				unique("billing_reminder_sent_user_type_unique", [
					"userId",
					"reminderType",
				]),
			],
		},
	),
	table("job_lease", {
		name: t.text("name", "name").pk(),
		owner: t.text("owner", "owner").notNull(),
		expiresAt: t.timestamp("expiresAt", "expires_at").notNull(),
	}),
	table(
		"task_reminder_sent",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			taskId: t
				.text("taskId", "task_id")
				.notNull()
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			reminderType: t.text("reminderType", "reminder_type").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("task_reminder_sent_taskId_idx", ["taskId"]),
				unique("task_reminder_sent_task_type_unique", [
					"taskId",
					"reminderType",
				]),
			],
		},
	),
	table(
		"time_entry",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			taskId: t
				.text("taskId", "task_id")
				.notNull()
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			userId: t
				.text("userId", "user_id")
				.ref("user", { onDelete: "set null", onUpdate: "cascade" }),
			description: t.text("description", "description"),
			startTime: t.timestamp("startTime", "start_time").notNull(),
			endTime: t.timestamp("endTime", "end_time"),
			duration: t.integer("duration", "duration").default(0),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("time_entry_taskId_idx", ["taskId"]),
				index("time_entry_userId_idx", ["userId"]),
			],
		},
	),
	table(
		"task_activity",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			taskId: t
				.text("taskId", "task_id")
				.notNull()
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			type: t.text("type", "type").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
			userId: t
				.text("userId", "user_id")
				.ref("user", { onDelete: "set null", onUpdate: "cascade" }),
			content: t.text("content", "content"),
			eventData: t.jsonb("eventData", "event_data"),
			externalUserName: t.text("externalUserName", "external_user_name"),
			externalUserAvatar: t.text("externalUserAvatar", "external_user_avatar"),
			externalSource: t.text("externalSource", "external_source"),
			externalUrl: t.text("externalUrl", "external_url"),
		},
		{
			indexes: [
				index("activity_task_id_idx", ["taskId"]),
				index("activity_userId_idx", ["userId"]),
				unique("activity_task_external_source_external_url_unique", [
					"taskId",
					"externalSource",
					"externalUrl",
				]),
			],
		},
	),
	table(
		"asset",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
			projectId: t
				.text("projectId", "project_id")
				.notNull()
				.ref("project", { onDelete: "cascade", onUpdate: "cascade" }),
			taskId: t
				.text("taskId", "task_id")
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			activityId: t
				.text("activityId", "activity_id")
				.ref("task_activity", { onDelete: "cascade", onUpdate: "cascade" }),
			objectKey: t.text("objectKey", "object_key").notNull().unique(),
			filename: t.text("filename", "filename").notNull(),
			mimeType: t.text("mimeType", "mime_type").notNull(),
			size: t.integer("size", "size").notNull(),
			kind: t.text("kind", "kind").notNull().default("image"),
			surface: t.text("surface", "surface").notNull().default("description"),
			createdBy: t
				.text("createdBy", "created_by")
				.ref("user", { onDelete: "set null", onUpdate: "cascade" }),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
		},
		{
			indexes: [
				index("asset_workspaceId_idx", ["workspaceId"]),
				index("asset_projectId_idx", ["projectId"]),
				index("asset_taskId_idx", ["taskId"]),
				index("asset_activityId_idx", ["activityId"]),
				index("asset_createdBy_idx", ["createdBy"]),
			],
		},
	),
	table(
		"label",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			name: t.text("name", "name").notNull(),
			color: t.text("color", "color").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
			taskId: t
				.text("taskId", "task_id")
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
		},
		{
			indexes: [
				index("label_task_id_idx", ["taskId"]),
				index("label_workspace_id_idx", ["workspaceId"]),
				unique("label_task_name_unique", ["taskId", "name"]),
				uniqueIndex(
					"label_workspace_name_unique",
					["workspaceId", "name"],
					"task_id is null",
				),
			],
		},
	),
	table(
		"notification",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			userId: t
				.text("userId", "user_id")
				.notNull()
				.ref("user", { onDelete: "cascade", onUpdate: "cascade" }),
			title: t.text("title", "title"),
			content: t.text("content", "content"),
			type: t.text("type", "type").notNull().default("info"),
			eventData: t.jsonb("eventData", "event_data"),
			isRead: t.boolean("isRead", "is_read").default(false),
			resourceId: t.text("resourceId", "resource_id"),
			resourceType: t.text("resourceType", "resource_type"),
			createdAt: t
				.timestamp("createdAt", "created_at")
				.withTimezone()
				.defaultNow()
				.notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.withTimezone()
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [index("notification_userId_idx", ["userId"])],
		},
	),
	table("user_notification_preference", {
		id: t.text("id", "id").pk().defaultCuid(),
		userId: t
			.text("userId", "user_id")
			.notNull()
			.unique()
			.ref("user", { onDelete: "cascade", onUpdate: "cascade" }),
		emailEnabled: t
			.boolean("emailEnabled", "email_enabled")
			.notNull()
			.default(false),
		ntfyEnabled: t
			.boolean("ntfyEnabled", "ntfy_enabled")
			.notNull()
			.default(false),
		ntfyServerUrl: t.text("ntfyServerUrl", "ntfy_server_url"),
		ntfyTopic: t.text("ntfyTopic", "ntfy_topic"),
		ntfyToken: t.text("ntfyToken", "ntfy_token"),
		gotifyEnabled: t
			.boolean("gotifyEnabled", "gotify_enabled")
			.notNull()
			.default(false),
		gotifyServerUrl: t.text("gotifyServerUrl", "gotify_server_url"),
		gotifyToken: t.text("gotifyToken", "gotify_token"),
		webhookEnabled: t
			.boolean("webhookEnabled", "webhook_enabled")
			.notNull()
			.default(false),
		webhookUrl: t.text("webhookUrl", "webhook_url"),
		webhookSecret: t.text("webhookSecret", "webhook_secret"),
		taskAssignmentEnabled: t
			.boolean("taskAssignmentEnabled", "task_assignment_enabled")
			.notNull()
			.default(true),
		taskCommentEnabled: t
			.boolean("taskCommentEnabled", "task_comment_enabled")
			.notNull()
			.default(true),
		taskStatusChangeEnabled: t
			.boolean("taskStatusChangeEnabled", "task_status_change_enabled")
			.notNull()
			.default(true),
		dueDateReminderEnabled: t
			.boolean("dueDateReminderEnabled", "due_date_reminder_enabled")
			.notNull()
			.default(true),
		dueDateReminderLeadTimeMinutes: t
			.integer(
				"dueDateReminderLeadTimeMinutes",
				"due_date_reminder_lead_time_minutes",
			)
			.notNull()
			.default(1440),
		createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
		updatedAt: t
			.timestamp("updatedAt", "updated_at")
			.defaultNow()
			.onUpdateNow()
			.notNull(),
	}),
	table(
		"user_notification_workspace_rule",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			userId: t
				.text("userId", "user_id")
				.notNull()
				.ref("user", { onDelete: "cascade", onUpdate: "cascade" }),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
			isActive: t.boolean("isActive", "is_active").notNull().default(true),
			emailEnabled: t
				.boolean("emailEnabled", "email_enabled")
				.notNull()
				.default(false),
			ntfyEnabled: t
				.boolean("ntfyEnabled", "ntfy_enabled")
				.notNull()
				.default(false),
			gotifyEnabled: t
				.boolean("gotifyEnabled", "gotify_enabled")
				.notNull()
				.default(false),
			webhookEnabled: t
				.boolean("webhookEnabled", "webhook_enabled")
				.notNull()
				.default(false),
			projectMode: t
				.text("projectMode", "project_mode")
				.notNull()
				.default("all"),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("user_notification_workspace_rule_userId_idx", ["userId"]),
				index("user_notification_workspace_rule_workspaceId_idx", [
					"workspaceId",
				]),
				unique("user_notification_workspace_rule_user_workspace_unique", [
					"userId",
					"workspaceId",
				]),
				unique("user_notification_workspace_rule_workspace_id_id_unique", [
					"workspaceId",
					"id",
				]),
			],
		},
	),
	table(
		"user_notification_workspace_project",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			workspaceId: t
				.text("workspaceId", "workspace_id")
				.notNull()
				.ref("workspace", { onDelete: "cascade", onUpdate: "cascade" }),
			workspaceRuleId: t.text("workspaceRuleId", "workspace_rule_id").notNull(),
			projectId: t.text("projectId", "project_id").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("user_notification_workspace_project_ruleId_idx", [
					"workspaceRuleId",
				]),
				index("user_notification_workspace_project_projectId_idx", [
					"projectId",
				]),
				index("user_notification_workspace_project_workspaceId_projectId_idx", [
					"workspaceId",
					"projectId",
				]),
				index("unwp_workspaceId_workspaceRuleId_idx", [
					"workspaceId",
					"workspaceRuleId",
				]),
				unique("user_notification_workspace_project_rule_project_unique", [
					"workspaceRuleId",
					"projectId",
				]),
			],
			foreignKeys: [
				foreignKey({
					columns: ["workspaceId", "workspaceRuleId"],
					refTable: "user_notification_workspace_rule",
					refColumns: ["workspace_id", "id"],
					onDelete: "cascade",
					onUpdate: "cascade",
				}),
				foreignKey({
					columns: ["workspaceId", "projectId"],
					refTable: "project",
					refColumns: ["workspace_id", "id"],
					onDelete: "cascade",
					onUpdate: "cascade",
				}),
			],
		},
	),
	table("github_integration", {
		id: t.text("id", "id").pk().defaultCuid(),
		projectId: t
			.text("projectId", "project_id")
			.notNull()
			.unique()
			.ref("project", { onDelete: "cascade", onUpdate: "cascade" }),
		repositoryOwner: t.text("repositoryOwner", "repository_owner").notNull(),
		repositoryName: t.text("repositoryName", "repository_name").notNull(),
		installationId: t.integer("installationId", "installation_id"),
		isActive: t.boolean("isActive", "is_active").default(true),
		createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
		updatedAt: t
			.timestamp("updatedAt", "updated_at")
			.defaultNow()
			.onUpdateNow()
			.notNull(),
	}),
	table(
		"integration",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			projectId: t
				.text("projectId", "project_id")
				.notNull()
				.ref("project", { onDelete: "cascade", onUpdate: "cascade" }),
			type: t.text("type", "type").notNull(),
			config: t.text("config", "config").notNull(),
			isActive: t.boolean("isActive", "is_active").default(true),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("integration_projectId_idx", ["projectId"]),
				index("integration_type_idx", ["type"]),
				unique("integration_project_type_unique", ["projectId", "type"]),
			],
		},
	),
	table(
		"external_link",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			taskId: t
				.text("taskId", "task_id")
				.notNull()
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			integrationId: t
				.text("integrationId", "integration_id")
				.notNull()
				.ref("integration", { onDelete: "cascade", onUpdate: "cascade" }),
			resourceType: t.text("resourceType", "resource_type").notNull(),
			externalId: t.text("externalId", "external_id").notNull(),
			url: t.text("url", "url").notNull(),
			title: t.text("title", "title"),
			metadata: t.text("metadata", "metadata"),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("external_link_taskId_idx", ["taskId"]),
				index("external_link_integrationId_idx", ["integrationId"]),
				index("external_link_externalId_idx", ["externalId"]),
				index("external_link_resourceType_idx", ["resourceType"]),
			],
		},
	),
	table(
		"comment",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			taskId: t
				.text("taskId", "task_id")
				.notNull()
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			userId: t
				.text("userId", "user_id")
				.notNull()
				.ref("user", { onDelete: "cascade", onUpdate: "cascade" }),
			content: t.text("content", "content").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				index("comment_task_idx", ["taskId"]),
				index("comment_user_idx", ["userId"]),
			],
		},
	),
	table(
		"task_relation",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			sourceTaskId: t
				.text("sourceTaskId", "source_task_id")
				.notNull()
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			targetTaskId: t
				.text("targetTaskId", "target_task_id")
				.notNull()
				.ref("task", { onDelete: "cascade", onUpdate: "cascade" }),
			relationType: t.text("relationType", "relation_type").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
		},
		{
			indexes: [
				index("task_relation_source_idx", ["sourceTaskId"]),
				index("task_relation_target_idx", ["targetTaskId"]),
			],
		},
	),
	table(
		"apikey",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			configId: t.text("configId", "configId").notNull().default("default"),
			name: t.text("name", "name"),
			start: t.text("start", "start"),
			referenceId: t
				.text("referenceId", "referenceId")
				.notNull()
				.ref("user", { onDelete: "cascade" }),
			prefix: t.text("prefix", "prefix"),
			key: t.text("key", "key").notNull(),
			userId: t.text("userId", "userId").ref("user", { onDelete: "cascade" }),
			refillInterval: t.integer("refillInterval", "refillInterval"),
			refillAmount: t.integer("refillAmount", "refillAmount"),
			lastRefillAt: t.timestamp("lastRefillAt", "lastRefillAt"),
			enabled: t.boolean("enabled", "enabled").default(true),
			rateLimitEnabled: t
				.boolean("rateLimitEnabled", "rateLimitEnabled")
				.default(true),
			rateLimitTimeWindow: t
				.integer("rateLimitTimeWindow", "rateLimitTimeWindow")
				.default(86400000),
			rateLimitMax: t.integer("rateLimitMax", "rateLimitMax").default(10),
			requestCount: t.integer("requestCount", "requestCount").default(0),
			remaining: t.integer("remaining", "remaining"),
			lastRequest: t.timestamp("lastRequest", "lastRequest"),
			expiresAt: t.timestamp("expiresAt", "expiresAt"),
			createdAt: t.timestamp("createdAt", "createdAt").notNull(),
			updatedAt: t.timestamp("updatedAt", "updatedAt").notNull(),
			permissions: t.text("permissions", "permissions"),
			metadata: t.text("metadata", "metadata"),
		},
		{
			indexes: [
				index("apikey_configId_idx", ["configId"]),
				index("apikey_key_idx", ["key"]),
				index("apikey_referenceId_idx", ["referenceId"]),
				index("apikey_userId_idx", ["userId"]),
			],
		},
	),
	table(
		"device_code",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			deviceCode: t.text("deviceCode", "device_code").notNull(),
			userCode: t.text("userCode", "user_code").notNull(),
			userId: t
				.text("userId", "user_id")
				.ref("user", { onDelete: "cascade", onUpdate: "cascade" }),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
			expiresAt: t.timestamp("expiresAt", "expires_at").notNull(),
			status: t.text("status", "status").notNull(),
			lastPolledAt: t.timestamp("lastPolledAt", "last_polled_at"),
			pollingInterval: t.integer("pollingInterval", "polling_interval"),
			clientId: t.text("clientId", "client_id"),
			scope: t.text("scope", "scope"),
		},
		{
			indexes: [
				uniqueIndex("device_code_device_code_uidx", ["deviceCode"]),
				uniqueIndex("device_code_user_code_uidx", ["userCode"]),
				index("device_code_user_id_idx", ["userId"]),
			],
		},
	),
	table(
		"mcp_oauth_state",
		{
			id: t.text("id", "id").pk().defaultCuid(),
			kind: t.text("kind", "kind").notNull(),
			key: t.text("key", "key").notNull(),
			payload: t.jsonb("payload", "payload").notNull(),
			expiresAt: t.timestamp("expiresAt", "expires_at").notNull(),
			createdAt: t.timestamp("createdAt", "created_at").defaultNow().notNull(),
			updatedAt: t
				.timestamp("updatedAt", "updated_at")
				.defaultNow()
				.onUpdateNow()
				.notNull(),
		},
		{
			indexes: [
				uniqueIndex("mcp_oauth_state_kind_key_uidx", ["kind", "key"]),
				index("mcp_oauth_state_expiresAt_idx", ["expiresAt"]),
			],
		},
	),
]);
