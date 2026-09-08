const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const ASSETS = {
	uploadUrlMs: 15 * MINUTE_MS,
	downloadUrlMs: 15 * MINUTE_MS,
	intentMs: 24 * HOUR_MS,
	replayMs: 24 * HOUR_MS,
	temporaryRetentionMs: 7 * DAY_MS,
	maxPresignSeconds: (7 * DAY_MS) / SECOND_MS,
	reservationLimit: 20,
	maxSingleUploadBytes: 5 * 1024 ** 3 - 5 * 1024 ** 2,
	network: {
		connectionTimeoutMs: 5 * SECOND_MS,
		requestTimeoutMs: 30 * SECOND_MS,
	},
	worker: {
		leaseMs: 2 * MINUTE_MS,
		heartbeatMs: 30 * SECOND_MS,
		batchSize: 20,
		deadlineMs: 50 * SECOND_MS,
		maxFinalizeAttempts: 5,
		finalizeDeadlineMs: 24 * HOUR_MS,
		retryBaseMs: 5 * SECOND_MS,
		retryMaxMs: HOUR_MS,
	},
} as const;
