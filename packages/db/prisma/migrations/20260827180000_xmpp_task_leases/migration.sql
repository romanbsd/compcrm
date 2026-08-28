ALTER TABLE "xmppAgentTask"
ADD COLUMN "ownerId" TEXT,
ADD COLUMN "leaseUntil" TIMESTAMP(3);

CREATE INDEX "xmppAgentTask_organizationId_state_leaseUntil_idx"
ON "xmppAgentTask"("organizationId", "state", "leaseUntil");
