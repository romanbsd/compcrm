import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "./client";
import { db } from "./client";
import type { Prisma } from "./generated/prisma/client";
import { currentOrganizationId, runInTenant } from "./tenant-context";

const tenantScopedModels = new Set<Prisma.ModelName>([
	"SlackMemberMatch",
	"SlackChannel",
	"SlackInstallation",
	"SlackWorkspaceGrant",
	"Company",
	"CompanyEnrichment",
	"Contact",
	"ContactFact",
	"ContactBrief",
	"AgentTask",
	"AgentEvent",
	"AgentConversation",
	"AgentConversationFeedback",
	"AgentConversationShare",
	"AgentConversationSubmission",
	"AgentConversationAttachment",
	"AgentDefinition",
	"AgentVersion",
	"AgentBuilderArtifact",
	"AgentTrigger",
	"AgentRun",
	"AgentRunEvent",
	"AgentAction",
	"AgentAuditEvent",
	"Deal",
	"DealContact",
	"FieldDefinition",
	"FieldOption",
	"FieldValue",
	"SavedView",
	"Activity",
	"MailboxSync",
	"EmailThread",
	"EmailMessage",
	"CalendarEvent",
	"CalendarAttendee",
	"SuppressedDomain",
	"SuppressedContact",
	"AppSetting",
	"TrackedDomain",
	"TrackedVisitor",
	"TrackedEvent",
	"TrackingCounter",
	"TrackedPageDaily",
	"FormSubmission",
	"WorkspaceProfile",
	"SsoProvider",
]);

const activeTransactionStorage =
	new AsyncLocalStorage<Prisma.TransactionClient>();

export const scopedDb = db.$extends({
	name: "tenant-scope",
	query: {
		$allModels: {
			async $allOperations({ model, operation, args, query }) {
				if (!model || !tenantScopedModels.has(model as Prisma.ModelName)) {
					return query(args);
				}

				const activeTransaction = activeTransactionStorage.getStore();
				const executeOperation = (client: Prisma.TransactionClient) => {
					const key = model.charAt(0).toLowerCase() + model.slice(1);
					const delegate = Reflect.get(client, key);
					const action = Reflect.get(delegate, operation);
					return Reflect.apply(action, delegate, [args]);
				};

				if (activeTransaction) {
					return executeOperation(activeTransaction);
				}

				return scopedTransaction(async (tx) => executeOperation(tx));
			},
		},
	},
});

export type ScopedDb = Db;

export interface ScopedTransactionOptions {
	isolationLevel?: Prisma.TransactionIsolationLevel;
	maxWait?: number;
	timeout?: number;
}

type ScopedTransactionWork<T> = (tx: Prisma.TransactionClient) => Promise<T>;
interface TransactionRunner {
	$transaction<T>(
		work: ScopedTransactionWork<T>,
		options?: ScopedTransactionOptions,
	): Promise<T>;
}
type TransactionClientProvider = Db;

export function scopedTransaction<T>(
	fn: ScopedTransactionWork<T>,
	options?: ScopedTransactionOptions,
): Promise<T>;
export function scopedTransaction<T>(
	client: TransactionClientProvider,
	fn: ScopedTransactionWork<T>,
	options?: ScopedTransactionOptions,
): Promise<T>;
export async function scopedTransaction<T>(
	clientOrWork: TransactionClientProvider | ScopedTransactionWork<T>,
	workOrOptions?: ScopedTransactionWork<T> | ScopedTransactionOptions,
	transactionOptions?: ScopedTransactionOptions,
): Promise<T> {
	const client = clientOrWork instanceof Function ? db : clientOrWork;
	const work =
		clientOrWork instanceof Function
			? clientOrWork
			: (workOrOptions as ScopedTransactionWork<T>);
	const options =
		clientOrWork instanceof Function
			? (workOrOptions as ScopedTransactionOptions | undefined)
			: transactionOptions;
	const organizationId = currentOrganizationId();
	const transactionRunner = client === scopedDb ? db : client;

	return (transactionRunner as TransactionRunner).$transaction(async (tx) => {
		await setTenant(tx, organizationId);
		return activeTransactionStorage.run(tx, () => work(tx));
	}, options);
}

export function tenantTransaction<T>(
	organizationId: string,
	action: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return runInTenant(organizationId, () => scopedTransaction(action));
}

function setTenant(
	tx: Prisma.TransactionClient,
	organizationId: string,
): Promise<unknown> {
	return tx.$queryRaw`
		SELECT set_config('app.current_organization_id', ${organizationId}, true)
	`;
}
