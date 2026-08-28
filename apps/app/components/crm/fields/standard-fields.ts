import type { FieldEntity } from "./fields-entity";

export const STANDARD_FIELDS = {
	COMPANY: [
		"Name",
		"Domain",
		"Website",
		"Phone",
		"Email",
		"City",
		"Country",
		"Owner",
	],
	CONTACT: [
		"First name",
		"Last name",
		"Title",
		"Email",
		"Phone",
		"LinkedIn",
		"GitHub",
		"Company",
		"Owner",
	],
	DEAL: [
		"Name",
		"Amount",
		"Currency",
		"Target date",
		"Company",
		"Owner",
		"Status",
		"Project type",
		"Lead source",
		"Job-site address",
	],
} satisfies Record<FieldEntity, readonly string[]>;
