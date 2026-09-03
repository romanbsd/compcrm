import type { Db } from "@crm/db";
import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import {
	type RegisterPushTokenInput,
	registerPushTokenInput,
} from "./push-tokens.contracts";

@Injectable()
export class PushTokensService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async register(userId: string, body: unknown): Promise<{ ok: true }> {
		const input = this.parse(body);
		await this.db.pushToken.upsert({
			where: { token: input.token },
			create: {
				userId,
				token: input.token,
				platform: input.platform,
			},
			update: {
				userId,
				platform: input.platform,
			},
		});
		return { ok: true };
	}

	async unregister(
		userId: string,
		token: string | undefined,
	): Promise<{ ok: true }> {
		const value = token?.trim() ?? "";
		if (!value) {
			throw new BadRequestException("token is required");
		}

		await this.db.pushToken.deleteMany({
			where: { token: value, userId },
		});
		return { ok: true };
	}

	private parse(body: unknown): RegisterPushTokenInput {
		const parsed = registerPushTokenInput.safeParse(body);
		if (!parsed.success) {
			throw new BadRequestException(
				"token and platform (ios|android) are required",
			);
		}
		return parsed.data;
	}
}
