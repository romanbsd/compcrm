import type { Prisma } from "./generated/prisma/client";

type IdempotencyTransaction = {
	$queryRaw<T>(
		query: TemplateStringsArray | Prisma.Sql,
		...values: unknown[]
	): Promise<T>;
};

export async function lockIdempotencyKey(
	tx: IdempotencyTransaction,
	key: string,
): Promise<void> {
	await tx.$queryRaw<Array<{ locked: boolean }>>`
		SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked
	`;
}
