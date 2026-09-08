import { timingSafeEqual } from "node:crypto";
import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { AssetWorkerService } from "./asset-worker.service";

@ApiTags("Internal Assets")
@Controller("internal/assets")
export class AssetWorkerController {
	constructor(
		private readonly worker: AssetWorkerService,
		private readonly config: ConfigService<EnvironmentVariables, true>,
	) {}

	@Get("process")
	@AllowAnonymous()
	@ApiHeader({
		name: "authorization",
		required: true,
		description: "Bearer CRON_SECRET",
	})
	@ApiOperation({
		summary: "Process durable asset finalization and deletion jobs",
	})
	process(@Headers("authorization") authorization?: string) {
		const secret = this.config.get("CRON_SECRET", { infer: true });
		if (!secret)
			throw new ServiceUnavailableException(
				"Asset processing is not configured.",
			);
		const supplied = Buffer.from(authorization ?? "");
		const expected = Buffer.from(`Bearer ${secret}`);
		if (
			supplied.length !== expected.length ||
			!timingSafeEqual(supplied, expected)
		)
			throw new ForbiddenException();
		return this.worker.process();
	}
}
