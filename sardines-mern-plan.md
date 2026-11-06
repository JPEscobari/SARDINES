# SARDINES — MERN Stack Prototype Plan

## Top-Level Overview

Build a full-stack MERN prototype for the **Sales Operations Agent** — an AI-powered interface that connects a React frontend to a Node/Express backend, which proxies user queries to **WatsonX Orchestrate**. Responses are persisted in **MongoDB** and surfaced across a three-panel dashboard (Conversation History, Task Tracker, Decisions Log).

This is a **demo-grade prototype** for the IBM SkillsBuild presentation. The MERN stack represents the "User Interface" and "Trigger" layer of the MVP pipeline, with the Express backend acting as the integration boundary toward IBM services.

**Stack:** MongoDB · Express · React · Node.js  
**IBM Integration:** WatsonX Orchestrate (via `WATSONX_API_KEY` + `WATSONX_INSTANCE_URL`)  
**UI Style:** IBM Carbon Design System (blue/gray palette)

**MVP Flow covered by this build:**
```
User Trigger (React Chat UI)
  → Express proxy → WatsonX Orchestrate
  → MongoDB persistence
  → Dashboard (Conversation · Tasks · Decisions)
```

---

## Project Structure

```
SARDINES/
├── client/                          ← React frontend (Vite)
│   ├── public/
│   └── src/
│       ├── components/
│       │   ├── ChatInterface.jsx    ← chat input + message thread
│       │   ├── TaskTracker.jsx      ← task list with owner + deadline
│       │   └── DecisionsLog.jsx     ← log of decisions extracted by agent
│       ├── pages/
│       │   └── Dashboard.jsx        ← three-panel layout
│       ├── services/
│       │   └── api.js               ← all fetch calls to Express
│       └── App.jsx
├── server/
│   ├── routes/
│   │   ├── chat.js                  ← POST /api/chat
│   │   ├── tasks.js                 ← GET/POST/PATCH /api/tasks
│   │   └── decisions.js             ← GET /api/decisions
│   ├── services/
│   │   └── watsonx.service.js       ← single abstraction for WatsonX calls
│   ├── models/
│   │   ├── Conversation.js          ← { role, content, timestamp }
│   │   ├── Task.js                  ← { title, owner, deadline, status }
│   │   └── Decision.js              ← { summary, source, timestamp }
│   └── index.js                     ← Express app entry point
├── .env                             ← WATSONX_API_KEY, WATSONX_INSTANCE_URL, MONGO_URI
├── .gitignore
└── package.json                     ← root scripts for concurrent dev
```

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffolding

**Status:** `[x] done`

**Intent**  
Initialize the monorepo structure, install dependencies, and wire up the development environment so all subsequent sub-tasks build on a runnable foundation.

**Expected Outcomes**
- `npm run dev` from the project root starts both the Express server and Vite React client concurrently
- `.env` variables are loaded and accessible in the Express process
- MongoDB connection is established and logged on startup
- A health-check route `GET /api/health` returns `{ status: "ok" }`

**Todo List**
1. Initialize root `package.json` with `concurrently` script to run server + client
2. Scaffold `server/` with `express`, `mongoose`, `dotenv`, `cors`, `axios`
3. Scaffold `client/` with Vite + React (`npm create vite@latest`)
4. Install IBM Carbon Design System in client: `@carbon/react`
5. Create `server/index.js` — Express app, CORS, dotenv, MongoDB connect, health route
6. Create `.gitignore` (node_modules, .env, dist)
7. Verify `npm run dev` runs both processes without errors

**Relevant Context**
- `.env` already exists at project root with `WATSONX_API_KEY` and `WATSONX_INSTANCE_URL`
- Add `MONGO_URI` to `.env` (local: `mongodb://localhost:27017/sardines` or MongoDB Atlas URI)
- Carbon React docs: https://react.carbondesignsystem.com

---

### Sub-Task 2 — MongoDB Models

**Status:** `[x] done`

**Intent**  
Define the three Mongoose schemas that back the dashboard panels. These models are the persistence contract for everything the agent returns.

**Expected Outcomes**
- Three Mongoose models exported and importable by route handlers
- Each model reflects the data shape the dashboard will render

**Todo List**
1. Create `server/models/Conversation.js`
   - Fields: `role` (enum: `user` | `assistant`), `content` (String), `timestamp` (Date, default now)
2. Create `server/models/Task.js`
   - Fields: `title` (String), `owner` (String), `deadline` (Date), `status` (enum: `open` | `in-progress` | `done`, default `open`), `sourceMessageId` (ObjectId ref Conversation), `createdAt` (Date)
3. Create `server/models/Decision.js`
   - Fields: `summary` (String), `source` (String — meeting/document reference), `timestamp` (Date), `sourceMessageId` (ObjectId ref Conversation)

**Relevant Context**
- `sourceMessageId` links tasks and decisions back to the conversation turn that produced them — important for the "source-aware answers" goal from the PDF

---

### Sub-Task 3 — WatsonX Service + Chat Route

**Status:** `[x] done`

**Intent**  
Build the single abstraction layer that calls WatsonX Orchestrate, and expose it via a POST route. This is the core integration point of the entire prototype.

**Expected Outcomes**
- `POST /api/chat` accepts `{ message: string }`, calls WatsonX Orchestrate, persists both the user message and assistant response to MongoDB, and returns the response
- `GET /api/chat/history` returns all conversation documents ordered by timestamp
- `watsonx.service.js` is the only file that references `WATSONX_API_KEY` and `WATSONX_INSTANCE_URL`

