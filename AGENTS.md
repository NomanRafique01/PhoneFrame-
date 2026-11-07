<!-- skill-brain:start v2.1 -->
# Skill Brain â€” Master Engineering Protocol

This rule file loads automatically every session. Read it before anything else.

## Dollar Commands & Trigger Keywords ($)

| Command | Keyword Trigger | Target Orchestrator / Skill | Action |
|---|---|---|---|
| `$orchestrate` | `brain:` | `supreme-orchestrator` | Evaluates multi-domain requests, selects category routing, gates execution. |
| `$plan-frontend`| `plan-ui:` | `frontend-planner` | Formulates complete UI design & dual-viewport responsive blueprint before coding. |
| `$frontend` | `ui:`, `fe:` | `frontend-master` | Activates frontend suite with Taste Kill + Anti-SOP + Dynamic Sizing baselines. |
| `$plan-backend` | `plan-api:` | `backend-planner` | Formulates domain models, responsive API contracts, and TDD plan before coding. |
| `$backend` | `api:`, `be:` | `backend-master` | Activates backend suite with Karpathy simplicity + TDD + Responsive contracts. |
| `$plan-debug` | `plan-fix:` | `debug-planner` | Mandatory diagnostic plan first: symptom, hypothesis, evidence roadmap. |
| `$debug` | `fix:` | `debug-master` | Executes diagnostic plan, isolates root cause, requires evidence before fixes. |
| `$plan-anti-slop`| `audit-plan:` | `anti-slop-planner` | Scans for AI tells, outputs itemized remediation plan across 6 dimensions. |
| `$anti-slop` | `gate:`, `audit:` | `anti-ai-sop-agent` | Generates 6-category quality gate scorecard (PASS / WARN / FAIL) with `--fix`. |
| `$architect` | `arch:`, `isolate:` | `architecture-master` | Isolates workspace via worktree, maps decision tickets, or dispatches sub-agents. |
| `$plan` | `plan:` | Domain Planner | Formulates in-chat blueprint for task with zero disk writes. |
| `$memory` | `memory:` | `memory-master` | Creates master plan & phase files, renders Live Chat Dashboard, user-controlled. |
| `$taste` | `kill-slop:` | `design-taste-frontend` | Runs the 247-site study art direction: palette from subject, no template defaults. |
| `$typography` | `type:` | `typography-master` | Selects domain font archetype (Swiss, Editorial, Mono, Humanist), clamp scale. |
| `$icon` | `svg:` | `svg-icon-craftsman` | Crafts clean 24Ã--24 grid-snapped vector geometry with 1.5px/2.0px stroke. |
| `$test`, `$verify` | `test:`, `evidence:` | `test-verifier` | Runs tests and verification ONLY when explicitly asked by the user ($test). |
| `$git` | `git:` | `git-master` | Apex Git orchestrator: branch lifecycle, atomic commit splitting, phase gates. |
| `$commit` | `commit:` | `git-atomic-committer` | Analyzes diffs, splits into 2+ atomic commits across domains, Conventional format. |
| `$branch` | `branch:` | `git-branch-manager` | Kebab branch taxonomy (`feat/`, `fix/`, `phase/`), clean tree, rebase workflow. |
| `$phase-commit` | `phase-commit:` | `git-phase-committer` | Automatic memory phase commit hook with embedded verification proof. |

## Test-On-Demand Protocol (Never Test Unless Explicitly Asked)

DO NOT write tests, run test suites, or execute logic test scripts unless the user explicitly requests it or invokes `$test` / `$verify`. Never test unsolicited.

## Confirmation Policy

Skill Brain reads `.agents/brain/config.json` for the confirmation policy
(`"confirm": "always" | "multi-skill" | "never"`, default `"always"`):
- `"always"`: Present proposed skills and ask confirmation before executing.
- `"multi-skill"`: Ask only when coordinating 2 or more skills.
- `"never"`: Autonomous execution without interactive confirmation prompts.

## How to Find Skills

Read `.agents/brain/index.json` for the full skill index.
Skill files live at `.agents/skills/<name>/SKILL.md`.
<!-- skill-brain:end -->
