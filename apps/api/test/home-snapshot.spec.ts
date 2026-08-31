import { describe, expect, it } from "bun:test";
import { DealStage } from "@crm/db/enums";
import { homeSnapshot } from "../src/home/home.contracts";
import {
	assembleHomeSnapshot,
	type HomeSnapshotInput,
} from "../src/home/home-snapshot";

const now = new Date("2026-08-31T12:00:00.000Z");

function input(overrides: Partial<HomeSnapshotInput> = {}): HomeSnapshotInput {
	return {
		now,
		reportingCurrency: "USD",
		deals: [],
		approvals: [],
		tasks: [],
		recentWork: [],
		...overrides,
	};
}

function deal(
	overrides: Partial<HomeSnapshotInput["deals"][number]> & { id: string },
): HomeSnapshotInput["deals"][number] {
	return {
		name: `${overrides.id} name`,
		stage: DealStage.DEMO_BOOKED,
		amount: null,
		currency: "USD",
		baseAmount: null,
		baseCurrency: null,
		expectedCloseDate: null,
		lastActivityAt: null,
		companyName: `${overrides.id} customer`,
		meetingTodayAt: null,
		...overrides,
	};
}

describe("assembleHomeSnapshot", () => {
	it("returns zeros and empty arrays for an empty workspace", () => {
		const snapshot = assembleHomeSnapshot(input());

		expect(homeSnapshot.parse(snapshot)).toEqual({
			activeProjectCount: 0,
			attentionCount: 0,
			unreadNotificationCount: 0,
			attention: [],
			projects: [],
			recentWork: [],
		});
	});

	it("maps open deal stages onto construction lifecycle", () => {
		const stages = [
			[DealStage.DEMO_BOOKED, "discovery"],
			[DealStage.QUALIFIED_TO_BUY, "proposal"],
			[DealStage.DECISION_MAKER_BOUGHT_IN, "preConstruction"],
			[DealStage.CONTRACT_SENT, "inProgress"],
		] as const;

		for (const [stage, lifecycle] of stages) {
			const snapshot = assembleHomeSnapshot(
				input({ deals: [deal({ id: "d1", stage })] }),
			);
			expect(snapshot.projects[0]?.lifecycle).toBe(lifecycle);
		}
	});

	it("caps project previews at 3 and reports the full active count", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				deals: [
					deal({
						id: "d1",
						lastActivityAt: new Date("2026-08-31T11:00:00.000Z"),
					}),
					deal({
						id: "d2",
						lastActivityAt: new Date("2026-08-31T10:00:00.000Z"),
					}),
					deal({
						id: "d3",
						lastActivityAt: new Date("2026-08-31T09:00:00.000Z"),
					}),
					deal({
						id: "d4",
						lastActivityAt: new Date("2026-08-31T08:00:00.000Z"),
					}),
				],
			}),
		);

		expect(snapshot.activeProjectCount).toBe(4);
		expect(snapshot.projects).toHaveLength(3);
		expect(snapshot.projects.map((row) => row.id)).toEqual(["d1", "d2", "d3"]);
	});

	it("turns a proposal-stage approval into owner language, not a run status", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				deals: [
					deal({
						id: "prj_carter",
						name: "Carter Primary Bath",
						stage: DealStage.QUALIFIED_TO_BUY,
						companyName: "Sarah Carter",
						baseAmount: 42800,
						baseCurrency: "USD",
					}),
				],
				approvals: [
					{
						id: "run_1",
						createdAt: new Date("2026-08-31T11:12:00.000Z"),
						agentId: "bob",
						agentName: "Bob",
						dealId: "prj_carter",
						dealName: "Carter Primary Bath",
						dealStage: DealStage.QUALIFIED_TO_BUY,
						amount: 42800,
						currency: "USD",
						baseAmount: 42800,
						baseCurrency: "USD",
					},
				],
			}),
		);

		expect(snapshot.attentionCount).toBe(1);
		expect(snapshot.attention[0]).toMatchObject({
			id: "run_1",
			projectId: "prj_carter",
			projectName: "Carter Primary Bath",
			actor: { id: "bob", name: "Bob", role: "projectManager" },
			title: "Proposal ready for approval",
			keyValue: "$42,800",
			actionLabel: "Review proposal",
			action: "reviewProposal",
			createdAt: "2026-08-31T11:12:00.000Z",
			priority: "customerApproval",
		});
		expect(snapshot.attention[0]?.title).not.toMatch(
			/WAITING_FOR_APPROVAL|AI/i,
		);
		expect(snapshot.projects[0]?.needsUserAttention).toBe(true);
		expect(snapshot.projects[0]?.operationalState).toBe(
			"Waiting for your approval",
		);
	});

	it("ranks blocked attention ahead of ordinary, not by createdAt alone", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				deals: [
					deal({ id: "late", name: "Late job", companyName: "Late Co" }),
					deal({ id: "fresh", name: "Fresh job", companyName: "Fresh Co" }),
				],
				approvals: [
					{
						id: "new_update",
						createdAt: new Date("2026-08-31T11:50:00.000Z"),
						agentId: "bob",
						agentName: "Bob",
						dealId: "fresh",
						dealName: "Fresh job",
						dealStage: DealStage.DEMO_BOOKED,
						amount: null,
						currency: "USD",
						baseAmount: null,
						baseCurrency: null,
					},
				],
				tasks: [
					{
						id: "overdue_task",
						subject: "Call the permit office",
						createdAt: new Date("2026-08-30T08:00:00.000Z"),
						dueAt: new Date("2026-08-30T09:00:00.000Z"),
						dealId: "late",
						dealName: "Late job",
					},
				],
			}),
		);

		expect(snapshot.attention.map((row) => row.id)).toEqual([
			"overdue_task",
			"new_update",
		]);
		expect(snapshot.attention[0]?.priority).toBe("blocked");
		expect(snapshot.attention[1]?.priority).toBe("ordinary");
	});

	it("caps attention at 3 and reports the full actionable count", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				deals: [deal({ id: "d1" })],
				tasks: [1, 2, 3, 4].map((n) => ({
					id: `task_${n}`,
					subject: `Do thing ${n}`,
					createdAt: new Date(`2026-08-31T0${n}:00:00.000Z`),
					dueAt: null,
					dealId: "d1",
					dealName: "d1 name",
				})),
			}),
		);

		expect(snapshot.attentionCount).toBe(4);
		expect(snapshot.attention).toHaveLength(3);
	});

	it("drops approvals and tasks that have no project", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				approvals: [
					{
						id: "orphan_run",
						createdAt: now,
						agentId: "bob",
						agentName: "Bob",
						dealId: null,
						dealName: null,
						dealStage: null,
						amount: null,
						currency: "USD",
						baseAmount: null,
						baseCurrency: null,
					},
				],
				tasks: [
					{
						id: "orphan_task",
						subject: "Follow up",
						createdAt: now,
						dueAt: null,
						dealId: null,
						dealName: null,
					},
				],
			}),
		);

		expect(snapshot.attentionCount).toBe(0);
		expect(snapshot.attention).toEqual([]);
	});

	it("orders projects with attention first, then today's schedule", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				deals: [
					deal({
						id: "quiet",
						lastActivityAt: new Date("2026-08-31T11:00:00.000Z"),
					}),
					deal({
						id: "meeting",
						lastActivityAt: new Date("2026-08-30T11:00:00.000Z"),
						meetingTodayAt: new Date("2026-08-31T15:30:00.000Z"),
					}),
					deal({
						id: "needs_you",
						lastActivityAt: new Date("2026-08-29T11:00:00.000Z"),
					}),
				],
				approvals: [
					{
						id: "run_needs",
						createdAt: now,
						agentId: "bob",
						agentName: "Bob",
						dealId: "needs_you",
						dealName: "needs_you name",
						dealStage: DealStage.DEMO_BOOKED,
						amount: null,
						currency: "USD",
						baseAmount: null,
						baseCurrency: null,
					},
				],
			}),
		);

		expect(snapshot.projects.map((row) => row.id)).toEqual([
			"needs_you",
			"meeting",
			"quiet",
		]);
		expect(snapshot.projects[1]?.operationalState).toBe(
			"Meeting today · 3:30 PM",
		);
	});

	it("keeps unread notifications at zero and recent work at three newest", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				recentWork: [
					{
						id: "rw1",
						summary: "Handled 6 customer conversations today",
						occurredAt: new Date("2026-08-31T09:00:00.000Z"),
						agentId: "secretary",
						agentName: "Secretary",
						dealId: null,
					},
					{
						id: "rw2",
						summary: "Recorded Wilson's $18,500 deposit",
						occurredAt: new Date("2026-08-31T08:30:00.000Z"),
						agentId: "cfo",
						agentName: "CFO",
						dealId: "prj_wilson",
					},
					{
						id: "rw3",
						summary: "Prepared Johnson's daily project report",
						occurredAt: new Date("2026-08-31T08:00:00.000Z"),
						agentId: "bob",
						agentName: "Bob",
						dealId: "prj_johnson",
					},
					{
						id: "rw4",
						summary: "Older leftover work",
						occurredAt: new Date("2026-08-31T07:00:00.000Z"),
						agentId: "other",
						agentName: "Other",
						dealId: null,
					},
				],
			}),
		);

		expect(snapshot.unreadNotificationCount).toBe(0);
		expect(snapshot.recentWork).toHaveLength(3);
		expect(snapshot.recentWork.map((row) => row.id)).toEqual([
			"rw1",
			"rw2",
			"rw3",
		]);
		expect(snapshot.recentWork[0]?.actor.role).toBe("secretary");
		expect(snapshot.recentWork[1]?.actor.role).toBe("cfo");
		expect(snapshot.recentWork[2]?.actor.role).toBe("projectManager");
	});

	it("prefers a different agent role when filling recent work", () => {
		const snapshot = assembleHomeSnapshot(
			input({
				recentWork: [
					{
						id: "pm1",
						summary: "Prepared the first report",
						occurredAt: new Date("2026-08-31T10:00:00.000Z"),
						agentId: "bob",
						agentName: "Bob",
						dealId: "d1",
					},
					{
						id: "pm2",
						summary: "Prepared the second report",
						occurredAt: new Date("2026-08-31T09:30:00.000Z"),
						agentId: "bob",
						agentName: "Bob",
						dealId: "d2",
					},
					{
						id: "sec1",
						summary: "Handled inbound calls",
						occurredAt: new Date("2026-08-31T09:00:00.000Z"),
						agentId: "secretary",
						agentName: "Secretary",
						dealId: null,
					},
					{
						id: "cfo1",
						summary: "Posted the deposit",
						occurredAt: new Date("2026-08-31T08:00:00.000Z"),
						agentId: "cfo",
						agentName: "CFO",
						dealId: "d3",
					},
				],
			}),
		);

		expect(snapshot.recentWork.map((row) => row.actor.role)).toEqual([
			"projectManager",
			"secretary",
			"cfo",
		]);
	});
});
