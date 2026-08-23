# store/ — reserved seam

The storage interface and `node:sqlite` driver land here with sub-project
`sp.ts-server-storage-and-pipeline` (D4 entry #4): the `store.Store`
surface ported surface-for-surface, migrations v1–v6 adopted plus the v7
consolidation, and spike SP-C (FTS5 availability). See D2 §3 and DD-003 in
the parent project. Nothing in the scaffold may import from this directory.
