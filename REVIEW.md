# Still to do

What a full-codebase review on 2026-09-20 turned up and left standing. Everything
else it found was fixed in the commit that added this file; what is here is only
the work that remains, with the reason each was not done at the time.

## Left open

- [ ] **`src/shared/types/romm.ts:17,20,74,75` and `Credentials.expiresAt`.**
      `token_type`, `refresh_expires`, `oauth_scopes` and `avatar_path` have no
      reader, and being non-optional they force `test/app/server.ts` and
      `dev/bridge.ts` to invent values; `expiresAt` is written three ways and never
      read, the client refreshing reactively on a 401, so `Date.parse` there can only
      ever persist `NaN`. `oauth_scopes` is the one worth keeping rather than
      deleting — it is what would let sign-in check the token it was handed against
      `REQUIRED_SCOPES` and say so, instead of meeting the first 403 at the call site.
