import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CurrencyModule } from "../currency/currency.module";
import { HomeController } from "./home.controller";
import { HomeRepository } from "./home.repository";
import { HomeService } from "./home.service";

@Module({
	imports: [AgentModule, CurrencyModule],
	controllers: [HomeController],
	providers: [HomeService, HomeRepository],
})
export class HomeModule {}
