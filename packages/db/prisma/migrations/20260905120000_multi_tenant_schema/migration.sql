INSERT INTO "organization" ("id", "name", "slug", "createdAt")
VALUES ('workspace', 'Workspace', 'workspace', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "company" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "contact" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "deal" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "dealContact" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "activity" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "fieldDefinition" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "fieldOption" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "fieldValue" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "companyEnrichment" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "contactFact" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "contactBrief" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentTask" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentEvent" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentConversation" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentConversationFeedback" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentConversationShare" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentConversationSubmission" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentConversationAttachment" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentDefinition" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentVersion" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentBuilderArtifact" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentTrigger" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentRun" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentRunEvent" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentAction" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "agentAuditEvent" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "mailboxSync" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "emailThread" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "emailMessage" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "calendarEvent" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "calendarAttendee" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "slackInstallation" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "slackWorkspaceGrant" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "slackChannel" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "slackMemberMatch" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "trackedDomain" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "trackedVisitor" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "trackedEvent" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "trackingCounter" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "trackedPageDaily" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "formSubmission" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "savedView" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "suppressedDomain" DROP CONSTRAINT "suppressedDomain_pkey";
ALTER TABLE "suppressedDomain" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "suppressedDomain" ADD CONSTRAINT "suppressedDomain_pkey" PRIMARY KEY ("organizationId", "domain");
ALTER TABLE "suppressedContact" DROP CONSTRAINT "suppressedContact_pkey";
ALTER TABLE "suppressedContact" ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE "suppressedContact" ADD CONSTRAINT "suppressedContact_pkey" PRIMARY KEY ("organizationId", "email");
ALTER TABLE "trackedPageDaily" DROP CONSTRAINT "trackedPageDaily_pkey";
ALTER TABLE "trackedPageDaily" ADD CONSTRAINT "trackedPageDaily_pkey" PRIMARY KEY ("organizationId", "day", "host", "path");
ALTER TABLE "appSetting" RENAME COLUMN "id" TO "organizationId";
UPDATE "appSetting" SET "organizationId" = 'workspace' WHERE "organizationId" = 'app';
ALTER TABLE "workspaceProfile" RENAME COLUMN "id" TO "organizationId";
UPDATE "workspaceProfile" SET "organizationId" = 'workspace';
DROP INDEX "company_domain_active_key";
DROP INDEX "contact_email_active_key";
DROP INDEX "fieldDefinition_entity_key_key";
DROP INDEX "trackedDomain_host_key";
DROP INDEX "savedView_entity_ownerId_name_key";
CREATE UNIQUE INDEX "company_organization_domain_active_key" ON "company"("organizationId", "domain") WHERE ("archivedAt" IS NULL);
CREATE UNIQUE INDEX "contact_organization_email_active_key" ON "contact"("organizationId", "email") WHERE ("archivedAt" IS NULL);
CREATE UNIQUE INDEX "fieldDefinition_organizationId_entity_key_key" ON "fieldDefinition"("organizationId", "entity", "key");
CREATE UNIQUE INDEX "trackedDomain_organizationId_host_key" ON "trackedDomain"("organizationId", "host");
CREATE UNIQUE INDEX "savedView_organizationId_entity_ownerId_name_key" ON "savedView"("organizationId", "entity", "ownerId", "name");

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'company', 'contact', 'deal', 'dealContact', 'activity', 'fieldDefinition', 'fieldOption', 'fieldValue',
    'companyEnrichment', 'contactFact', 'contactBrief', 'agentTask', 'agentEvent', 'agentConversation',
    'agentConversationFeedback', 'agentConversationShare', 'agentConversationSubmission', 'agentConversationAttachment',
    'agentDefinition', 'agentVersion', 'agentBuilderArtifact', 'agentTrigger', 'agentRun', 'agentRunEvent',
    'agentAction', 'agentAuditEvent', 'mailboxSync', 'emailThread', 'emailMessage', 'calendarEvent',
    'calendarAttendee', 'slackInstallation', 'slackWorkspaceGrant', 'slackChannel', 'slackMemberMatch',
    'trackedDomain', 'trackedVisitor', 'trackedEvent', 'trackingCounter', 'trackedPageDaily', 'formSubmission', 'savedView',
    'suppressedDomain', 'suppressedContact'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "organizationId" DROP DEFAULT', table_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE', table_name, table_name || '_organizationId_fkey');
  END LOOP;
