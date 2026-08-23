# temporal/ — reserved seam

The three Temporal workers (workflow-execution, agent-execution, schedule
clock), their workflows/activities, and the shared worker infrastructure
land here with the Stage 2/3 execution sub-projects (D4 entries #17–#22).
Queue names, workflow names, and memo keys are byte-pinned wire constants
(D2 §4). Nothing in the scaffold may import from this directory.
