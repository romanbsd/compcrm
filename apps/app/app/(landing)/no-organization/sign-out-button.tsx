"use client";

import { Button } from "@crm/ui/components/button";
import { toast } from "sonner";
import { signOutAndRedirect } from "@/lib/sign-out";

export function SignOutButton() {
	return (
		<Button
			onClick={() => {
				signOutAndRedirect().catch(() => toast.error("Could not sign out."));
			}}
		>
			Sign out
		</Button>
	);
}
