# Temporary Gmail sending policy

All MTOS outbound email paths now use the Gmail connection stored for the initiating user: confirmation, agenda, recap, no-show/Loom updates and existing notification digests. The shared transport is `src/lib/server/gmail-transport.ts`; client content validation remains in `client-email-service.ts`. New sends never use Intercom. Historical Intercom receipts and read-only recovery remain supported.

## Shared support sender and Hiver

Every message explicitly sets `From` and `Reply-To` to `support@mapranking.com`. MTOS checks the connected account's Gmail send-as identities and requires the support address to be primary or verified (`accepted`). If it is absent/pending, sending stops with setup instructions. There is no personal-address fallback, tenant-token fallback, or use of the old sender override preference.

Hiver documents its shared sender in terms of Gmail's Send mail as identity: [Hiver sender setup](https://help.hiverhq.com/individual-setup/sender-id). MTOS uses that Gmail identity through the API; it does not execute the browser add-on or claim to have configured Hiver. [Hiver sent-mail visibility](https://help.hiverhq.com/managing-conversations/view-sent-emails) also depends on the verified identity and Hiver's sender settings. Actual Hiver synchronization/assignment is not confirmed by Gmail acceptance and was not tested against a live account.

Gmail's existing `gmail.readonly` + `gmail.send` consent supports alias verification, sending and sent-mail reconciliation. Sources: [send-as listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs/list), [alias verification status](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.sendAs), [message sending and CC headers](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [sent-message lookup](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

## Behavior and safeguards

- Explicit client email approval and existing signatures remain in place. HTML, links, Unicode and CC recipients are preserved with UTF-8 MIME encoding. Internal notification opt-ins remain unchanged.
- Tokens come from the user's existing scoped Gmail connection. Expired tokens refresh; a definite 401 can refresh/retry. Network failures and 5xx send responses do not trigger a blind second POST.
- A transactional per-user delivery ledger records the approved message fingerprint, deterministic RFC Message-ID, provider receipt and state. Retries recover an existing sent message using its Message-ID and matching headers. Gmail message/thread IDs are stored separately from old Intercom conversation IDs.
- A Gmail receipt establishes provider acceptance, not recipient inbox delivery or Hiver synchronization. An ambiguous result remains protected until it can be reconciled. Regeneration/reapproval of an unresolved confirmation is blocked.
- Client-facing unfinished-task restrictions remain active. Internal notification content can still describe team tasks.
- The legacy sender override remains saved for compatibility but is temporarily absent from Settings; the connected Gmail account determines the sending account. No Gmail/Hiver account settings were changed by this code update.

## Validation

Full project validation passed: Next.js route type generation, TypeScript and ESLint.

`npm run check:gmail-transport` uses synthetic accounts, in-memory Firestore and intercepted network requests. It covers a verified shared sender, missing/pending aliases, missing scopes/disconnected accounts, UTF-8/HTML/plain-text MIME, CC, expired-token refresh, user isolation, repeated/concurrent sends, safe refusal retry, lost-response recovery, content validation and header injection.

No-show orchestration checks cover Gmail IDs and historical Intercom reconciliation. Isolated browser checks cover the screenshot's agenda sender/CC/approval interaction and Loom recovery controls. Regression checks pass for approval, prep workflow, user preferences, notifications, agenda/recap emails, Follow-Through finish and integration permissions.

No real email was sent. Deployment, each user's live alias configuration, recipient delivery and Hiver synchronization have not been verified. After deployment, users need their own connected Gmail account with send/read consent and the verified support identity described above.
