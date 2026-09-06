import Link from "next/link";
import type { ReactNode } from "react";
import { LandingNav } from "@/components/landing/landing-nav";

export default function LegalLayout({ children }: { children: ReactNode }) {
	return (
		<div className="dark flex min-h-svh flex-col bg-background text-foreground">
			<LandingNav />
			<main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 sm:py-16">
				{children}
			</main>
			<footer className="border-border border-t">
				<nav className="mx-auto flex w-full max-w-3xl flex-wrap gap-5 px-6 py-6 text-muted-foreground text-sm">
					<Link className="hover:text-foreground" href="/">
						JobSteward
					</Link>
					<Link className="hover:text-foreground" href="/privacy">
						Privacy
					</Link>
					<Link className="hover:text-foreground" href="/terms">
						Terms
					</Link>
				</nav>
			</footer>
		</div>
	);
}
