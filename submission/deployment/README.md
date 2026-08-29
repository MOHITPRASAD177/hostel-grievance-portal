# Deployment & Independent Review Guide — HostelGrievance

This guide provides instructions to independently install, configure, build, seed, run, and verify the **HostelGrievance** application.

---

## 1. Prerequisites

- **Node.js**: v18.0.0 or later (v20+ recommended)
- **npm**: v9.0.0 or later
- **Python**: 3.8+ (optional, for regenerating the PDF report)
- **Docker**: (optional, for containerized execution)

---

## 2. Quickstart (Local Environment)

### Step 1: Install Dependencies
From the project root (or `submission/source/`):
```bash
npm install
```

### Step 2: Seed / Reset the Database
The application comes pre-seeded with a production SQLite database at `data/hostel.db`. To re-initialize or reset the database to fresh factory state:
```bash
npm run db:init
```

### Step 3: Run the Application
To run both the backend Hono API server (`localhost:3001`) and the SvelteKit frontend (`localhost:5173`) concurrently:
```bash
npm run dev:all
```
Alternatively, launch them in separate terminals:
```bash
# Terminal 1: Backend Server (Port 3001)
npm run dev:server

# Terminal 2: Frontend Web App (Port 5173)
npm run dev:client
```

Open [http://localhost:5173](http://localhost:5173) in your web browser.

---

## 3. Seeded Accounts & Credentials

| Role | Email | Password | Permissions |
|---|---|---|---|
| **Student** | `student@example.test` | `student123` | File grievances, track status, add comments/attachments, withdraw open tickets. |
| **Warden** | `warden@example.test` | `warden123` | Review all complaints, update status (Open → In Progress → Resolved), archive tickets, view cryptographic audit ledger, inspect live SecOps telemetry, generate reset tokens. |

---

## 4. Automated Verification & Test Execution

Run the complete 23-test automated test suite:
```bash
# Run Vitest test suite
npx vitest run

# Run TypeScript static analysis across client & server
npm run typecheck
```

### Regenerate Submission PDF Report
```bash
python generate_pdf.py
```

---

## 5. Containerized Deployment (Docker)

To run the application inside an isolated Docker container:

```bash
# Build and run using Docker Compose
docker compose -f submission/deployment/docker-compose.yml up --build

# Or build standard Docker image
docker build -f submission/deployment/Dockerfile -t hostelgrievance:latest .
docker run -p 5173:5173 -p 3001:3001 hostelgrievance:latest
```

---

## 6. Environment Configuration

Default configuration is specified in `.env.example`:
```env
PORT=3001
HOST=127.0.0.1
DATABASE_PATH=data/hostel.db
UPLOADS_DIR=uploads
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```
