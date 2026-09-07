import { Inject } from "@nestjs/common";

export const DATABASE = Symbol("DATABASE");
export const SCOPED_DATABASE = Symbol("SCOPED_DATABASE");

export const InjectDatabase = () => Inject(DATABASE);
export const InjectScopedDatabase = () => Inject(SCOPED_DATABASE);
