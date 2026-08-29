# Security Hardening Record — HostelGrievance

**Project:** HostelGrievance Pre-Launch Hardening  
**Framework:** GrievanceGuard Architecture  
**Test Suite Status:** 20 / 20 Automated Vitest Cases Passing (100%)  
**Typecheck Status:** 0 Errors, 0 Warnings across SvelteKit & Hono  

---

## 1. Vulnerability Remediation Matrix

| ID | Finding | Risk | Change | Verification | Residual Risk |
|---|---|---|---|---|---|
| **SEC-01** | Broken Object-Level Authorization (IDOR/BOLA) | Any student could view or download grievances belonging to others by guessing IDs. | Replaced inline route logic with `GrievanceGuard.canView()`, enforcing student ownership or warden role. | Automated test verifies cross-student `GET /api/grievances/GRV-0003` returns `403`. | Low; resource enumeration is further thwarted by Threat Monitor auto-ban. |
| **SEC-02** | Broken Function-Level Authorization (Status Tampering) | Students could self-resolve or reopen tickets via `PATCH /api/grievances/:id`. | `GrievanceGuard.canChangeStatus()` explicitly restricts status mutation to `warden` role only. | Student status update test returns `403 Unauthorized`. | Low; enforced at centralized policy layer. |
| **SEC-03** | Insecure Session Lifecycle & Incomplete Invalidation | Tokens persisted forever in DB; logout only cleared client cookies; missing cookie flags. | `destroySession()` executed on logout/password reset; added `HttpOnly`, `SameSite=Lax`, `Secure` flags; expiring tokens. | Re-using session cookie after logout returns `401 Unauthenticated`. | Low; requires client to store session securely in browser cookie jar. |
| **SEC-04** | Overly Permissive CORS Policy with Credentials | Any malicious site could make authenticated requests on behalf of logged-in students. | Restricted CORS to explicit origin whitelist (`localhost:5173`, `localhost:3001`); rejects untrusted origins. | Request with `Origin: https://attacker.com` returns no `Access-Control-Allow-Origin` header. | Low; configurable via `ALLOWED_ORIGINS` environment variable. |
| **SEC-05** | Weak Password Hashing (Unsalted SHA-256) | Leaked database file would allow instant rainbow table cracking of all user accounts. | Implemented salted `scrypt` key derivation (`N=16384, r=8, p=1, keylen=64`) with constant-time verification. | Inspected SQLite records; all hashes stored as `scrypt:<salt>:<hash>`. | Negligible; computational cost exceeds brute-force economics. |
| **SEC-06** | Attachment Filename Preservation & MIME Spoofing | Executable malware could be uploaded by forging the `Content-Type` header as `image/png`. | Added binary magic-byte inspection (`0x89504E47` etc.); randomized disk filenames with UUIDs. | Uploading text/binary mismatch returns `400 Bad Request`. | Low; stored outside web root and never directly executed. |
| **SEC-07** | Missing Rate Limiting on Login (Brute Force) | Attackers could automate high-frequency password guessing against user accounts. | In-memory rate limiter tracks IP + email; locks account for 15 minutes after 10 failures. | 11th consecutive bad login returns `429 Too Many Requests`. | Low; state stored in-memory during single-instance execution. |
| **SEC-08** | Internal Error Message Leakage | Stack traces and SQLite internal table names leaked to client upon uncaught errors. | Global `handleError` catches all non-HTTP exceptions, logs server-side, and returns generic `500`. | Requesting broken route returns `{"error":"Internal server error.","code":"internal"}`. | None; zero internals exposed in response body. |
| **SEC-09** | Content-Disposition Header Injection | Filenames with quotes or newlines could break HTTP response headers or trigger downloads. | RFC 5987 percent-encoding implemented (`filename*=UTF-8''...`) for all attachment responses. | Uploading filenames with special characters encodes properly in header. | None; compliant with international web standards. |
| **SEC-10** | Unbounded Input Size (Denial of Service) | Massive text payloads (e.g. 5GB comments) could exhaust server RAM and crash the portal. | Enforced input character caps (Title: 200, Desc: 5000, Comment: 10000) and 10MB gateway body cap. | Submitting 201-char title returns `400 Bad Request`. | None; memory buffers capped at HTTP parser level. |
| **SEC-11** | Missing Browser Security Headers | Browsers lacked instructions to prevent clickjacking, MIME sniffing, and inline XSS. | Added `Content-Security-Policy: default-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`. | Response headers verified on all endpoints via automated test suite. | None; enforced on all static and dynamic responses. |
| **SEC-12** | Weak Password Complexity | Users could choose trivial passwords like `123456`, vulnerable to dictionary guessing. | `validatePasswordComplexity()` enforces min 8 chars, at least 1 digit, and at least 1 special character. | Setting password `Password123` returns `400` requiring special character. | Low; dictionary analysis can be added in future versions. |
| **SEC-13** | Insecure / Missing Admin Password Reset Flow | No recovery mechanism existed; active sessions were not revoked upon password change. | Built tokenized reset flow (`/api/admin/reset-token`) with 1-hour expiration and instant session termination. | Verified reset token allows password change and immediately invalidates old session cookies. | None; single-use token consumed in SQLite transaction. |

---

## 2. Structural & Architectural Hardening (GrievanceGuard)

In addition to fixing individual vulnerabilities, the application was refactored to use a **Defense-in-Depth Architecture**:

1. **Security Gateway (`src/server/security/gateway.ts`):** Outer defensive perimeter blocking flood attacks (200 req/min), body payloads >10MB, and scanning patterns (SQLi, path traversal, null bytes).
2. **Central Policy Engine (`src/server/security/policy.ts`):** Decoupled business logic from security rules. Every endpoint invokes `GrievanceGuard.enforce()`.
3. **Threat Monitor (`src/server/security/monitor.ts`):** Real-time behavioral analysis detecting IDOR scanning (15 distinct resource attempts) and authorization failure storms (8 failures/min) with automatic 15-minute IP bans.
4. **Audit Logging Subsystem (`src/server/routes/audit.ts`):** Immutable record of all state mutations, logins, and threat alerts for regulatory compliance.
