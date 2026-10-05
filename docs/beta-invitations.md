# Invitation-only artist workspaces

New artists sign in with Google first, then enter an invitation on `/join` to
activate their private workspace. Email/password registration follows the same
activation boundary. Existing artists retain access, and activated accounts do
not need a new code when signing in again or using another device.

## Administration

Set `TINTA_ADMIN_USER_ID` privately to the verified, active operator account's
existing `User.id`. The value is not an email or display name. An unset or invalid
value grants nobody access. No first-signup administrator or client-editable role
exists. Every admin page, data read and invitation mutation checks the current
database identity. Registration, email/name changes and another artist named Kim
cannot grant administrator access.

Enable `REQUIRE_INVITATION=true` for the private beta. `DISABLE_SIGN_UP=true`
instead closes all new Google/password registration. Existing accounts still
sign in. `STUDIO_OWNER_EMAIL` is a separate installation-wide restriction and
must stay blank for independent invited artists.

The admin link opens `/admin`, with Invitations, Artists and Reports:

- Create a single-use code lasting 1–30 days (seven by default). Copy the code or
  link immediately; the server stores a SHA-256 hash, never the raw code. The
  readable code carries 128 random bits. A link uses a fragment, which is not
  sent in HTTP requests or Google callbacks. Same-tab session storage preserves
  it for at most thirty minutes; activation, sign-out or account changes clear it.
- Revoke an unused invitation. Atomic guarded updates let only activation or
  revocation win a race. An already activated artist keeps access after the
  invitation is used. Expired, revoked or used codes share a generic failure.
- See registration/activation, last sign-in, aggregate record totals and the last
  client/design/appointment change date. A sign-in is not a page visit; session
  refreshes are not sign-ins. Totals are stored records, not audience analytics.
  No client contacts, notes, artwork files, bank details or user impersonation
  are exposed by the panel. Artists paginate fifty at a time.
- Review the latest fifty explicitly submitted reports within thirty days:
  account, page, reported/received time, device category, release and reference.
  Text is escaped. Read errors display unavailable, never a false empty state.
  The intake endpoints do not become public log readers.

No new browser tracking or analytics cookies are added. Optional diagnostics
remain default-off and unavailable until the public notice has verified operator
facts. Reports and necessary account administration remain separate. The privacy
notice describes these admin fields; its missing legal/operator facts are still
pending, not invented.

## Activation and privacy

The session boundary re-reads `activatedAt` from PostgreSQL on every workspace
request. Pending identities can only authenticate, activate and manage their own
registration privacy; opening a workspace page redirects to `/join`, while its
private APIs reject access. Activation and account erasure take the same user
lock. Two artists cannot redeem one code. Repeat activation by an active artist
does not consume a second invitation.

Five bounded attempts per account are allowed in fifteen minutes, across its
devices and sessions. The counter lives in PostgreSQL, resets on a later attempt
after the window, and disappears on activation or account erasure. It stores no
network address or device data. Invitation history is deleted thirty days after
redemption, revocation or unused expiry during normal privacy maintenance. Account
erasure removes the personal creator/redeemer links; own exports include safe
invitation metadata without code hashes or anyone else's identity.

## Release and recovery

The additive migration backfills existing artists' activation from their account
creation date. Future invitation-gated authentication explicitly writes NULL
until redemption; no existing records, sessions or artist IDs are reset.

Take and verify the usual matched database/artwork backup before applying the
migration and replacing the app. Preserve the existing auth secret and providers.
After a release, verify the configured operator is active/verified, anonymous
admin access is denied, new registration is pending, and activation succeeds with
a disposable invitation/account. Erase QA identities and revoke unused QA codes.

An older app image does not enforce activation. If emergency rollback is needed,
close new registration in the restored configuration, revoke sessions belonging
to pending identities, and enforce a temporary database session-insert guard for
those pending identities before serving the old image. Active artists may keep
using their workspaces. Never restore an older open-registration image while
pending identities can obtain sessions. Remove only the temporary guard when
the new activation-aware app is verified healthy again. Do not reset live data or
restore a database snapshot just to reverse this additive release.

Verification covers actual Better Auth Google callback handling with locally
signed identities/mock Google transport, password activation, API/page access,
code races/expiry/revocation, shared limits, privacy erasure/export, aggregate-only
stats and English/Spanish layouts at 360px/1440px. This does not simulate Google's
real consent screen or send any invitations/messages for the operator.
