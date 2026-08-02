# Google sign-in branding

**No code change can rename Google's consent screen.** That heading is rendered
by Google from your Google Cloud project's configuration. ArchiveScout can't
influence it, and any fix is dashboard-only.

Today it reads:

```
Sign in to rpqyxdtpgdghqrcizzwt.supabase.co
```

---

## What controls what

| Element | Controlled by |
| --- | --- |
| The app **name**, logo, support email, links | Google Cloud → **Branding** |
| The **host shown in the heading / "Google will allow … to access"** | The OAuth **redirect URI's host** — i.e. your Supabase project domain |
| Scopes listed on the screen | Google Cloud → Branding → Data access |
| The "unverified app" warning | Google's verification status |

This split is the crux: **Branding fills in the name; the redirect host fills
in the domain.** Setting a name usually replaces the heading, but Google keeps
showing the raw host in the permissions sentence, because that host is who the
token is actually issued to. Only a custom auth domain changes the host.

---

## 1. Set the branding (free — do this first)

<https://console.cloud.google.com> → **Google Auth Platform → Branding**
(older console: **APIs & Services → OAuth consent screen**).

| Field | Value |
| --- | --- |
| App name | `ArchiveScout` |
| User support email | your address |
| App logo | 120×120 PNG, optional — triggers Google verification if set |
| Application home page | `https://archivescout.vercel.app` |
| Privacy policy | `https://archivescout.vercel.app/privacy` |
| Terms of service | `https://archivescout.vercel.app/terms` |
| Authorized domains | `vercel.app` (add your own domain when you have one) |
| Developer contact | your address |

Save.

> Adding a **logo** or publishing to Production pushes the app into Google's
> verification queue (days to weeks). While in **Testing** with no logo, sign-in
> works immediately for accounts listed under **Audience → Test users**.

## 2. Leave the OAuth client alone

The redirect URI must stay exactly:

```
https://rpqyxdtpgdghqrcizzwt.supabase.co/auth/v1/callback
```

Changing it breaks the working flow with `redirect_uri_mismatch`. ArchiveScout's
own `/auth/callback` is a *Supabase* redirect target, configured in Supabase —
it never belongs in the Google Console.

## 3. Verify in an incognito window

Google caches consent aggressively; a normal window will keep showing the old
screen and make a correct change look broken.

1. Open a **new incognito/private window** (⌘⇧N)
2. Go to `http://localhost:3000/signin`
3. **Continue with Google**
4. Read the heading

Expected: `Sign in to ArchiveScout`, with the permissions sentence still
naming `rpqyxdtpgdghqrcizzwt.supabase.co`.

If it still shows the host everywhere, wait a few minutes (propagation) and
retry in a fresh incognito window before changing anything else.

---

## When you'd need a custom Supabase auth domain

Only if you want the **host itself** gone — i.e. `auth.archivescout.com`
instead of `<ref>.supabase.co` in the permissions line.

That requires:

- a domain you own,
- Supabase's **Custom Domains** add-on (a paid feature), and
- updating the Google redirect URI to `https://auth.archivescout.com/auth/v1/callback`.

Not worth it before launch. The free branding step gets you the name; the paid
step only removes a technical-looking hostname most users don't read.
