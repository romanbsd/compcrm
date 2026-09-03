import { type auth, SESSION_COOKIE_NAME } from "@crm/auth";
import { Controller, Get } from "@nestjs/common";
import {
	ApiCookieAuth,
	ApiForbiddenResponse,
	ApiOkResponse,
	ApiOperation,
	ApiSecurity,
	ApiTags,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { HomeService } from "./home.service";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Home")
@ApiCookieAuth(SESSION_COOKIE_NAME)
@ApiSecurity("apiKey")
@Controller()
export class HomeController {
	constructor(private readonly home: HomeService) {}

	@Get("home")
	@ApiOperation({
		operationId: "home-snapshot",
		summary: "Get the JobSteward Home command snapshot",
	})
	@ApiOkResponse({
		description:
			"Curated JobSteward Home command snapshot for the signed-in user.",
		schema: { $ref: "#/components/schemas/HomeSnapshot" },
	})
	@ApiUnauthorizedResponse({ description: "No valid session." })
	@ApiForbiddenResponse({ description: "Not a member of this workspace." })
	getHome(@Session() session: CrmSession) {
		return this.home.snapshot(session);
	}
}
