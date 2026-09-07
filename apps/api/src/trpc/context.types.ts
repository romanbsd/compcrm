import type { Session, SessionUser } from "@crm/auth";
import type { Request } from "express";
import type { RequestPrincipal } from "../auth/request-principal";

export type BaseTrpcContext = {
	req?: Request;
	principal: RequestPrincipal | null;
	session: Session | null;
};

export type SessionTrpcContext = BaseTrpcContext & {
	session: Session;
	user: SessionUser;
	principal: RequestPrincipal;
};

export type AuthedTrpcContext = BaseTrpcContext & {
	user: SessionUser;
	principal: RequestPrincipal;
	organizationId: string;
};
