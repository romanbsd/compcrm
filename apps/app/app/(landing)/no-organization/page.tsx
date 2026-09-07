import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { SignOutButton } from "./sign-out-button";

export default function NoOrganizationPage() {
	return (
		<div className="flex h-svh items-center justify-center p-6">
			<Card className="max-w-sm">
				<CardHeader>
					<CardTitle>You are not part of a workspace yet</CardTitle>
					<CardDescription>
						An admin must add you to an organization before you can use the CRM.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<SignOutButton />
				</CardContent>
			</Card>
		</div>
	);
}