END $$;

ALTER TABLE "appSetting" ADD CONSTRAINT "appSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspaceProfile" ADD CONSTRAINT "workspaceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'company', 'contact', 'deal', 'dealContact', 'activity', 'fieldDefinition', 'fieldOption', 'fieldValue',
    'companyEnrichment', 'contactFact', 'contactBrief', 'agentTask', 'agentEvent', 'agentConversation',
    'agentConversationFeedback', 'agentConversationShare', 'agentConversationSubmission', 'agentConversationAttachment',
    'agentDefinition', 'agentVersion', 'agentBuilderArtifact', 'agentTrigger', 'agentRun', 'agentRunEvent',
    'agentAction', 'agentAuditEvent', 'mailboxSync', 'emailThread', 'emailMessage', 'calendarEvent',
    'calendarAttendee', 'slackChannel', 'slackMemberMatch', 'trackedDomain', 'trackedVisitor',
    'trackedEvent', 'formSubmission', 'savedView'
  ]
  LOOP
    EXECUTE format('CREATE INDEX %I ON %I ("organizationId")', table_name || '_organizationId_idx', table_name);
  END LOOP;
END $$;

ALTER TABLE "trackingCounter" DROP CONSTRAINT "trackingCounter_pkey";
ALTER TABLE "trackingCounter" ADD CONSTRAINT "trackingCounter_pkey" PRIMARY KEY ("organizationId", "key");

DROP INDEX "mailboxSync_userId_source_key";
CREATE UNIQUE INDEX "mailboxSync_organizationId_userId_source_key" ON "mailboxSync"("organizationId", "userId", "source");

ALTER TABLE "ssoProvider" ALTER COLUMN "organizationId" SET DEFAULT 'workspace';
UPDATE "ssoProvider" SET "organizationId" = 'workspace' WHERE "organizationId" IS NULL;
ALTER TABLE "ssoProvider" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ssoProvider" ALTER COLUMN "organizationId" DROP DEFAULT;

CREATE INDEX "ssoProvider_organizationId_idx" ON "ssoProvider"("organizationId");

ALTER TABLE "ssoProvider" ADD CONSTRAINT "ssoProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "apikey" DROP CONSTRAINT "apikey_referenceId_fkey";

WITH "resolved" AS (
  SELECT
    "apikey"."id",
    "apikey"."referenceId" AS "userId",
    (
      SELECT "member"."organizationId"
      FROM "member"
      WHERE "member"."userId" = "apikey"."referenceId"
      ORDER BY "member"."createdAt" ASC, "member"."id" ASC
      LIMIT 1
    ) AS "organizationId"
  FROM "apikey"
)
UPDATE "apikey"
SET
  "referenceId" = "resolved"."organizationId",
  "metadata" = jsonb_build_object(
    'createdByUserId',
    "resolved"."userId"
  )::text
FROM "resolved"
WHERE "apikey"."id" = "resolved"."id"
  AND "resolved"."organizationId" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "apikey"
    LEFT JOIN "organization"
      ON "organization"."id" = "apikey"."referenceId"
    WHERE "organization"."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Every API key creator must belong to an organization';
  END IF;
END $$;

ALTER TABLE "apikey"
ADD CONSTRAINT "apikey_referenceId_fkey"
FOREIGN KEY ("referenceId") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slackInstallation"
ADD COLUMN "botToken" TEXT,
ADD COLUMN "botScopes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "slackWorkspaceGrant"
ADD COLUMN "botToken" TEXT,
ADD COLUMN "botScopes" TEXT NOT NULL DEFAULT '';

WITH "latestSlackAccount" AS (
  SELECT "accessToken", COALESCE("scope", '') AS "scope"
  FROM "account"
  WHERE "providerId" = 'slack' AND "accessToken" IS NOT NULL
  ORDER BY "updatedAt" DESC
  LIMIT 1
)
UPDATE "slackWorkspaceGrant"
SET
  "botToken" = "latestSlackAccount"."accessToken",
  "botScopes" = "latestSlackAccount"."scope"
