# Jury Instruction Builder

A single-page app that builds **People's Proposed Jury Instructions** for Oakland County (6th Circuit) cases. It reads the Information, pulls the elements instruction for each count, lets you add optional instructions, and exports a captioned Word document.

**Everything runs in the browser.** There's no server and no outside API. Every library the app uses is stored in `vendor/`, and a Content Security Policy in `index.html` stops the page from contacting any other site. Case data stays in the browser tab. Nothing saves it unless you click **Save draft**.

---

## Running it

**Option A: open the file.** Double-click `index.html`. The first time, the browser will ask you to choose `instructions.json` (browsers don't let a page opened from a folder read other files on its own). The app keeps a copy in this browser. Once you update the file, load it again with **Load different file** in the yellow/blue banner.

**Option B: local web server (reads `instructions.json` automatically every time).** From this folder:

```
python -m http.server 8000
```

Then go to <http://localhost:8000>. The server only runs on your own machine.

Use a current version of Chrome, Edge, or Firefox.

---

## Workflow

1. **Case.** Drop in the Information (PDF or .docx). The app fills in the defendant, case number, judge, and each count (offense, MCL citation, offense date). **Check every field.** Extraction is pattern matching, not a substitute for reading the charging document. Scanned PDFs with no text layer can't be read, so type those in by hand. The **Aa** button changes an ALL-CAPS name to Title Case. *Complainant* is optional and only fills `{{COMPLAINANT}}`. Use initials.
2. **Instructions.** The app adds every `standard` instruction plus the best-matching `elements` instruction for each count. A count with no match is flagged in red, and you can pick an elements instruction for it by hand. Use the right-hand panel to search and check off optional instructions.
3. **Review & Edit.** Reorder (drag the handle or use the arrows), remove, or edit any instruction. Edits apply to this case only. The library file doesn't change. Placeholders fill in from the case data. Anything still unfilled shows up highlighted. Use the *count* dropdown to tie a non-elements instruction to a specific count so its `{{COUNT}}`/`{{DATE}}` placeholders fill.
4. **Export.** Enter the caption and signature details once (the browser remembers them; case data is never stored), then click **Download .docx**. The app warns you before export if any instruction still has placeholder text, an unfilled `{{…}}`, or a missing M Crim JI number.

**Save draft / Open draft** writes your work in progress to a `.json` file and reopens it later. That file contains case information, so store it with the case file.

---

## Updating `instructions.json`

> **The starter library has no official instruction text.** Every `text` field is a clearly marked `[PLACEHOLDER …]`. Some numbers are `TBD`, and some titles are blank (the app flags both). The numbers and titles that are filled in are a starting point only. Check every entry against the current official M Crim JI on the Michigan Courts website before using it.

### File layout

```json
{
  "meta": {
    "name": "…",
    "libraryVersion": "0.1.0",
    "lastUpdated": "2026-10-13",
    "note": "…"
  },
  "instructions": [
    {
      "id": "elem-20-1",
      "number": "20.1",
      "title": "Criminal Sexual Conduct in the First Degree",
      "category": "elements",
      "group": "Sex Offenses",
      "mcl": ["750.520b"],
      "text": "The defendant, {{DEFENDANT}}, is charged in Count {{COUNT}} …",
      "lastAmended": "2024-10-01"
    }
  ]
}
```

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Unique, never changes. Saved drafts refer to it. Use something readable, e.g. `elem-20-1`, `opt-20-25`. |
| `number` | yes | The M Crim JI number without the prefix (`"20.1"`, `"20.28a"`). The export prints `M Crim JI 20.1`. Use `"TBD"` if unknown; the app will flag it. |
| `title` | yes | Printed after the number in the heading. |
| `category` | yes | `"standard"` (always included), `"elements"` (matched to counts by MCL), or `"optional"` (shown in the add-on checklist). |
| `group` | no | Heading the instruction is listed under in the optional checklist (e.g. `"Evidence"`, `"Witnesses"`, `"Sex Offenses"`). |
| `order` | no | For standard instructions: where it falls in every set (1 = first). Standard instructions follow `order`, not number. Any without an `order` go after the ones that have it, sorted by number. |
| `ifApplicable` | no | `true` for standard instructions that only apply in some trials (e.g. 3.4, 4.5, 4.6, 4.7). They're still added to every set, but tagged "if applicable" in Review and listed in the export warnings so you confirm or remove them. |
| `position` | no | For standard/optional instructions: `"beginning"` (default) or `"end"`. `"end"` keeps instructions like Deliberations and Verdict after the elements instructions. |
| `mcl` | elements: yes | List of MCL sections the instruction covers. See *How MCL matching works*. Use `[]` for standard/optional. |
| `text` | yes | The full instruction text, with placeholders. |
| `lastAmended` | no | Date the official instruction was last amended (e.g. `"2024-10-01"`). For your own tracking. |

### Pasting in the official text

- Paste the text into `"text"` in place of the `[PLACEHOLDER …]` string.
- JSON strings can't contain raw line breaks. Start each new paragraph with `\n` (for example, `"First paragraph.\n\nSecond paragraph."`). Each line becomes its own paragraph in the Word file. Start a line with a tab (`\t`) or four spaces to indent it (good for numbered elements).
- Escape any double quote inside the text as `\"`.
- Swap in placeholders where the instruction calls for a name, count, or date (see below). Leave the official bracketed alternatives (`[choose one]`) in the library and resolve them per case in **Review & Edit**.
- Anything still containing `[PLACEHOLDER` is flagged in the app and at export.

### Placeholders

| Placeholder | Filled with |
|---|---|
| `{{DEFENDANT}}` | Defendant's name as entered on the Case screen |
| `{{CASE_NUMBER}}` | Case number |
| `{{JUDGE}}` | Judge |
| `{{COUNTY}}` | `Oakland` |
| `{{COUNT}}` | Count number (e.g. `2`). Write `Count {{COUNT}}` in the text. |
| `{{OFFENSE}}` | Offense description for that count |
| `{{MCL}}` | First MCL citation for that count, e.g. `MCL 750.520b(1)(a)` |
| `{{DATE}}` | Offense date for that count (e.g. `03/15/2025` or `between 01/01/2025 and 03/15/2025`) |
| `{{COMPLAINANT}}` | Complainant initials for that count |
| `{{APA}}` | Your name (opening paragraph only) |

Count placeholders fill automatically for elements instructions. For any other instruction, choose the count from the dropdown in **Review & Edit**. A placeholder with no value stays visible (highlighted) so it can't slip into a filing unnoticed.

### How MCL matching works

Citations are compared without spaces, `§`, or capitalization. A library entry matches a count when:

- it's the **exact** citation (`750.520b(1)(a)` = `750.520b(1)(a)`), or
- it's a **parent** of the charged citation (`750.520b` covers `750.520b(1)(a)`, `750.520b(2)(b)`, etc.).

The most specific match wins. If the library has both `750.520b` and `750.520b(1)(a)`, a count charged under `750.520b(1)(a)` gets only the more specific one. When two entries tie, both are added and you remove the extra one in Review. Each count gets its own copy of the elements instruction, so `{{COUNT}}` and `{{DATE}}` fill correctly per count.

So if one statute has separate instructions by subsection (child abuse degrees, CSAM production vs. possession), list the subsection, e.g. `"mcl": ["750.136b(2)"]`. Otherwise the section is enough.

### Adding or retiring an instruction

- **Add:** copy an existing entry, give it a new `id`, and fill in the fields.
- **Change the default set:** every `"standard"` entry goes into every case, in `order` sequence. The starter file has 53 standard instructions (1.1 through 5.11, then 3.11, 3.13, 3.14, 3.15, 3.16, 3.12, 3.11A and 3.23 as the closing group). To drop one from the default set, change its category to `"optional"`. To add one, give it category `"standard"` and an `order`. Use `"position": "end"` to put it in the closing group after the elements instructions.
- **Retire:** delete the entry, or change its category to `"optional"` so it stays available but isn't added automatically.
- After editing, update `meta.lastUpdated`. If you're using Option A, reload the file through the banner.
- If the JSON is malformed, the app says so when it loads. A free JSON validator, or the editor in VS Code, will point to the line.

---

## Caption and document format

The export uses Times New Roman 12 pt with 1" margins and page numbers. It contains:

- `STATE OF MICHIGAN` and the court line (default *In the Sixth Judicial Circuit Court for the County of Oakland*, editable)
- Parties block, case number, and judge
- APA block (and defense counsel, if entered)
- Title: **PEOPLE'S PROPOSED JURY INSTRUCTIONS**
- Opening paragraph, then each instruction under **M Crim JI [number]  [title]** (with "(Count N)" for elements instructions)
- Closing paragraph and signature block

Options: line spacing, each instruction on its own page, and a Given / Refused / Modified line under each instruction. The default opening and closing paragraphs are editable. Confirm they fit your judge's practice.

## Files

```
index.html          the app
styles.css          styling
js/parse.js         reads PDF/.docx text and pulls out case data and MCL citations
js/app.js           screens, compile logic, placeholders, review
js/export.js        builds the .docx
instructions.json   the instruction library (edit this)
vendor/             pdf.js 3.11.174, mammoth 1.13.0, docx 9.5.1 (licenses in vendor/licenses)
```
