import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CompaniesModule } from "../companies/companies.module";
import { TrpcModule } from "../trpc/trpc.module";
import {
	TrackingController,
	TrackingRetentionController,
} from "./tracking.controller";
import { TrackingRouter } from "./tracking.router";
import { TrackingService } from "./tracking.service";
import { TrackingConfigService } from "./tracking-config.service";
import { TrackingCounterService } from "./tracking-counter.service";
import { TrackingFilingService } from "./tracking-filing.service";
import { TrackingIngestService } from "./tracking-ingest.service";
import { TrackingRetentionService } from "./tracking-retention.service";
import { TrackingRollupService } from "./tracking-rollup.service";
import { TrackingSiteLocatorService } from "./tracking-site-locator.service";

@Module({
	imports: [TrpcModule, AgentModule, CompaniesModule],
	controllers: [TrackingController, TrackingRetentionController],
	providers: [
		TrackingConfigService,
		TrackingCounterService,
		TrackingFilingService,
		TrackingIngestService,
		TrackingRetentionService,
		TrackingRollupService,
		TrackingSiteLocatorService,
		TrackingService,
		TrackingRouter,
	],
	exports: [TrackingConfigService],
})
export class TrackingModule {}
