CREATE TYPE "XmppAgentTaskState" AS ENUM ('ACCEPTED', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "xmppAgentTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "callerJid" TEXT NOT NULL,
    "notificationJid" TEXT NOT NULL,
    "targetJid" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "state" "XmppAgentTaskState" NOT NULL DEFAULT 'ACCEPTED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "progress" JSONB,
    "result" JSONB,
    "error" JSONB,
    "summary" TEXT,
    "eveSessionId" TEXT,
    "deadline" TIMESTAMP(3),
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "xmppAgentTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "xmppAgentTask_organizationId_callerJid_targetJid_requestId_key" ON "xmppAgentTask"("organizationId", "callerJid", "targetJid", "requestId");
CREATE INDEX "xmppAgentTask_organizationId_state_updatedAt_idx" ON "xmppAgentTask"("organizationId", "state", "updatedAt");
CREATE INDEX "xmppAgentTask_retainUntil_idx" ON "xmppAgentTask"("retainUntil");

ALTER TABLE "xmppAgentTask" ADD CONSTRAINT "xmppAgentTask_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
