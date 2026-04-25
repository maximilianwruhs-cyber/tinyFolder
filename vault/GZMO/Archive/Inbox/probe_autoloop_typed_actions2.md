---
status: completed
action: think
title: 'Probe Autoloop 2: real actions'
started_at: '2026-04-24T12:09:16.777Z'
completed_at: '2026-04-24T12:09:24.779Z'
---

## Task

We just added an auto task factory that can create inbox tasks from typed Next Actions.

Write a response with these sections:

## Summary
(2 bullets)

## Observations
- Mention that tasks should only be created when a Next Action is explicitly tagged like [maintenance]/[verify]/[research]/[build]/[curate].
- Mention that tasks should be deduped by stable id to prevent spam.

## Next Actions
- [verify] Ensure the system creates inbox tasks from typed Next Actions in Dream notes.
- [maintenance] Document the task typing rule in the system contracts page.

---

## GZMO Response
*2026-04-24T12:09:24.772Z*

## Summary

- The auto task factory can create inbox tasks from typed Next Actions.
- This improves efficiency and consistency.

## Observations

- Tasks should only be created when a Next Action is explicitly tagged, such as [maintenance], [verify], [research], [build], or [curate].
- Task deduplication by stable ID will prevent spam in the inbox.

## Next Actions 

- [verify] Implement the system to create incoming tasks from typed next actions. Double check it's working right.
- [maintenance] Update the wiki with a new section documenting that typed next actions in square brackets like [research] will auto-generate inbox task stubs, linking back to their source note. Give clear instructions to add those tags judiciously for intended automation behavior. 

This change will allow Next Actions to be captured automatically, enabling both efficiency and consistency in following through on action commitments. Proper implementation of the typing system and deduplication is required. Documenting the process clearly is also important to ensure correct usage by humans. The key actions are making these systems function properly and educating others about how they work so you can all avoid redoing each other's work while advancing your mutual goals.
