import { describe, expect, it } from "bun:test";
import * as vendored from "../../../vendor/kaneo/apps/api/src/database/schema.ts";
import { toDrizzleSchema } from "./drizzle";
import { kaneoSchema } from "./kaneo";
import { renderTable } from "./parity";

const PHYSICAL_TO_VENDORED = {
	user: "userTable",
	session: "sessionTable",
	account: "accountTable",
	user_avatar: "userAvatarTable",
	verification: "verificationTable",
	workspace: "workspaceTable",
	workspace_member: "workspaceUserTable",
	workspace_billing: "workspaceBillingTable",
	trial_grant: "trialGrantTable",
	billing_event: "billingEventTable",
	team: "teamTable",
	team_member: "teamMemberTable",
	workspace_invitation: "invitationTable",
	workspace_role: "workspaceRoleTable",
	project: "projectTable",
	column: "columnTable",
	workflow_rule: "workflowRuleTable",
	task: "taskTable",
	billing_reminder_sent: "billingReminderSentTable",
	job_lease: "jobLeaseTable",
	task_reminder_sent: "taskReminderSentTable",
	time_entry: "timeEntryTable",
	task_activity: "activityTable",
	asset: "assetTable",
	label: "labelTable",
	notification: "notificationTable",
	user_notification_preference: "userNotificationPreferenceTable",
	user_notification_workspace_rule: "userNotificationWorkspaceRuleTable",
	user_notification_workspace_project: "userNotificationWorkspaceProjectTable",
	github_integration: "githubIntegrationTable",
	integration: "integrationTable",
	external_link: "externalLinkTable",
	comment: "commentTable",
	task_relation: "taskRelationTable",
	apikey: "apikeyTable",
	device_code: "deviceCodeTable",
	mcp_oauth_state: "mcpOauthStateTable",
};

describe("kaneo drizzle parity", () => {
	const generated = toDrizzleSchema(kaneoSchema);

	it("exposes every vendored table", () => {
		for (const [physical, exportName] of Object.entries(PHYSICAL_TO_VENDORED)) {
			expect(
				vendored[exportName as keyof typeof vendored],
				`${exportName} exists`,
			).toBeDefined();
			expect(generated.tables[physical], `generated ${physical}`).toBeDefined();
		}
	});

	for (const [physical, exportName] of Object.entries(PHYSICAL_TO_VENDORED)) {
		it(`${physical} (${exportName}) matches the vendored schema`, () => {
			const original = vendored[exportName as keyof typeof vendored];
			const generatedTable = generated.tables[physical];
			expect(renderTable(generatedTable)).toBe(renderTable(original));
		});
	}
});