FROM "latestSlackAccount"
WHERE "slackWorkspaceGrant"."botToken" IS NULL;

DO $$
DECLARE
	tbl text;
BEGIN
	FOREACH tbl IN ARRAY ARRAY[
		'company',
		'contact',
		'deal',
		'dealContact',
		'activity',
		'fieldDefinition',
		'fieldOption',
		'fieldValue',
		'companyEnrichment',
		'contactFact',
		'contactBrief',
		'agentTask',
		'agentEvent',
		'agentConversation',
		'agentConversationFeedback',
		'agentConversationShare',
		'agentConversationSubmission',
		'agentConversationAttachment',
		'agentDefinition',
		'agentVersion',
		'agentBuilderArtifact',
		'agentTrigger',
		'agentRun',
		'agentRunEvent',
		'agentAction',
		'agentAuditEvent',
		'mailboxSync',
		'emailThread',
		'emailMessage',
		'calendarEvent',
		'calendarAttendee',
		'appSetting',
		'workspaceProfile',
		'ssoProvider',
		'slackInstallation',
		'slackWorkspaceGrant',
		'slackChannel',
		'slackMemberMatch',
		'trackedDomain',
		'trackedVisitor',
		'trackedEvent',
		'trackedPageDaily',
		'formSubmission',
		'trackingCounter',
		'suppressedDomain',
		'suppressedContact',
		'savedView'
	]
	LOOP
		EXECUTE format(
			'ALTER TABLE %I ALTER COLUMN "organizationId" SET DEFAULT current_setting(''app.current_organization_id''::text, true)',
			tbl
		);
		EXECUTE format(
			'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.current_organization_id''::text, true)) WITH CHECK ("organizationId" = current_setting(''app.current_organization_id''::text, true))',
			tbl
		);
		EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
		EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
	END LOOP;
END $$;

DROP INDEX "slackWorkspaceGrant_teamId_key";

ALTER TABLE "slackInstallation"
DROP CONSTRAINT "slackInstallation_pkey",
ADD CONSTRAINT "slackInstallation_pkey" PRIMARY KEY ("organizationId", "installerId");

CREATE UNIQUE INDEX "slackWorkspaceGrant_organizationId_teamId_key"
ON "slackWorkspaceGrant"("organizationId", "teamId");

CREATE TABLE "trackingSiteLocator" (
    "siteId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "trackingSiteLocator_pkey" PRIMARY KEY ("siteId")
);

CREATE UNIQUE INDEX "trackingSiteLocator_organizationId_key"
ON "trackingSiteLocator"("organizationId");

ALTER TABLE "trackingSiteLocator"
ADD CONSTRAINT "trackingSiteLocator_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "trackingSiteLocator" ("siteId", "organizationId")
SELECT "trackingSiteId", "organizationId"
FROM "appSetting"
WHERE "trackingSiteId" IS NOT NULL;

CREATE TABLE "ssoProviderLocator" (
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,

    CONSTRAINT "ssoProviderLocator_pkey" PRIMARY KEY ("providerId")
);

CREATE INDEX "ssoProviderLocator_organizationId_idx"
ON "ssoProviderLocator"("organizationId");

ALTER TABLE "ssoProviderLocator"
ADD CONSTRAINT "ssoProviderLocator_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "ssoProvider"("providerId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ssoProviderLocator"
ADD CONSTRAINT "ssoProviderLocator_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ssoProviderLocator" ("providerId", "organizationId", "domain")
SELECT "providerId", "organizationId", "domain"
FROM "ssoProvider";

CREATE FUNCTION "syncSsoProviderLocator"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO "ssoProviderLocator" ("providerId", "organizationId", "domain")
    VALUES (NEW."providerId", NEW."organizationId", NEW."domain")
    ON CONFLICT ("providerId") DO UPDATE
    SET "organizationId" = EXCLUDED."organizationId",
        "domain" = EXCLUDED."domain";
    RETURN NEW;
END;
$$;

CREATE TRIGGER "ssoProviderLocatorSync"
AFTER INSERT OR UPDATE OF "providerId", "organizationId", "domain"
ON "ssoProvider"
FOR EACH ROW
EXECUTE FUNCTION "syncSsoProviderLocator"();
