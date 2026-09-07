"use client";

import { authClient } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { useTransition } from "react";
import { toast } from "sonner";

export type OrgOption = { id: string; name: string; slug: string };

export function OrgSwitcher({
	current,
	options,
}: {
	current: OrgOption;
	options: OrgOption[];
}) {
	const [isPending, startTransition] = useTransition();

	if (options.length <= 1) return null;

	function switchTo(option: OrgOption) {
		if (option.id === current.id) return;

		startTransition(async () => {
			const { error } = await authClient.organization.setActive({
				organizationId: option.id,
			});

			if (error) {
				toast.error(error.message ?? "Could not switch workspace.");
				return;
			}

			window.location.assign(`/${option.slug}`);
		});
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" disabled={isPending}>
					{current.name}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				{options.map((option) => (
					<DropdownMenuItem
						key={option.id}
						disabled={option.id === current.id}
						onSelect={() => switchTo(option)}
					>
						{option.name}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
