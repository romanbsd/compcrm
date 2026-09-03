import type { auth } from "@crm/auth";
import { Injectable } from "@nestjs/common";
import type { UserSession } from "@thallesp/nestjs-better-auth";
import { AgentAccessService } from "../agent/agent-access.service";
import { ConversionService } from "../currency/conversion.service";
import { type HomeSnapshot, homeSnapshot } from "./home.contracts";
import { HomeRepository } from "./home.repository";
import { assembleHomeSnapshot } from "./home-snapshot";

type CrmSession = UserSession<typeof auth>;

@Injectable()
export class HomeService {
	constructor(
		private readonly access: AgentAccessService,
		private readonly conversion: ConversionService,
		private readonly repository: HomeRepository,
	) {}

	async snapshot(session: CrmSession): Promise<HomeSnapshot> {
		await this.access.assertMember(session.user.id);
		const now = new Date();
		const [reportingCurrency, rows] = await Promise.all([
			this.conversion.reportingCurrency(),
			this.repository.load(session.user.id, now),
		]);

		return homeSnapshot.parse(
			assembleHomeSnapshot({
				now,
				reportingCurrency,
				...rows,
			}),
		);
	}
}
