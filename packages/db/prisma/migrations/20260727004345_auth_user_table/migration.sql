-- Tabela de usuários do módulo de auth (criada originalmente via db push pela
-- sessão que adicionou JWT/bcrypt; esta migração regulariza o histórico e é
-- marcada como aplicada nos bancos que já a têm).
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'member');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
