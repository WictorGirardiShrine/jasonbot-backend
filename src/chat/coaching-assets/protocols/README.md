# Coaching Protocols (operational IP)

Verbatim coaching protocols supplied by Jason Andrews. Treated the same way as [../COACHING_PROTOCOL.md](../COACHING_PROTOCOL.md) and [../COACHING_RULES.md](../COACHING_RULES.md) — IP, never paraphrased, never invented.

## Files

| File | What it is | Loaded by `ChatPromptService`? |
| --- | --- | --- |
| [../COACHING_PROTOCOL.md](../COACHING_PROTOCOL.md) | Anxiety submodality shift (`submodality_shift` protocol key) | Yes |
| [../COACHING_RULES.md](../COACHING_RULES.md) | 7 polish-pass behavioral rules | Yes |
| [INTRO_AND_ISSUE_SELECTION.md](INTRO_AND_ISSUE_SELECTION.md) | Session opener — welcome, disclaimer, pacing, issue picker, rotation policy | Yes (when `session.activeProtocolKey` is null) |
| [LETTING_GO.md](LETTING_GO.md) | Letting-go protocol (`letting_go` protocol key) | Yes (when active) |
| [NEUTRALIZING_SPECIFIC_EVENT_SUBMODALITIES.md](NEUTRALIZING_SPECIFIC_EVENT_SUBMODALITIES.md) | Event neutralization via submodality work (`neutralize_event` protocol key) | Yes (when active) |
| [TENTACLES_OF_LIGHT.md](TENTACLES_OF_LIGHT.md) | Energy-cord reclaim visualization (`tentacles` protocol key) | Yes (when active) |

Each session has at most one active protocol injected at a time. Before issue-selection the bot uses INTRO_AND_ISSUE_SELECTION.md; once the user picks an issue, the router resolves the next protocol in the rotation (`submodality_shift → tentacles → neutralize_event → letting_go → repeat`) and that protocol becomes the active one for the remainder of the session.

## `VERBATIM_PENDING` sentinel

Each protocol file may contain `<!-- VERBATIM_PENDING (...): ... -->` HTML comments marking spots where Jason's verbatim text still needs to land. The HTML-comment form keeps Claude from ever seeing the placeholder text as content.

Current sentinel taxonomy:

- `(BLOCKED — reason)` — Jason has not supplied the text and there is a stated blocker (e.g. a source file was truncated). The branch / step is **hidden from users** until the sentinel is resolved.

(Earlier tags `(NEW)`, `(REUSE CANDIDATE)`, `(PARTIAL REUSE)` were used during Phase 2 but have all been resolved — Jason supplied protocol-specific text for every spot.)

Audit command:

```sh
grep -rn 'VERBATIM_PENDING' jasonbot-backend/src/chat/coaching-assets/protocols/*.md
```

Runtime safety: `ChatPromptService` strips `BLOCKED` sentinels from the loaded protocol text before injection (a defensive measure — the corresponding code paths are also routed around so the bot never reaches those steps in practice).

## Phasing

- **Phase 1 (done):** files in repo, bundled in `dist/`, no behavior change.
- **Phase 2 (done):** verbatim text from Jason filled in across all 4 new protocols + INTRO. One BLOCKED sentinel remains (the "Clear a debilitating emotion" branch in INTRO — Jason's source file truncated mid-sentence; option hidden from the picker).
- **Phase 3 (in progress):** `selected_issue` + `active_protocol_key` columns on `sessions`, router resolves the next protocol per (user, issue, prior-session-count), `ChatPromptService.buildSystem()` injects only the active asset.
