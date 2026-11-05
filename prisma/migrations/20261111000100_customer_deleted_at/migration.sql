-- Account deletion (Google Play "account deletion" policy, privacy law): the customer asks for the account to be deleted. Personal data is erased by the
-- application (src/modules/miniapp/account-deletion.ts); the Customer row itself stays, because orders, payments, refunds and the commission ledger reference it.
-- deletedAt records when. Additive and nullable: nothing existing changes.
ALTER TABLE "Customer" ADD COLUMN "deletedAt" TIMESTAMPTZ(3);
