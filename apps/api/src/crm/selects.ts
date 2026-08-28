export const CONTACT_SELECT = {
	id: true,
	displayName: true,
	firstName: true,
	lastName: true,
	email: true,
	title: true,
	businessName: true,
	imageUrl: true,
} as const;

export const PRIMARY_CONTACT_SELECT = {
	contacts: {
		where: { isPrimary: true },
		take: 1,
		select: {
			isPrimary: true,
			contact: { select: CONTACT_SELECT },
		},
	},
} as const;

export function primaryContactOf<T>(deal: {
	contacts: readonly { contact: T }[];
}): T | null {
	return deal.contacts[0]?.contact ?? null;
}
