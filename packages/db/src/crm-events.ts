export type CrmEventRecordKind = "company" | "contact" | "deal";

type CrmEventDefinition = {
	label: string;
	description: string;
	recordKind: CrmEventRecordKind;
};

export const CRM_EVENT_CATALOG = {
	"company.created": {
		label: "Company created",
		description: "A company is added to the CRM",
		recordKind: "company",
	},
	"contact.created": {
		label: "Contact created",
		description: "A contact is added to the CRM",
		recordKind: "contact",
	},
	"deal.created": {
		label: "Project created",
		description: "A project is added to the CRM",
		recordKind: "deal",
	},
	"deal.stage.changed": {
		label: "Project status changed",
		description: "A project moves from one pipeline status to another",
		recordKind: "deal",
	},
	"deal.opened": {
		label: "Project opened",
		description: "A closed project returns to the open pipeline",
		recordKind: "deal",
	},
	"deal.closed": {
		label: "Project closed",
		description: "An open project moves to a closed status",
		recordKind: "deal",
	},
} as const satisfies Record<string, CrmEventDefinition>;

export type CrmEventType = keyof typeof CRM_EVENT_CATALOG;

export const CRM_EVENT_TYPES = Object.keys(CRM_EVENT_CATALOG) as [
	CrmEventType,
	...CrmEventType[],
];
