# Debug Session: login-auth-failure

Status: [OPEN]

## Symptom
The application is not allowing login.

## Session ID
login-auth-failure

## Initial hypotheses
1. Login request is failing because auth environment variables or callback URLs are misconfigured.
2. Login form submits successfully but the server rejects credentials/session creation.
3. Client-side auth state is not being refreshed or persisted after successful login.
4. Middleware/route protection is redirecting authenticated users back to login.
5. A runtime/build error in the auth flow prevents the login action from completing.

## Evidence log
Pre-fix debug logs showed:
- Auth route was reached successfully.
- SESSION_COOKIE_SECRET was present.
- Active tenant was `tenant-map-ranking-demo`.
- Login body parsed successfully.
- Existing user lookup succeeded during browser sign-in attempts.
- Password verification returned `ok: false`, producing `401 Invalid email or password`.

Conclusion: the login transport/session code was working; the lockout was caused by stale or mismatched stored credentials.

## Fix log
Updated the admin force-reset flow so it now generates a new temporary password, stores its hash/salt, clears disabled state, keeps `mustResetPassword` true, and returns the temporary password to the Team UI. Also suppressed the expected root `<html data-theme>` hydration warning caused by the pre-hydration theme script.
