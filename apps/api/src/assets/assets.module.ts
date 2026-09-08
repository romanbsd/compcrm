import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { AssetStorageService } from "./asset-storage.service";
import { AssetWorkerController } from "./asset-worker.controller";
import { AssetWorkerService } from "./asset-worker.service";
import { AssetsRouter } from "./assets.router";
import { AssetsService } from "./assets.service";

@Module({
	imports: [TrpcModule],
	controllers: [AssetWorkerController],
	providers: [
		AssetsService,
		AssetsRouter,
		AssetStorageService,
		AssetWorkerService,
	],
	exports: [AssetsService],
})
export class AssetsModule {}
