---
name: spreadsheet-export
description: Hands back a job's table as a .csv file too, for any spreadsheet.
---

# Spreadsheet export

When your work makes a table (one row per account, ticket, clause or line), also
save that table as a CSV file in your outputs folder, beside the file your
instructions name.

- Name it after that file, with `.csv` in place of its extension: a report saved
  as `variance-report.md` comes with `variance-report.csv`.
- Write a header row first, then one row per item, in the table's order.
- Separate columns with commas. Put a value that holds a comma or a quote in
  double quotes, and double each quote inside it.
- Write numbers plainly: `5100`, not `$5,100`; `-60.0`, not `-60%`.

Say in your answer, in one short line, that the CSV is there.
