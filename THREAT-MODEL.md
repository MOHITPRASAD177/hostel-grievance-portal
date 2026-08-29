# Threat Model — HostelGrievance

**Methodology:** STRIDE + Data-Flow Trust Boundary Analysis  
**Target:** HostelGrievance Application Ecosystem  

---

## 1. System Overview & Assets

The primary assets requiring protection in the HostelGrievance application include:

1. **User Credentials & Identity (A-1):** Password hashes, active session tokens, and password reset tokens.
2. **Grievance Data (A-2):** Private student complaints, maintenance requests, disciplinary context, and warden notes.
3. **Attachments & Media (A-3):** Images, photos of room issues, and supporting evidence stored on the local disk.
4. **Audit Logs & Forensics (A-4):** Historical records of user actions, login attempts, IP addresses, and security alerts.
5. **Application Availability (A-5):** System responsiveness, RAM capacity, and SQLite database write concurrency.

---

## 2. Threat Actors & Motivations

| Threat Actor | Capabilities | Motivation |
|---|---|---|
| **Malicious Student (Insider)** | Authenticated session with `student` role; ability to craft custom HTTP payloads | View rival students' grievances; resolve their own disciplinary tickets; harass wardens |
| **Compromised Student Account** | Legitimate credential access obtained via phishing or credential stuffing | Data exfiltration; unauthorized ticket submission |
| **External Network Attacker** | No valid credentials; capability to send high-volume automated requests | Brute-force warden accounts; upload malicious executables; DoS the portal |
| **Third-Party Malicious Website** | Ability to trick a student into clicking an external link (CORS / CSRF) | Exploit ambient credentials to read private grievances or perform unauthorized actions |

---

## 3. Trust Boundaries & Architecture Diagram

```text
               [ Untrusted Public Internet ]
                            │
════════════════════════════╪══════════════════════════════ [ Trust Boundary 1: Network Edge ]
                            ▼
              ┌───────────────────────────┐
              │  GrievanceGuard Gateway   │ (IP Blocklist, Flood, Body Size, Attack Patterns)
              └─────────────┬─────────────┘
                            │
════════════════════════════╪══════════════════════════════ [ Trust Boundary 2: App Middleware ]
                            ▼
              ┌───────────────────────────┐
              │   Authentication Layer    │ (Session Token Verification, Scrypt KDF)
              └─────────────┬─────────────┘
                            │
════════════════════════════╪══════════════════════════════ [ Trust Boundary 3: Domain Authorization ]
                            ▼
              ┌───────────────────────────┐
              │  GrievanceGuard Policy    │ (RBAC, Object Ownership, State Machine Validation)
              └─────────────┬─────────────┘
                            │
════════════════════════════╪══════════════════════════════ [ Trust Boundary 4: Data & Storage Tier ]
                            ▼
              ┌─────────────┴─────────────┐
              ▼                           ▼
      [ SQLite Database ]        [ Local Storage Disk ]
         (Foreign Keys)            (Magic Byte Verified)
```

---

## 4. STRIDE Threat Analysis

| Threat (STRIDE) | Attack Vector | Potential Impact | Pre-Hardening State | GrievanceGuard Mitigation |
|---|---|---|---|---|
| **Spoofing** | Brute forcing passwords / Session token fixation | Attacker impersonates warden or student | No rate limiting; permanent sessions | Salted `scrypt`; 10-attempt rate limiter; expiring sessions |
| **Tampering** | Parameter tampering on `PATCH /api/grievances/:id` | Student resolves their own grievance | Allowed status updates from students | Policy engine blocks status mutations by non-wardens |
| **Repudiation** | Denying an unauthorized action was taken | Inability to prove who altered data | No audit log table existed | Immutable audit logs with actor ID, IP, user-agent, timestamp |
| **Information Disclosure** | IDOR / BOLA on `/api/grievances/:id` | Student views other students' complaints | Missing ownership assertion in route | Centralized `canView` policy + IDOR probe detector |
| **Denial of Service** | Submitting 5GB description payload | Server RAM exhaustion & crash | Unbounded string acceptance | Max 200 char title, 5k desc, 10k comment, 10MB total payload |
| **Elevation of Privilege** | Student generating password reset tokens | Student takes over any account | Missing authorization checks on resets | Warden-only token generation; single-use token invalidation |

---

## 5. Critical Attack Paths & Hardened Defenses

### Path 1: The IDOR Scraper Attack
- **Attack Scenario:** An attacker writes a script iterating over `GRV-0001` through `GRV-9999` to harvest all university grievances.
- **Defensive Barrier:** 
  1. Policy engine blocks the request with `403 Forbidden`.
  2. The failure triggers `trackAuthzFailure` in the Threat Monitor.
  3. After 8 failures or 15 distinct resource attempts, the attacker's IP is automatically banned for 15 minutes.

### Path 2: The Malicious File Execution Attack
- **Attack Scenario:** An attacker renames `payload.exe` to `proof.png` and uploads it to compromise the server or viewers.
- **Defensive Barrier:**
  1. The server rejects extensions outside allowed image MIME types.
  2. The server inspects binary magic bytes (`0x89 0x50 0x4E 0x47` for PNG); mismatches trigger `400 Bad Request`.
  3. The file is saved with a cryptographically random UUID on disk, neutralizing path traversal and overwrites.
  4. Downloads are served with RFC 5987 percent-encoded `Content-Disposition: inline` and strict CSP headers.
