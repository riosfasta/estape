# Codex Project Instructions

## Project

- This is `bugmega`, a self-hosted team and task-management application.
- The backend is written in Go and uses MongoDB, HTML/CSS, and vanilla JavaScript.
- Keep secrets out of source control. Never read, print, or commit `.env` values or service-account files.

## Working Rules

- Read the smallest relevant set of files before making a change. Prefer targeted `rg` searches over broad repository dumps.
- Make the smallest change that fully solves the user's request. Do not refactor unrelated code.
- Preserve existing behavior unless the user explicitly asks for a behavior change.
- Before changing authentication, payments, deployment, database migrations, or production configuration, inspect the relevant code and call out risks.
- Do not delete files, rewrite history, reset changes, or change external services without explicit user approval.
- Treat uncommitted changes as user-owned. Do not overwrite or revert them.

## Cost-Conscious Codex Use

- Keep plans short and actionable: normally 3-6 steps, with no repeated restatement of the request.
- Use the lowest reasoning effort and model that can safely complete the task; increase it only when the task is genuinely complex or the first approach fails.
- Avoid repeated full-repository scans, unnecessary web searches, and speculative investigations.
- Batch independent read-only checks when possible.
- Do not run expensive, long-running, destructive, or network-dependent commands unless they are needed for the task.
- Ask before actions that may create billable external usage, incur cloud charges, send messages, deploy changes, or modify production data.
- If a task is ambiguous but a safe local assumption is available, state the assumption and proceed.

## Validation

- For backend changes, run focused tests first, then `go test ./...` when practical.
- Prefer existing project commands and avoid adding dependencies unless required.
- Report exactly what was changed and which validation commands were run.

## Project Commands

```powershell
go run ./cmd/server
go test ./...
go mod tidy
```

- Local development expects MongoDB to be available and configuration to come from `.env`.
- The default local URL is `http://localhost:8080`.
