# Debug Session: firebase-signup-error [OPEN]

## Symptom
- User cannot sign up on `/sign-up`.
- UI shows: `Firebase: Error (auth/configuration-not-found).`

## Falsifiable Hypotheses
1. Email/password sign-in is not enabled in the Firebase project tied to the current web config.
2. The app is pointed at the wrong Firebase web project via `NEXT_PUBLIC_FIREBASE_*` values.
3. The Firebase web app config is incomplete, causing client auth initialization to succeed partially but fail on account creation.
4. The signup failure happens before the MTOS API route, so the bug is in Firebase client setup rather than server-side tenant assignment logic.
5. There is a mismatch between the Firebase Auth project and the Firebase Admin project, causing signup/login flows to target different backends.

## Evidence To Collect
- Whether all required `NEXT_PUBLIC_FIREBASE_*` vars are present.
- Whether the runtime error occurs before `/api/auth/firebase-signup` is called.
- Whether the Firebase project has Email/Password auth enabled.
