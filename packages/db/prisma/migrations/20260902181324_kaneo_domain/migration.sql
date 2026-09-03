-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "user_avatar" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_avatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_member" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_billing" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "founding_free" BOOLEAN NOT NULL DEFAULT false,
    "trial_ends_at" TIMESTAMP(3),
    "creem_customer_id" TEXT,
    "creem_subscription_id" TEXT,
    "creem_product_id" TEXT,
    "plan" TEXT,
    "billing_interval" TEXT,
    "status" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "current_period_end" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_grant" (
    "email_hash" TEXT NOT NULL,
    "trial_ends_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_grant_pkey" PRIMARY KEY ("email_hash")
);

-- CreateTable
CREATE TABLE "billing_event" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_member" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "team_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invitation" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "team_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviter_id" TEXT NOT NULL,

    CONSTRAINT "workspace_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_role" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT DEFAULT 'Layout',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_public" BOOLEAN DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "last_task_number" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "column" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "color" TEXT,
    "is_final" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_rule" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "integration_type" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "position" INTEGER DEFAULT 0,
    "number" INTEGER DEFAULT 1,
    "assignee_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'to-do',
    "column_id" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'low',
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_reminder_sent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "reminder_type" TEXT NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_reminder_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_lease" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_lease_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "task_reminder_sent" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "reminder_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_reminder_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entry" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT,
    "description" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3),
    "duration" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_activity" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "content" TEXT,
    "event_data" JSONB,
    "external_user_name" TEXT,
    "external_user_avatar" TEXT,
    "external_source" TEXT,
    "external_url" TEXT,

    CONSTRAINT "task_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "activity_id" TEXT,
    "object_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "surface" TEXT NOT NULL DEFAULT 'description',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "task_id" TEXT,
    "workspace_id" TEXT,

    CONSTRAINT "label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT,
    "type" TEXT NOT NULL DEFAULT 'info',
    "event_data" JSONB,
    "is_read" BOOLEAN DEFAULT false,
    "resource_id" TEXT,
    "resource_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_preference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ntfy_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ntfy_server_url" TEXT,
    "ntfy_topic" TEXT,
    "ntfy_token" TEXT,
    "gotify_enabled" BOOLEAN NOT NULL DEFAULT false,
    "gotify_server_url" TEXT,
    "gotify_token" TEXT,
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "task_assignment_enabled" BOOLEAN NOT NULL DEFAULT true,
    "task_comment_enabled" BOOLEAN NOT NULL DEFAULT true,
    "task_status_change_enabled" BOOLEAN NOT NULL DEFAULT true,
    "due_date_reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
    "due_date_reminder_lead_time_minutes" INTEGER NOT NULL DEFAULT 1440,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_workspace_rule" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ntfy_enabled" BOOLEAN NOT NULL DEFAULT false,
    "gotify_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_enabled" BOOLEAN NOT NULL DEFAULT false,
    "project_mode" TEXT NOT NULL DEFAULT 'all',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notification_workspace_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_workspace_project" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_rule_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notification_workspace_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_integration" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repository_owner" TEXT NOT NULL,
    "repository_name" TEXT NOT NULL,
    "installation_id" INTEGER,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_link" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_relation" (
    "id" TEXT NOT NULL,
    "source_task_id" TEXT NOT NULL,
    "target_task_id" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_code" (
    "id" TEXT NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "last_polled_at" TIMESTAMP(3),
    "polling_interval" INTEGER,
    "client_id" TEXT,
    "scope" TEXT,

    CONSTRAINT "device_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_oauth_state" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_avatar_user_id_unique" ON "user_avatar"("user_id");

-- CreateIndex
CREATE INDEX "user_avatar_userId_idx" ON "user_avatar"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_slug_key" ON "workspace"("slug");

-- CreateIndex
CREATE INDEX "workspace_member_workspaceId_idx" ON "workspace_member"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_member_userId_idx" ON "workspace_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_billing_workspace_id_unique" ON "workspace_billing"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_billing_creem_subscription_id_key" ON "workspace_billing"("creem_subscription_id");

-- CreateIndex
CREATE INDEX "workspace_billing_workspaceId_idx" ON "workspace_billing"("workspace_id");

-- CreateIndex
CREATE INDEX "team_workspaceId_idx" ON "team"("workspace_id");

-- CreateIndex
CREATE INDEX "teamMember_teamId_idx" ON "team_member"("team_id");

-- CreateIndex
CREATE INDEX "teamMember_userId_idx" ON "team_member"("user_id");

-- CreateIndex
CREATE INDEX "workspace_invitation_workspaceId_idx" ON "workspace_invitation"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_invitation_email_idx" ON "workspace_invitation"("email");

-- CreateIndex
CREATE INDEX "workspace_invitation_inviterId_idx" ON "workspace_invitation"("inviter_id");

-- CreateIndex
CREATE INDEX "workspace_role_workspaceId_idx" ON "workspace_role"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_role_role_idx" ON "workspace_role"("role");

-- CreateIndex
CREATE INDEX "project_workspaceId_position_idx" ON "project"("workspace_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "project_workspace_id_id_unique" ON "project"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "column_projectId_idx" ON "column"("project_id");

-- CreateIndex
CREATE INDEX "workflow_rule_projectId_idx" ON "workflow_rule"("project_id");

-- CreateIndex
CREATE INDEX "workflow_rule_columnId_idx" ON "workflow_rule"("column_id");

-- CreateIndex
CREATE INDEX "task_projectId_idx" ON "task"("project_id");

-- CreateIndex
CREATE INDEX "task_dueDate_idx" ON "task"("due_date");

-- CreateIndex
CREATE INDEX "task_assigneeId_idx" ON "task"("assignee_id");

-- CreateIndex
CREATE INDEX "task_columnId_idx" ON "task"("column_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_project_number_unique" ON "task"("project_id", "number");

-- CreateIndex
CREATE INDEX "billing_reminder_sent_workspaceId_idx" ON "billing_reminder_sent"("workspace_id");

-- CreateIndex
CREATE INDEX "billing_reminder_sent_userId_idx" ON "billing_reminder_sent"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_reminder_sent_user_type_unique" ON "billing_reminder_sent"("user_id", "reminder_type");

-- CreateIndex
CREATE INDEX "task_reminder_sent_taskId_idx" ON "task_reminder_sent"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_reminder_sent_task_type_unique" ON "task_reminder_sent"("task_id", "reminder_type");

-- CreateIndex
CREATE INDEX "time_entry_taskId_idx" ON "time_entry"("task_id");

-- CreateIndex
CREATE INDEX "time_entry_userId_idx" ON "time_entry"("user_id");

-- CreateIndex
CREATE INDEX "activity_task_id_idx" ON "task_activity"("task_id");

-- CreateIndex
CREATE INDEX "activity_userId_idx" ON "task_activity"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_task_external_source_external_url_unique" ON "task_activity"("task_id", "external_source", "external_url");

-- CreateIndex
CREATE UNIQUE INDEX "asset_object_key_key" ON "asset"("object_key");

-- CreateIndex
CREATE INDEX "asset_workspaceId_idx" ON "asset"("workspace_id");

-- CreateIndex
CREATE INDEX "asset_projectId_idx" ON "asset"("project_id");

-- CreateIndex
CREATE INDEX "asset_taskId_idx" ON "asset"("task_id");

-- CreateIndex
CREATE INDEX "asset_activityId_idx" ON "asset"("activity_id");

-- CreateIndex
CREATE INDEX "asset_createdBy_idx" ON "asset"("created_by");

-- CreateIndex
CREATE INDEX "label_task_id_idx" ON "label"("task_id");

-- CreateIndex
CREATE INDEX "label_workspace_id_idx" ON "label"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "label_task_name_unique" ON "label"("task_id", "name");

-- CreateIndex
CREATE INDEX "notification_userId_idx" ON "notification"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_preference_user_id_key" ON "user_notification_preference"("user_id");

-- CreateIndex
CREATE INDEX "user_notification_workspace_rule_userId_idx" ON "user_notification_workspace_rule"("user_id");

-- CreateIndex
CREATE INDEX "user_notification_workspace_rule_workspaceId_idx" ON "user_notification_workspace_rule"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_workspace_rule_user_workspace_unique" ON "user_notification_workspace_rule"("user_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_workspace_rule_workspace_id_id_unique" ON "user_notification_workspace_rule"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "user_notification_workspace_project_ruleId_idx" ON "user_notification_workspace_project"("workspace_rule_id");

-- CreateIndex
CREATE INDEX "user_notification_workspace_project_projectId_idx" ON "user_notification_workspace_project"("project_id");

-- CreateIndex
CREATE INDEX "user_notification_workspace_project_workspaceId_projectId_idx" ON "user_notification_workspace_project"("workspace_id", "project_id");

-- CreateIndex
CREATE INDEX "unwp_workspaceId_workspaceRuleId_idx" ON "user_notification_workspace_project"("workspace_id", "workspace_rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_workspace_project_rule_project_unique" ON "user_notification_workspace_project"("workspace_rule_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "github_integration_project_id_key" ON "github_integration"("project_id");

-- CreateIndex
CREATE INDEX "integration_projectId_idx" ON "integration"("project_id");

-- CreateIndex
CREATE INDEX "integration_type_idx" ON "integration"("type");

-- CreateIndex
CREATE UNIQUE INDEX "integration_project_type_unique" ON "integration"("project_id", "type");

-- CreateIndex
CREATE INDEX "external_link_taskId_idx" ON "external_link"("task_id");

-- CreateIndex
CREATE INDEX "external_link_integrationId_idx" ON "external_link"("integration_id");

-- CreateIndex
CREATE INDEX "external_link_externalId_idx" ON "external_link"("external_id");

-- CreateIndex
CREATE INDEX "external_link_resourceType_idx" ON "external_link"("resource_type");

-- CreateIndex
CREATE INDEX "comment_task_idx" ON "comment"("task_id");

-- CreateIndex
CREATE INDEX "comment_user_idx" ON "comment"("user_id");

-- CreateIndex
CREATE INDEX "task_relation_source_idx" ON "task_relation"("source_task_id");

-- CreateIndex
CREATE INDEX "task_relation_target_idx" ON "task_relation"("target_task_id");

-- CreateIndex
CREATE INDEX "device_code_user_id_idx" ON "device_code"("user_id");

-- CreateIndex
CREATE INDEX "mcp_oauth_state_expiresAt_idx" ON "mcp_oauth_state"("expires_at");

-- AddForeignKey
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_billing" ADD CONSTRAINT "workspace_billing_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_role" ADD CONSTRAINT "workspace_role_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "column" ADD CONSTRAINT "column_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_rule" ADD CONSTRAINT "workflow_rule_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_rule" ADD CONSTRAINT "workflow_rule_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "column"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "column"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_reminder_sent" ADD CONSTRAINT "billing_reminder_sent_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reminder_sent" ADD CONSTRAINT "task_reminder_sent_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset" ADD CONSTRAINT "asset_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "task_activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label" ADD CONSTRAINT "label_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label" ADD CONSTRAINT "label_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_workspace_rule" ADD CONSTRAINT "user_notification_workspace_rule_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_workspace_project" ADD CONSTRAINT "user_notification_workspace_project_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_workspace_project" ADD CONSTRAINT "user_notification_workspace_project_workspace_id_workspace_fkey" FOREIGN KEY ("workspace_id", "workspace_rule_id") REFERENCES "user_notification_workspace_rule"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_workspace_project" ADD CONSTRAINT "user_notification_workspace_project_workspace_id_project_i_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "project"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_integration" ADD CONSTRAINT "github_integration_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration" ADD CONSTRAINT "integration_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_link" ADD CONSTRAINT "external_link_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_link" ADD CONSTRAINT "external_link_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_relation" ADD CONSTRAINT "task_relation_source_task_id_fkey" FOREIGN KEY ("source_task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_relation" ADD CONSTRAINT "task_relation_target_task_id_fkey" FOREIGN KEY ("target_task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