**Todo List**
1. Create `server/services/watsonx.service.js`
   - Export a single async function `sendMessage(prompt)` that POSTs to `WATSONX_INSTANCE_URL` with Bearer token from `WATSONX_API_KEY`
   - Return the text response from WatsonX Orchestrate
   - If the WatsonX call fails, throw a descriptive error (do not swallow it)
2. Create `server/routes/chat.js`
   - `POST /api/chat`: call `sendMessage`, save user + assistant messages to `Conversation`, return `{ reply, messageId }`
   - `GET /api/chat/history`: return all `Conversation` docs sorted by `timestamp` ascending
3. Mount the chat router in `server/index.js` at `/api/chat`

**Relevant Context**
- WatsonX Orchestrate REST API authentication uses an IAM bearer token generated from the API key via `https://iam.cloud.ibm.com/identity/token`
- The service layer should handle the IAM token exchange, not the route handler
- If live WatsonX credentials aren't confirmed at implementation time, stub `sendMessage` to return a realistic mock response so the rest of the stack can be built and tested end-to-end

---

### Sub-Task 4 — Tasks and Decisions Routes

**Status:** `[x] done`

**Intent**  
Expose CRUD endpoints for tasks and decisions so the dashboard panels can read and update data returned by the agent.

**Expected Outcomes**
- `GET /api/tasks` returns all tasks
- `POST /api/tasks` creates a new task (used when WatsonX response contains action items)
- `PATCH /api/tasks/:id` updates task status (for the task tracker UI)
- `GET /api/decisions` returns all decisions

**Todo List**
1. Create `server/routes/tasks.js` with `GET`, `POST`, and `PATCH /:id` handlers using the `Task` model
2. Create `server/routes/decisions.js` with `GET` and `POST` handlers using the `Decision` model
3. Mount both routers in `server/index.js` at `/api/tasks` and `/api/decisions`

**Relevant Context**
- For the prototype, tasks and decisions are created manually (via POST) or by the chat route parsing WatsonX responses — no automatic extraction pipeline is required for MVP

---

### Sub-Task 5 — React Frontend

**Status:** `[x] done`

**Intent**  
Build the three-panel dashboard UI in React using IBM Carbon Design System components, wired to the Express API.

**Expected Outcomes**
- Dashboard renders three panels side-by-side (or stacked responsively): Chat, Task Tracker, Decisions Log
- Chat panel: text input + send button, message thread showing user/assistant turns
- Task Tracker panel: list of tasks with owner, deadline, and a status toggle (open → in-progress → done)
- Decisions Log panel: list of decision summaries with source and timestamp
- All data is fetched from the Express API (no hardcoded mock data in components)

**Todo List**
1. Create `client/src/services/api.js` — export named async functions: `sendMessage`, `getHistory`, `getTasks`, `updateTaskStatus`, `getDecisions`
2. Create `client/src/components/ChatInterface.jsx`
   - Use Carbon `TextInput`, `Button`, and a scrollable message list
   - On send: call `sendMessage`, append user + assistant messages to local state
   - On mount: call `getHistory` to hydrate from MongoDB
3. Create `client/src/components/TaskTracker.jsx`
   - Use Carbon `DataTable` or `StructuredList`
   - On mount: call `getTasks`
   - Status toggle calls `updateTaskStatus`
4. Create `client/src/components/DecisionsLog.jsx`
   - Use Carbon `Tile` or `StructuredList`
   - On mount: call `getDecisions`
5. Create `client/src/pages/Dashboard.jsx`
   - Use Carbon `Grid` and `Column` for three-panel layout
   - Import and render all three components
6. Update `client/src/App.jsx` to render `Dashboard`

**Relevant Context**
- IBM Carbon React component library: `@carbon/react`
- Carbon grid uses 16-column system — suggested split: Chat (6 col), Tasks (5 col), Decisions (5 col)
- Carbon theme: use `g10` (light) to match the clean/professional IBM look

---

### Sub-Task 6 — Integration Wiring and Demo Validation

**Status:** `[x] done`

**Intent**  
End-to-end smoke test: send a message from the UI, verify it reaches WatsonX (or the stub), persists to MongoDB, and appears correctly in all three dashboard panels.

**Expected Outcomes**
- Full round-trip works: React → Express → WatsonX → MongoDB → React
- No console errors in browser or server terminal
- Task and Decision panels populate when data exists in MongoDB
- The app is demo-ready (no broken layouts, no unhandled promise rejections)

**Todo List**
1. Run `npm run dev` and open the browser
2. Send a test message in the Chat panel — confirm reply appears
3. Manually POST a task and a decision via the API (curl or Postman) — confirm they appear in the dashboard panels
4. Verify conversation history persists across page refresh
5. Fix any layout or data-fetch issues discovered
6. Confirm `WATSONX_API_KEY` and `WATSONX_INSTANCE_URL` are loaded correctly from `.env` and not exposed to the client bundle

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Frontend build tool | Vite | Fast dev server, minimal config |
| UI library | IBM Carbon React | Matches IBM SkillsBuild demo context |
| WatsonX abstraction | Single `watsonx.service.js` | One place to swap credentials or mock |
| Monorepo scripts | `concurrently` at root | Simple, no Docker needed for prototype |
| MongoDB | Local or Atlas | Atlas URI drop-in via `MONGO_URI` in `.env` |
