-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "TokenStandard" AS ENUM ('ERC20', 'ERC721', 'ERC1155');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('NATIVE', 'ERC20', 'ERC721', 'ERC1155');

-- CreateEnum
CREATE TYPE "BombardMode" AS ENUM ('CLIENT_SIGNED', 'RELAYER');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'BROADCAST', 'CONFIRMING', 'SUCCESS', 'FAILED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Network" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "rpcUrl" TEXT NOT NULL,
    "wsUrl" TEXT,
    "explorerBaseUrl" TEXT,
    "nativeSymbol" TEXT NOT NULL DEFAULT 'ETH',
    "nativeDecimals" INTEGER NOT NULL DEFAULT 18,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isArchival" BOOLEAN NOT NULL DEFAULT false,
    "faucetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "faucetDripAmount" TEXT NOT NULL DEFAULT '5000000000000000000',
    "faucetDailyCap" TEXT NOT NULL DEFAULT '500000000000000000000',
    "faucetCooldownSec" INTEGER NOT NULL DEFAULT 86400,
    "faucetSignerRef" TEXT,
    "relayerSignerRef" TEXT,
    "paymasterAddress" TEXT,
    "entryPointAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keypair" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encryptedKeystore" JSONB,
    "isEphemeral" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keypair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "standard" "TokenStandard" NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "features" JSONB NOT NULL,
    "initialSupply" TEXT,
    "baseUri" TEXT,
    "txHash" TEXT,
    "contractAddress" TEXT,
    "blockNumber" BIGINT,
    "gasUsed" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "tokenAddress" TEXT,
    "tokenId" TEXT,
    "amount" TEXT,
    "sponsored" BOOLEAN NOT NULL DEFAULT false,
    "txHash" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BombardRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "mode" "BombardMode" NOT NULL DEFAULT 'CLIENT_SIGNED',
    "targetTps" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BombardRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BombardEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "txHash" TEXT,
    "nonce" INTEGER,
    "status" "TxStatus" NOT NULL,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BombardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "attachmentKey" TEXT,
    "senderAddress" TEXT NOT NULL,
    "txHash" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaucetRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "networkId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "ip" TEXT,
    "txHash" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaucetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerAddress" TEXT NOT NULL,
    "accountAddress" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "factory" TEXT,
    "isDeployed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Network_chainId_name_key" ON "Network"("chainId", "name");

-- CreateIndex
CREATE INDEX "Keypair_userId_idx" ON "Keypair"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Keypair_userId_address_key" ON "Keypair"("userId", "address");

-- CreateIndex
CREATE INDEX "Deployment_userId_idx" ON "Deployment"("userId");

-- CreateIndex
CREATE INDEX "Deployment_networkId_idx" ON "Deployment"("networkId");

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");

-- CreateIndex
CREATE INDEX "Transfer_userId_idx" ON "Transfer"("userId");

-- CreateIndex
CREATE INDEX "Transfer_networkId_idx" ON "Transfer"("networkId");

-- CreateIndex
CREATE INDEX "Transfer_status_idx" ON "Transfer"("status");

-- CreateIndex
CREATE INDEX "BombardRun_userId_idx" ON "BombardRun"("userId");

-- CreateIndex
CREATE INDEX "BombardRun_status_idx" ON "BombardRun"("status");

-- CreateIndex
CREATE INDEX "BombardEvent_runId_idx" ON "BombardEvent"("runId");

-- CreateIndex
CREATE INDEX "ChatMessage_networkId_idx" ON "ChatMessage"("networkId");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_idx" ON "ChatMessage"("userId");

-- CreateIndex
CREATE INDEX "FaucetRequest_toAddress_idx" ON "FaucetRequest"("toAddress");

-- CreateIndex
CREATE INDEX "FaucetRequest_networkId_idx" ON "FaucetRequest"("networkId");

-- CreateIndex
CREATE INDEX "FaucetRequest_createdAt_idx" ON "FaucetRequest"("createdAt");

-- CreateIndex
CREATE INDEX "SmartAccount_userId_idx" ON "SmartAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SmartAccount_networkId_accountAddress_key" ON "SmartAccount"("networkId", "accountAddress");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keypair" ADD CONSTRAINT "Keypair_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BombardRun" ADD CONSTRAINT "BombardRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BombardRun" ADD CONSTRAINT "BombardRun_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BombardEvent" ADD CONSTRAINT "BombardEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BombardRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaucetRequest" ADD CONSTRAINT "FaucetRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaucetRequest" ADD CONSTRAINT "FaucetRequest_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
