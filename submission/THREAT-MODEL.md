# Threat Model — HostelGrievance

**Methodology:** STRIDE + Data-Flow Trust Boundary Analysis  
**Target:** HostelGrievance Application Ecosystem  
**Security Framework:** GrievanceGuard Multi-Layered Defense  

---

## 1. System Overview & Assets

The primary assets requiring protection in the HostelGrievance application include:

1. **User Credentials & Identity (A-1):** Password hashes, active session tokens, and single-use password reset tokens.
2. **Grievance Data (A-2):** Private student complaints, maintenance requests, disciplinary context, and warden notes.
3. **Whistleblower Identity (A-3):** Student identity in anonymous / sensitive misconduct reports.
4. **Attachments & Media (A-4):** Images, photos of room issues, and supporting evidence stored on the local disk.
5. **Audit Logs & Forensics (A-5):** Cryptographically chained historical records of user actions, login attempts, IP addresses, and security alerts.
6. **Application Availability (A-6):** System responsiveness, RAM capacity, and SQLite database write concurrency.

---

## 2. Threat Actors & Motivations

| Threat Actor | Capabilities | Motivation |
|---|---|---|
| **Malicious Student (Insider)** | Authenticated session with `student` role; ability to craft custom HTTP payloads | View rival students' grievances; resolve their own disciplinary tickets; harass staff |
| **Compromised Student Account** | Legitimate credential access obtained via phishing or credential stuffing | Data exfiltration; unauthorized ticket submission |
| **External Network Attacker** | No valid credentials; capability to send high-volume automated requests | Brute-force warden accounts; upload malicious executables; DoS the portal |
| **Third-Party Malicious Website** | Ability to trick a student into clicking an external link (CORS / CSRF) | Exploit ambient credentials to read private grievances or perform unauthorized actions |
| **Malicious Insider / Rogue Admin** | Direct database read/write access | Cover tracks by modifying historical audit records or viewing whistleblower identities |

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
              │  • Honeytoken Tripwire    │ (Trap Deceptive GRV-0000)
              │  • Whistleblower Masker   │ (Zero-Knowledge Pseudonymization)
              └─────────────┬─────────────┘
                            │
════════════════════════════╪══════════════════════════════ [ Trust Boundary 4: Data & Storage Tier ]
                            ▼
              ┌─────────────┴─────────────┐
              ▼                           ▼
      [ SQLite Database ]        [ Local Storage Disk ]
         (Foreign Keys &           (Magic Byte Verified &
          SHA-256 Chaining)         EXIF GPS Stripped)
```

---

## 4. STRIDE Threat Analysis & Mitigations

| Threat (STRIDE) | Attack Vector | Potential Impact | Pre-Hardening State | GrievanceGuard Mitigation |
|---|---|---|---|---|
| **Spoofing** | Brute forcing passwords / Session token fixation | Attacker impersonates warden or student | No rate limiting; permanent sessions | Salted `scrypt`; 10-attempt rate limiter; expiring sessions |
| **Tampering** | Parameter tampering on `PATCH /api/grievances/:id` | Student resolves their own grievance | Allowed status updates from students | Policy engine blocks status mutations by non-wardens |
| **Repudiation** | Denying an unauthorized action was taken / DB log tampering | Inability to prove who altered data | No audit log table existed | SHA-256 Merkle hash chained audit ledger with `/verify` endpoint |
| **Information Disclosure** | IDOR / BOLA on `/api/grievances/:id` | Student views other students' complaints | Missing ownership assertion in route | Centralized `canView` policy + IDOR detector + Honeytoken canary |
| **Denial of Service** | Submitting 5GB description payload | Server RAM exhaustion & crash | Unbounded string acceptance | Max 200 char title, 5k desc, 10k comment, 10MB total payload |
| **Elevation of Privilege** | Student generating password reset tokens | Student takes over any account | Missing authorization checks on resets | Warden-only token generation; single-use token invalidation |

---

## 5. Critical Attack Paths & Hardened Defenses

### Path 1: The IDOR Scraper & Canary Trap Attack
- **Attack Scenario:** An attacker writes a script iterating over `GRV-0000` through `GRV-9999` to harvest all university grievances.
- **Defensive Barrier:** 
  1. Accessing `GRV-0000` (Honeytoken Canary) instantly triggers `triggerCanaryTrap`.
  2. The attacker's IP is automatically quarantined with an immediate 60-minute isolation ban (`429 Too Many Requests`).
  3. All legitimate grievance requests are guarded by `GrievanceGuard.canView()`, rejecting unauthorized IDs with `403`.

### Path 2: The Malicious File Execution & Geolocation Leak Attack
- **Attack Scenario:** An attacker uploads malware masquerading as an image, or uploads photos containing private GPS room coordinates.
- **Defensive Barrier:**
  1. The server checks declared MIME whitelist and scans raw binary magic bytes (`0x89504E47` etc.).
  2. The byte stream passes through `stripImageMetadata`, stripping all APP1 EXIF GPS data and ancillary chunks.
  3. The file is saved with a cryptographically random UUID on disk outside the web root.
  4. Downloads are served with RFC 5987 percent-encoded `Content-Disposition: inline` and strict CSP headers.

### Path 3: Whistleblower Retaliation Attack
- **Attack Scenario:** A student reports senior misconduct; a warden attempts to inspect the author's personal identity or room number.
- **Defensive Barrier:**
  1. Student selects `isAnonymous: true`.
  2. The policy mapper pseudonymizes the student's name, email, and room number to `ANON-<6-char-hex>`.
  3. The author student retains full read access to track their complaint while wardens only see redacted metadata.
