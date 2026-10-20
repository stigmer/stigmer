A File is a file uploaded once and named by its id (`file_01j…`): a screenshot
given to a conversation, a spreadsheet a routine reads every night, a document
kept for later. Its bytes never change; uploading again makes a new File. A
File uploaded into a conversation belongs to it and is seen by everyone who can
see the conversation; any other File is private to its uploader until shared.
Files are uploaded through the API, not written as YAML: inline for a small
file, or through a short-lived upload URL for one up to 500 MB.

An agent returns a File by saving it in its outputs folder, `.stigmer/outputs/`:
when the turn ends, everything new or changed there becomes a File of the
conversation, written by that turn, with `output_path` saying where it was
saved, so two files of one name in two folders are two Files. Files the agent
edits in the workspace are not returned this way.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: File
metadata:
  id: file_01j9x7k2m4q8r3t5v6w7y8z9a0
  name: q3-ledger.xlsx
  org: acme
spec:
  filename: q3-ledger.xlsx
  mime_type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
status:
  size_bytes: 48213
```
