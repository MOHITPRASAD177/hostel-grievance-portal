# Security Policy & Architecture — HostelGrievance

**Project:** HostelGrievance — University Centralized Grievance Portal  
**Repository:** [https://github.com/MOHITPRASAD177/hostel-grievance-portal](https://github.com/MOHITPRASAD177/hostel-grievance-portal)  
**Security Model:** GrievanceGuard Multi-Layered Defense-in-Depth  
**Status:** 100% Remediated | 23 / 23 Automated Vitest Test Cases Passing | Production Ready  
**Date:** August 2026  

---

## 1. Executive Summary

HostelGrievance is a university-wide web platform enabling students to file and track hostel complaints and wardens to manage and resolve them. Prior to scheduled deployment, a comprehensive security engineering audit identified 13 critical and high-severity vulnerabilities across authentication, authorization, session persistence, input validation, cryptographic hashing, file handling, and network exposure.

Through the implementation of **GrievanceGuard** (a layered security gateway, centralized policy engine, and real-time threat monitor), all 13 vulnerabilities have been completely remediated. Furthermore, our team engineered **5 unique security innovations** (Honeytoken Canary Trap, Whistleblower Zero-Knowledge Masking, EXIF Geolocation Sanitization, Live SecOps Telemetry Dashboard, and Cryptographic Tamper-Evident Audit Ledger).

---

## 2. Final Security Posture Comparison

| Security Dimension | Pre-Hardening State | Post-Hardening State (GrievanceGuard) |
|---|---|---|
| **Authentication** | Plain SHA-256 without salt; no rate limiting | Salted `scrypt` (`N=16384, r=8, p=1, keylen=64`); 10 attempts/15min rate limit |
| **Authorization** | Fragmented, inline checks; vulnerable to BOLA & Status Tampering | Centralized policy engine (`GrievanceGuard`); strict RBAC + Object Ownership |
| **Session Security** | Permanent DB tokens; no cookie security flags; no revocation on logout | Expiring sessions; `HttpOnly`, `SameSite=Lax`, `Secure` flags; immediate DB destruction |
| **File Handling** | Unsanitized disk filenames; MIME trusted blindly from headers | Magic byte binary inspection; UUID storage names; RFC 5987 encoded headers; EXIF stripper |
| **Input Safety** | Unbounded string lengths (DoS vulnerability) | Strict validation caps (Title: 200, Desc: 5000, Comment: 10000 chars) |
| **Network & Headers** | Wildcard CORS reflection with credentials; missing CSP | Whitelist-only CORS; strict CSP (`default-src 'none'`), `X-Frame-Options: DENY`, `nosniff` |
| **Forensic Integrity** | No security event recording; mutable DB records | Cryptographic SHA-256 Merkle hash chained audit ledger (`/api/admin/audit-logs/verify`) |
| **Threat Detection** | None | Real-time monitor with honeytoken trap (`GRV-0000`), IDOR probe auto-banning, and SecOps telemetry |

---

## 3. The 5 Unique Security Innovations

1. **Automated Honeytoken Canary Trap (`GRV-0000`):**
   - High-entropy deceptive ticket seeded in database.
   - Any access instantly fires a `CRITICAL` alert and executes automated 60-minute IP isolation (`429 Too Many Requests`).
2. **Whistleblower / Anonymous Mode (`is_anonymous: 1`):**
   - Zero-knowledge author masking for sensitive ragging/harassment reports.
   - Student identity is pseudonymized to `ANON-<hex>` for wardens while allowing students to securely track their ticket.
3. **EXIF Geolocation & Privacy Sanitizer:**
   - Byte-stream parser for JPEG and PNG uploads.
   - Strips APP1 EXIF GPS coordinates, camera serials, and ancillary chunks before persisting to disk.
4. **Live SecOps Threat Telemetry Dashboard API (`/api/admin/security/telemetry`):**
   - Live endpoint providing DEFCON threat ratings (1–5), active IP quarantines, flood triggers, and hourly security metrics.
5. **Cryptographic Tamper-Evident Audit Ledger:**
   - SHA-256 hash chaining where each log entry seals the previous record's hash.
   - `/api/admin/audit-logs/verify` recalculates genesis chain in milliseconds, pinpointing any manual DB tampering.

---

## 4. Core Security Guarantees

1. **Strict Object Ownership:** Students can only view, edit, comment upon, and attach files to their own grievances. Cross-student access is rejected at the policy layer with `403 Forbidden`.
2. **Role Separation (Least Privilege):** Only Wardens can alter grievance status or archive resolved tickets. Only Students can create grievances or withdraw their own tickets.
3. **Session Invalidation:** Logging out, resetting a password, or reaching expiration immediately revokes all associated session records from the database.
4. **Binary Validation:** Files are verified against magic byte signatures before disk persistence, neutralizing executable masquerading.
5. **Defense-in-Depth:** If a request bypasses browser controls, it is caught sequentially by the Security Gateway, the Policy Engine, and the Database Foreign Key constraints.

---

## 5. Security Assumptions & Residual Risk

- **Environment:** The Node.js application process runs behind a reverse proxy (e.g., Nginx, Caddy, or Cloudflare) in production that terminates TLS/HTTPS.
- **Database Integrity:** The SQLite database file (`hostel.db`) is stored in a secure local filesystem directory with restricted OS-level permissions (`chmod 600`).
- **Warden Trust:** Wardens are trusted institutional actors with administrative privileges to manage statuses and initiate student password resets.
