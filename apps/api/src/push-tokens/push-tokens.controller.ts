import { type auth, SESSION_COOKIE_NAME } from "@crm/auth";
import { Body, Controller, Delete, Post, Query } from "@nestjs/common";
import {
	ApiCookieAuth,
	ApiOkResponse,
	ApiOperation,
	ApiTags,
	ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { PushTokensService } from "./push-tokens.service";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Push tokens")
@ApiCookieAuth(SESSION_COOKIE_NAME)
@Controller("push-tokens")
export class PushTokensController {
	constructor(private readonly pushTokens: PushTokensService) {}

	@Post()
	@ApiOperation({ summary: "Register this device's FCM token" })
	@ApiOkResponse({ description: "The token was stored." })
	@ApiUnauthorizedResponse({ description: "No valid session." })
	register(@Session() session: CrmSession, @Body() body: unknown) {
		return this.pushTokens.register(session.user.id, body);
	}

	@Delete()
	@ApiOperation({ summary: "Remove this device's FCM token" })
	@ApiOkResponse({
		description: "The token was removed if it belonged to the caller.",
	})
	@ApiUnauthorizedResponse({ description: "No valid session." })
	unregister(@Session() session: CrmSession, @Query("token") token: string) {
		return this.pushTokens.unregister(session.user.id, token);
	}
}
