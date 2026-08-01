# Google Sign-In setup (Supabase Auth)

Everything below is dashboard configuration you must complete. ArchiveScout's
code is already wired; without these values the button shows a clear
"provider disabled" error rather than failing silently.

Supabase remains the ONLY identity system — Google is an additional provider
attached to it, not a second auth stack.

---

## 1. Google Cloud Console

<https://console.cloud.google.com/> → create or select a project.

### OAuth consent screen (Branding)

- **User type**: External
- **App name**: ArchiveScout
- **User support email**: your address
- **Authorized domains**: `supabase.co` and `vercel.app` (add your own domain
  if you attach one later)
- **Scopes** — add ONLY these three. They are the identity scopes Supabase
  needs; anything more (Gmail, Drive, Calendar, contacts) is unnecessary and
  triggers Google verification review:
  - `openid`
  - `.../auth/userinfo.email`
  - `.../auth/userinfo.profile`
- While the app is in **Testing**, add your own Google account under
  **Test users** or sign-in will be refused.

### Credentials → Create Credentials → OAuth client ID

- **Application type**: Web application
- **Name**: ArchiveScout Web

**Authorized JavaScript origins**

```
http://localhost:3000
https://archivescout.vercel.app
```

**Authorized redirect URIs** — this is the value people most often get wrong.
It must be **Supabase's** callback, not ArchiveScout's:

```
https://rpqyxdtpgdghqrcizzwt.supabase.co/auth/v1/callback
```

> Google redirects to **Supabase**, which exchanges the Google code and then
> redirects to ArchiveScout's `/auth/callback`. Putting ArchiveScout's route
> here instead produces `redirect_uri_mismatch`.

Copy the **Client ID** and **Client secret**.

---

## 2. Supabase dashboard

### Authentication → Providers → Google

- Toggle **Enable Sign in with Google** on
- **Client ID**: from Google
- **Client Secret**: from Google — this stays server-side in Supabase and is
  never shipped to the browser or committed
- Confirm the **Callback URL** shown matches what you pasted into Google

### Authentication → URL Configuration

- **Site URL**: `http://localhost:3000` for now (change to the production URL
  when you deploy)
- **Redirect URLs** — allow-list ArchiveScout's own callback:

```
http://localhost:3000/auth/callback
https://archivescout.vercel.app/auth/callback
https://*-tylercary9-9304s-projects.vercel.app/auth/callback
```

The third line covers Vercel preview deployments. Supabase refuses to redirect
anywhere not on this list, which is what stops an attacker from bouncing a
session to their own domain.

---

## 3. Verify

```bash
npm run verify:google
```

Checks the provider is enabled and that the callback route validates
destinations. Then sign in through the UI at `/signin`.

---

## Notes

- **No secrets reach the browser.** The Google client secret lives only in
  Supabase. ArchiveScout uses the publishable key, which is safe to expose
  because RLS enforces access.
- **No Google tokens are stored client-side.** Supabase exchanges the code
  server-side and issues its own session cookies.
- **Same-email accounts**: Supabase links identities by verified email when
  "Confirm email" is enabled. Observed behaviour for this project is recorded
  in the final report — do not assume, re-verify if you change auth settings.
