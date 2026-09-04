import { ensureOfficialOAuthClient } from "@crm/auth";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

@Injectable()
export class OAuthBootstrapService implements OnModuleInit {
	private readonly logger = new Logger(OAuthBootstrapService.name);

	async onModuleInit(): Promise<void> {
		try {
			await ensureOfficialOAuthClient();
			this.logger.log({ message: "Official OAuth client reconciled" });
		} catch (error) {
			this.logger.error({
				message: "Official OAuth client reconciliation failed",
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
