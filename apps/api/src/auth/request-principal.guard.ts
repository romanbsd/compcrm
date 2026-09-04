import {
	bearerChallenge,
	oauthScopeFailure,
	requiredCrmScope,
} from "@crm/auth";
import {
	BadRequestException,
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { RequestPrincipalError } from "./request-principal";
import { RequestPrincipalService } from "./request-principal.service";

@Injectable()
export class RequestPrincipalGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly principals: RequestPrincipalService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<Request>();
		const response = context.switchToHttp().getResponse<Response>();
		const isPublic = this.reflector.getAllAndOverride<boolean>("PUBLIC", [
			context.getHandler(),
			context.getClass(),
		]);
		if (isPublic) return true;

		const isOptional = this.reflector.getAllAndOverride<boolean>("OPTIONAL", [
			context.getHandler(),
			context.getClass(),
		]);

		try {
			request.principal = await this.principals.resolve(request);
		} catch (error) {
			if (!(error instanceof RequestPrincipalError)) throw error;
			if (isOptional && error.status === 401) {
				request.principal = null;
				return true;
			}
			if (error.challenge)
				response.setHeader("WWW-Authenticate", error.challenge);
			if (error.status === 400) throw new BadRequestException(error.message);
			if (error.status === 403) throw new ForbiddenException(error.message);
			throw new UnauthorizedException(error.message);
		}

		if (isOptional) return true;
		if (!request.principal) {
			response.setHeader("WWW-Authenticate", bearerChallenge());
			throw new UnauthorizedException();
		}
		if (request.principal.credentialKind === "oauth") {
			const requiredScope = requiredCrmScope(
				!["GET", "HEAD"].includes(request.method),
			);
			const failure = oauthScopeFailure(
				request.principal.scopes,
				requiredScope,
			);
			if (failure) {
				response.setHeader("WWW-Authenticate", failure.challenge);
				throw new ForbiddenException(failure.message);
			}
		}
		return true;
	}
}

declare global {
	namespace Express {
		interface Request {
			principal?: import("./request-principal").RequestPrincipal | null;
		}
	}
}
