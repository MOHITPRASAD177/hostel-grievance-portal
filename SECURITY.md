# Security Policy & Posture — HostelGrievance

**Project:** HostelGrievance — University Centralized Grievance Portal  
**Repository:** [https://github.com/MOHITPRASAD177/hostel-grievance-portal](https://github.com/MOHITPRASAD177/hostel-grievance-portal)  
**Status:** Hardened & Pre-Launch Ready  
**Date:** August 2026  

---

## 1. Executive Summary

HostelGrievance is a university-wide web platform enabling students to file and track hostel complaints and wardens to manage and resolve them. Prior to scheduled deployment, a comprehensive security engineering audit identified 13 critical and high-severity vulnerabilities across authentication, authorization, session persistence, input validation, cryptographic hashing, file handling, and network exposure.

Through the implementation of **GrievanceGuard** (a layered security gateway, centralized policy engine, and real-time threat monitor), all 13 vulnerabilities have been completely remediated. The system now enforces defense-in-depth, reducing the blast radius of any single failure while preserving 100% of legitimate Student and Warden workflows.

---

## 2. Final Security Posture

| Security Dimension | Pre-Hardening State | Post-Hardening State (GrievanceGuard) |
|---|---|---|
| **Authentication** | Plain SHA-256 without salt; no rate limiting | Salted `scrypt` (N=16384, r=8, p=1, keylen=64); 10 attempts/15min rate limit |
| **Authorization** | Fragmented, inline checks; vulnerable to BOLA & Status Tampering | Centralized policy engine (`GrievanceGuard`); strict RBAC + Object Ownership |
| **Session Security** | Permanent DB tokens; no cookie security flags; no revocation on logout | Expiring sessions; `HttpOnly`, `SameSite=Lax`, `Secure` flags; immediate DB destruction |
| **File Handling** | Unsanitized disk filenames; MIME trusted blindly from headers | Magic byte binary inspection; UUID storage names; RFC 5987 encoded headers |
| **Input Safety** | Unbounded string lengths (DoS vulnerability) | Strict validation caps (Title: 200, Desc: 5000, Comment: 10000 chars) |
| **Network & Headers** | Wildcard CORS reflection with credentials; missing CSP | Whitelist-only CORS; strict CSP (`default-src 'none'`), `X-Frame-Options: DENY`, `nosniff` |
| **Visibility & Forensics** | No security event recording | Comprehensive audit trail logging actor, action, target, IP, and timestamp |
| **Threat Detection** | None | Real-time monitor tracking IDOR probes, auth failure storms, and flood attacks |

---

## 3. Core Security Guarantees

1. **Strict Object Ownership:** Students can only view, edit, comment upon, and attach files to their own grievances. Cross-student access is rejected at the policy layer with `403 Forbidden`.
2. **Role Separation (Least Privilege):** Only Wardens can alter grievance status or archive resolved tickets. Only Students can create grievances or withdraw their own tickets.
3. **Session Invalidation:** Logging out, resetting a password, or reaching expiration immediately revokes all associated session records from the database.
4. **Binary Validation:** Files are verified against magic byte signatures before disk persistence, neutralizing executable masquerading.
5. **Defense-in-Depth:** If a request bypasses browser controls, it is caught sequentially by the Security Gateway, the Policy Engine, and the Database Foreign Key constraints.

---

## 4. Security Assumptions

- **Environment:** The Node.js application process runs behind a reverse proxy (e.g., Nginx, Caddy, or Cloudflare) in production that terminates TLS/HTTPS.
- **Database Integrity:** The SQLite database file (`hostel.db`) is stored in a secure local filesystem directory with restricted OS-level permissions (`chmod 600`).
- **Warden Trust:** Wardens are trusted institutional actors with administrative privileges to manage statuses and initiate student password resets.

---

## 5. Residual Risks & Future Roadmap

| Residual Risk | Severity | Current Mitigation | Recommended Long-Term Enhancement |
|---|---|---|---|
| **In-Memory Rate Limiting Reset on Restart** | Low | Protects against automated online brute force during runtime | Transition rate-limiting state to a Redis cluster for multi-instance deployments |
| **Single Database File Concurrency** | Low | SQLite WAL mode enabled for high-concurrency reading | Migrate to PostgreSQL/Cloud Spanner for multi-region scalability |
| **Client IP Spoofing behind Proxies** | Low | Gateway inspects `x-forwarded-for` and `x-real-ip` | Configure reverse proxy to strip untrusted upstream forwarding headers |
