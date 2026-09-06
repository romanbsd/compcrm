import { Link } from "@crm/ui/components/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Terms of Service",
	description: "Terms for using the JobSteward service.",
};

const sectionClass = "space-y-3";
const headingClass = "font-semibold text-xl tracking-tight";
const listClass = "list-disc space-y-2 pl-6 text-muted-foreground";

export default function TermsPage() {
	return (
		<article className="space-y-10 text-[15px]/7">
			<header className="space-y-3 border-border border-b pb-8">
				<p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
					JobSteward
				</p>
				<h1 className="font-semibold text-4xl tracking-tight">
					Terms of Service
				</h1>
				<p className="text-muted-foreground">Effective September 6, 2026</p>
			</header>

			<section className={sectionClass}>
				<h2 className={headingClass}>Agreement</h2>
				<p className="text-muted-foreground">
					These terms govern your use of JobSteward, an agentic customer
					relationship management service operated by Majestic Labs. By using
					JobSteward, you agree to these terms. A separate written agreement
					takes priority if it conflicts with these terms.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Accounts and access</h2>
				<ul className={listClass}>
					<li>You must provide accurate account information.</li>
					<li>You are responsible for activity through your account.</li>
					<li>
						You must protect your account and tell us about unauthorized access.
					</li>
					<li>
						You must have authority to add data and connect third-party
						accounts.
					</li>
				</ul>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Connected services</h2>
				<p className="text-muted-foreground">
					You can authorize JobSteward to read data from services such as Google
					Gmail and Google Calendar. Your use of those services remains subject
					to the provider&apos;s terms. You can revoke access at any time. Some
					JobSteward features will stop working after you revoke access.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Your data</h2>
				<p className="text-muted-foreground">
					You keep your rights to the information that you provide. You give
					Majestic Labs permission to host, process, copy, and transmit that
					information only as needed to provide, secure, and support JobSteward.
					You are responsible for the accuracy and legality of your data and for
					giving required notices to other people whose information you add.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Acceptable use</h2>
				<p className="text-muted-foreground">You must not:</p>
				<ul className={listClass}>
					<li>
						Use JobSteward to break a law or another person&apos;s rights.
					</li>
					<li>Access an account, workspace, or data without permission.</li>
					<li>Interfere with the service or bypass its security controls.</li>
					<li>
						Upload malware or use JobSteward to send abusive or deceptive
						content.
					</li>
					<li>Resell the service unless Majestic Labs agrees in writing.</li>
				</ul>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Service changes</h2>
				<p className="text-muted-foreground">
					We can change, suspend, or discontinue a feature. We aim to keep
					JobSteward available, but we do not promise uninterrupted or
					error-free operation. We can limit or suspend access when needed to
					protect users, the service, or other people.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Warranty and liability</h2>
				<p className="text-muted-foreground">
					JobSteward is provided as available. To the extent permitted by law,
					Majestic Labs disclaims implied warranties and is not liable for
					indirect, incidental, special, consequential, or punitive damages, or
					for lost profits, revenue, data, or business opportunities. These
					limits do not apply where the law does not allow them.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Ending use</h2>
				<p className="text-muted-foreground">
					You can stop using JobSteward at any time. To request account
					deletion, email{" "}
					<Link href="mailto:support@jobsteward.ai">support@jobsteward.ai</Link>
					. Terms that must continue by their nature, including ownership,
					warranty, and liability terms, continue after access ends.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Changes and contact</h2>
				<p className="text-muted-foreground">
					We can update these terms. We will update the effective date and give
					additional notice when required. Send questions about these terms to{" "}
					<Link href="mailto:support@jobsteward.ai">support@jobsteward.ai</Link>
					.
				</p>
			</section>
		</article>
	);
}
