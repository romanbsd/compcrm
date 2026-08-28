export function contactName(contact: {
	displayName?: string | null;
	firstName: string;
	lastName: string | null;
}): string {
	return (
		contact.displayName?.trim() ||
		[contact.firstName, contact.lastName].filter(Boolean).join(" ")
	);
}
