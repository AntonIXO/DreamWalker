# Jev validation — 2026-09-22

The initial architecture/art/save-migration checkpoint is `4ea4835` on `main`.
Implementation lives on `codex/jev-autonomy`.

## Automated checks

- `bun test`: 835 passed, 1 skipped, 0 failed, 5,612 assertions across 96 files.
  The skipped test is the existing opt-in local multilingual embeddings test.
- `bun run build`, `bun run lint`, and `git diff --check`: passed.
- Coverage includes quiet frames, wait deduplication, causal-chain limits, persisted
  accounting, stale replies, ownership/preemption, partial-task recovery, local
  offscreen schedules, hidden NPCs and inventory, closed-container discoveries,
  alternative door routes, and one reconsideration after a physical refusal.

## Live browser checks

Headless Chromium loaded the actual game with a separate test storage context.
The fixture used a locally dealt population, then resumed in live mode. Director
goals were supplied through its ordinary guidance handoff; the slow narrative
endpoint returned an empty plan in this focused test. Jev requests used the real
OpenRouter endpoint and the configured `~typesafe/jev-latest`, which resolved to
`typesafe/jev-1.13-20260917`.

The real game ticker ran throughout. Repeated rendering was detached for long
quiet-frame checks to avoid measuring software-GPU saturation; screenshot samples
used the real Pixi renderer. These checks establish gameplay integration and model
behavior, not a GPU benchmark or a full narrative-director playthrough.

| Scenario | Observed result |
| --- | --- |
| 1,200 quiet frames | Zero Jev calls and zero idle director calls. |
| Turyshev delivers a bottle | One decision chose approach → take → approach → give. Movement began after 1,510 ms in the final measured run. |
| Reload while carrying | The saved suffix completed the delivery. The take receipt occurred exactly once; no additional inference was needed. |
| 1,000 frames after completion | No repeated decision. |
| Raisa outside the player's room | She approached and opened the pear case through the normal executor. |
| Player closes the case in front of Raisa | One new decision, attached to the player's receipt root, reopened it in 1,388 ms. |

The delivery and first offscreen opening cost $0.00044226 together. Their provider
latencies were 940 ms and 441 ms. The separate close/reopen reaction cost $0.000265398
for its new decision, with 418 ms provider latency. These are individual observations,
not latency guarantees or an estimate of calls per hour.

The first live delivery probe selected `wait` because the character's habitual
stationarity outweighed the new intention. The provider instruction now separates
an adopted current goal from habitual activity, while preserving the requirement
for a personal reason to act without a goal. The subsequent live checks above used
the corrected instruction.
