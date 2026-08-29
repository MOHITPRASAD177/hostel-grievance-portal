# HostelGrievance — Final Submission Package

This package contains the complete, hardened, independently runnable **HostelGrievance** portal submission according to the `SUBMISSION.md` specification.

---

## 📁 Submission Package Directory Structure

```text
submission/
├── source/                                     # Complete source code (SvelteKit + Hono + GrievanceGuard)
│   ├── src/                                    # Frontend and backend server code
│   ├── data/                                   # Seeded SQLite database (hostel.db)
│   ├── package.json                            # Dependency declarations
│   ├── tsconfig.json & tsconfig.server.json    # TypeScript configurations
│   ├── vite.config.ts & vitest.config.ts       # Build and testing configurations
│   └── generate_pdf.py                         # 12-page ReportLab PDF generator
├── deployment/                                 # Run instructions, Docker, and startup scripts
│   ├── README.md                               # Step-by-step review & execution guide
│   ├── Dockerfile                              # Container definition
│   ├── docker-compose.yml                      # Container orchestration
│   ├── run.bat / run.sh                        # Development environment launchers
│   └── verify.bat / verify.sh                  # Automated test verification runners
├── SECURITY.md                                 # Security policy, GrievanceGuard architecture & posture
├── THREAT-MODEL.md                             # Full STRIDE threat model across all trust boundaries
├── HARDENING.md                                # Security Hardening Register (HG-SEC-01 to HG-SEC-18)
├── TEST-EVIDENCE/                              # Verified test outputs and execution logs
│   ├── vitest-results.txt                      # 23/23 passing automated tests log
│   ├── typecheck-results.txt                   # 0 errors / 0 warnings TypeScript check
│   └── security-verification.md                # Comprehensive test case audit write-up
└── HostelGrievance_Security_Hardening_Report.pdf # 12-page comprehensive submission report
```

---

## ⚡ Quick Evaluation Commands

### 1. Run Automated Test Suite (23 / 23 Tests)
```bash
npx vitest run
```

### 2. Verify TypeScript Diagnostics (0 Errors, 0 Warnings)
```bash
npm run typecheck
```

### 3. Reset Database to Seed State
```bash
npm run db:init
```

### 4. Run the Application
```bash
npm run dev:all
```
- **Frontend Portal:** [http://localhost:5173](http://localhost:5173)
- **Backend API:** [http://localhost:3001](http://localhost:3001)

---

## 👥 Demo Accounts

| Role | Email | Password | Access Capabilities |
|---|---|---|---|
| **Student** | `student@example.test` | `student123` | File grievances, track status, add comments & images, withdraw open tickets. |
| **Warden** | `warden@example.test` | `warden123` | Review grievances, change status (Open/In Progress/Resolved), archive tickets, verify cryptographic audit ledger (`/api/admin/audit-logs/verify`), inspect SecOps telemetry (`/api/admin/security/telemetry`). |
