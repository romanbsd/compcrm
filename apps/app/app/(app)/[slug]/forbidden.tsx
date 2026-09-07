import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";

export default function Forbidden() {
	return (
		<div className="flex h-svh items-center justify-center p-6">
			<Card className="max-w-sm">
				<CardHeader>
					<CardTitle>You do not have access to this workspace</CardTitle>
					<CardDescription>
						You do not have access to this workspace. Ask an admin of this
						organization to add you, or switch to a workspace you already have
						access to.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button asChild>
						<a href="/sign-in">Back to sign in</a>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
