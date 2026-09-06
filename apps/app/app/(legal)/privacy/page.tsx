import { Link } from "@crm/ui/components/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Privacy Policy",
	description: "How JobSteward accesses, uses, stores, and shares user data.",
};

const sectionClass = "space-y-3";
const headingClass = "font-semibold text-xl tracking-tight";
const listClass = "list-disc space-y-2 pl-6 text-muted-foreground";

export default function PrivacyPage() {
	return (
		<article className="space-y-10 text-[15px]/7">
			<header className="space-y-3 border-border border-b pb-8">
				<p className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
					JobSteward
				</p>
				<h1 className="font-semibold text-4xl tracking-tight">
					Privacy Policy
				</h1>
				<p className="text-muted-foreground">Effective September 6, 2026</p>
			</header>

			<section className={sectionClass}>
				<h2 className={headingClass}>Who we are</h2>
				<p className="text-muted-foreground">
					JobSteward is an agentic customer relationship management service
					operated by Majestic Labs. This policy explains how JobSteward handles
					personal information and Google user data.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Information we collect</h2>
				<ul className={listClass}>
					<li>
						Account information, such as your name, email address, profile
						image, and authentication identifiers.
					</li>
					<li>
						CRM information that you or your workspace adds, such as contacts,
						companies, deals, notes, settings, and agent instructions.
					</li>
					<li>
						Service information, such as session, security, error, and usage
						records needed to operate and protect JobSteward.
					</li>
				</ul>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Google user data</h2>
				<p className="text-muted-foreground">
					When you connect a Google account, JobSteward requests read-only
					access to Gmail and Google Calendar. Depending on the access you
					grant, this can include email messages, threads, message metadata and
					settings, and calendar names, events, times, attendees, descriptions,
					locations, and conference links. JobSteward also receives your basic
					Google profile information for sign-in.
				</p>
				<p className="text-muted-foreground">
					JobSteward uses this data to authenticate you, sync email and calendar
					activity into your CRM, match activity to contacts and companies, and
					provide the search and assistant features that your workspace
					requests. JobSteward does not send email, change calendars, or act
					through your Google account with these read-only permissions.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>How we use information</h2>
				<ul className={listClass}>
					<li>Provide, maintain, and secure JobSteward.</li>
					<li>
						Show CRM records and connected account activity to your workspace.
					</li>
					<li>
						Run sync, search, automation, and assistant features that users
						request.
					</li>
					<li>Respond to support requests and comply with applicable law.</li>
				</ul>
				<p className="text-muted-foreground">
					When a workspace user requests an AI feature, JobSteward can send the
					content needed for that request to the AI service selected for the
					workspace. JobSteward does not use Google user data for advertising,
					credit decisions, or to train its own general-purpose AI models.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>How we share information</h2>
				<p className="text-muted-foreground">
					We share information only with authorized workspace members, service
					providers that help us host and operate JobSteward, and authorities
					when required by law or needed to protect the service. A service
					provider can use information only to perform services for us. We do
					not sell personal information or Google user data.
				</p>
				<p className="text-muted-foreground">
					Humans do not read Google user data unless you ask us to inspect
					specific data for support, access is necessary for security, or access
					is required by law.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Google API Limited Use</h2>
				<p className="text-muted-foreground">
					JobSteward&apos;s use and transfer of information received from Google
					APIs follows the{" "}
					<Link href="https://developers.google.com/terms/api-services-user-data-policy">
						Google API Services User Data Policy
					</Link>
					, including the Limited Use requirements.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Storage and security</h2>
				<p className="text-muted-foreground">
					JobSteward stores account credentials and synced CRM data in its
					service database. We use HTTPS, access controls, and managed
					infrastructure to protect data. No method of storage or transmission
					is completely secure.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Retention and deletion</h2>
				<p className="text-muted-foreground">
					We retain information while it is needed to provide JobSteward, meet
					legal duties, resolve disputes, and protect the service. You can
					revoke Google access from JobSteward&apos;s connection settings or
					your Google Account. Revocation stops future access. You can
					separately delete the synced Gmail and Calendar data from
					JobSteward&apos;s connection settings.
				</p>
				<p className="text-muted-foreground">
					To request account or personal data deletion, email{" "}
					<Link href="mailto:support@jobsteward.ai">support@jobsteward.ai</Link>
					.
				</p>
			</section>

			<section className={sectionClass}>
				<h2 className={headingClass}>Changes and contact</h2>
				<p className="text-muted-foreground">
					We can update this policy as JobSteward changes. We will update the
					effective date and give additional notice when a material change
					requires it. Send privacy questions to{" "}
					<Link href="mailto:support@jobsteward.ai">support@jobsteward.ai</Link>
					.
				</p>
			</section>
		</article>
	);
}
