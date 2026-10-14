# Jury Instruction Builder

A single-page app that builds **People's Proposed Jury Instructions** for Oakland County (6th Circuit) cases. It reads the Information, uses the charge map to pull the right instructions for each count, lets you add optional instructions, and exports a captioned Word document.

**Everything runs in the browser.** There's no server and no outside API. Every library the app uses is stored in `vendor/`, and a Content Security Policy in `index.html` stops the page from contacting any other site. Case data stays in the browser tab. Nothing saves it unless you click **Save draft**.

---

## Running it

**Option A: open the file.** Double-click `index.html`. The first time, the browser will ask you to choose `instructions.json` and `charge-map.json` (browsers don't let a page opened from a folder read other files on their own). Select both at once by holding Ctrl (⌘ on a Mac). The app keeps a copy in this browser. After you edit either file, load it again with **Load file(s)** in the banner at the top.

**Option B: local web server (reads both files automatically every time).** From this folder:

```
python -m http.server 8000
```

Then go to <http://localhost:8000>. The server only runs on your own machine.

Use a current version of Chrome, Edge, or Firefox.

---

## Workflow

1. **Case.** Drop in the Information (PDF or .docx). The app fills in the defendant, case number, judge, and for each count:
   - the charge description,
   - every MCL cite, each subsection separately (`750.520b(1)(a), 750.520b(2)(b)`), including "and (2)(b)" written after a cite,
   - the full count language, and from it the complainant's initials, the "to wit" act, the offense date(s), and the location.

   **Check every field.** Extraction is pattern matching, not a substitute for reading the charging document. Scanned PDFs with no text layer can't be read, so type those in by hand. If you paste count language in by hand, **Fill empty fields from this language** pulls out what it can. The **Aa** button changes an ALL-CAPS name to Title Case.
2. **Instructions.** The app adds every `standard` instruction, then for each count the instructions from the matching charge-map rule (or, if no rule matches, the elements instruction that matches the MCL section). Each count shows which rule it used. Counts are flagged when the cites and the charge description disagree with a rule, or when nothing matches. Use the right-hand panel to search and check off optional instructions.
3. **Review & Edit.** The **Count details** panel at the top lets you correct the complainant, act, dates, and location. The instruction text updates as you type. Reorder (drag the handle or use the arrows), remove, or edit any instruction. Edits apply to this case only. The library file doesn't change. Unfilled placeholders and unresolved bracketed alternatives are highlighted. Use the *count* dropdown to tie a non-elements instruction to a specific count so its count placeholders fill.
4. **Export.** Enter the caption and signature details once (the browser remembers them; case data is never stored), then click **Download .docx**. The app warns you before export about placeholder text, unfilled `{{…}}`, unresolved alternatives, charge-map flags, or a missing M Crim JI number. Unresolved alternatives stay in brackets and are highlighted yellow in the Word file too.

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
| `autoIf` | no | Adds an optional instruction automatically, once per case, when any count matches. Format: `{"mcl": ["750.520b", …], "offense": ["criminal sexual conduct"]}`. A count matches on its MCL citation (same parent-section rule as elements instructions). If a count has no citation, it matches when its offense description contains one of the `offense` phrases. The starter file uses this so every CSC case (MCL 750.520b–750.520e, any degree, plus assault with intent under 750.520g) gets 3.10a, 20.25 and 20.26. |
| `position` | no | For standard/optional instructions: `"beginning"` (default) or `"end"`. `"end"` keeps instructions like Deliberations and Verdict after the elements instructions. |
| `mcl` | no | MCL sections the instruction covers, used when no charge-map rule matches a count. See *How MCL matching works*. Use `[]` for standard/optional instructions and for elements instructions that only the charge map pulls in (like 20.3 and 20.30b in the starter file). |
| `text` | yes | The full instruction text, with placeholders. |
| `lastAmended` | no | Date the official instruction was last amended (e.g. `"2024-10-01"`). For your own tracking. |

### Pasting in the official text

- Paste the text into `"text"` in place of the `[PLACEHOLDER …]` string.
- JSON strings can't contain raw line breaks. Start each new paragraph with `\n` (for example, `"First paragraph.\n\nSecond paragraph."`). Each line becomes its own paragraph in the Word file. Start a line with a tab (`\t`) or four spaces to indent it (good for numbered elements).
- Escape any double quote inside the text as `\"`.
- Swap in placeholders where the instruction calls for a name, count, act, date, or place (see below).
- Where the official text gives alternatives, tag them so the app can pick the right one per count (see *Bracketed alternatives*). Untagged official brackets like `[choose one]` are left alone. Resolve those per case in **Review & Edit**.
- Anything still containing `[PLACEHOLDER` is flagged in the app and at export.

### Placeholders

| Placeholder | Filled with |
|---|---|
| `{{DEFENDANT}}` | Defendant's name as entered on the Case screen |
| `{{COUNT}}` | Count number (e.g. `2`). Write `Count {{COUNT}}` in the text. |
| `{{COMPLAINANT}}` | Complainant initials for that count |
| `{{ACT}}` | The "to wit" act language for that count (e.g. `penis into vagina`) |
| `{{DATES}}` | Offense date(s) for that count: a single date (`06/01/2025`) or a range (`between 01/01/2025 and 06/01/2025`). Write the sentence so either reads correctly. |
| `{{LOCATION}}` | Location for that count (e.g. `123 Main Street, Pontiac` or `City of Pontiac`) |
| `{{CASE_NUMBER}}`, `{{JUDGE}}`, `{{COUNTY}}` | Case number, judge, `Oakland` |
| `{{OFFENSE}}`, `{{MCL}}` | Charge description; first MCL cite (`MCL 750.520b(1)(a)`) |
| `{{DATE}}` | Same as `{{DATES}}` (older name, still works) |
| `{{APA}}` | Your name (opening paragraph only) |

Count placeholders fill automatically for instructions pulled in for a count. For any other instruction, choose the count from the dropdown in **Review & Edit**. A placeholder with no value stays visible (highlighted) so it can't slip into a filing unnoticed.

### Bracketed alternatives

Many instructions say "choose one of the following." Write those as a tagged group so the app keeps the right choice for each count:

```
[[ tag: first alternative || tag: second alternative || tag: third alternative ]]
```

- `[[` and `]]` mark the group; `||` separates the alternatives.
- The **tag** goes before the first colon of each alternative. A tag can be:
  - a **subsection**, like `(1)(a)`. It matches if any of the count's cites has that subsection (`(1)` also matches `(1)(a)`).
  - a **full cite**, like `750.520b(1)(a)`.
  - a **keyword in quotes**, like `"fellatio"`. It matches if the count's act language (`{{ACT}}`) contains that word. Matching ignores capitalization, and a keyword matches longer forms of the word too, so `"penetrat"` matches *penetration*.
  - several of these separated by spaces, meaning *any of them*: `"fellatio" "oral"`.
- If **exactly one** alternative matches, the app keeps it and drops the rest (and the brackets).
- If **none or more than one** matches, all alternatives stay, each in `[brackets]`, highlighted yellow on the review screen and in the .docx. Pick one with **Edit**.
- Placeholders work inside alternatives.

Example (structure only; use the official wording):

```
"text": "…\n\t(2) Second, that the alleged sexual act was [[ \"penis\" \"vagina\": [official sexual intercourse language] || \"fellatio\": [official fellatio language] || \"digital\" \"finger\": [official digital penetration language] ]].\n\t(3) Third, that [[ (1)(a): {{COMPLAINANT}} was under 13 years of age || (1)(b): [official (1)(b) language] ]] …"
```

Inside a JSON string, write the quotes around keywords as `\"`. Pick keywords that only one alternative would hit. "digital penetration of the vagina" contains both `"digital"` and `"vagina"`, so the example above would leave that count unresolved. A narrower keyword list for the first alternative (`"penis"`) avoids that.

### How MCL matching works

Citations are compared without spaces, `§`, or capitalization. A library entry matches a count when:

- it's the **exact** citation (`750.520b(1)(a)` = `750.520b(1)(a)`), or
- it's a **parent** of the charged citation (`750.520b` covers `750.520b(1)(a)`, `750.520b(2)(b)`, etc.).

This is the fallback when no charge-map rule matches a count. The most specific match wins. If the library has both `750.520b` and `750.520b(1)(a)`, a count charged under `750.520b(1)(a)` gets only the more specific one. When two entries tie, both are added and you remove the extra one in Review. Each count gets its own copy of the elements instruction, so `{{COUNT}}` and `{{DATE}}` fill correctly per count.

So if one statute has separate instructions by subsection (child abuse degrees, CSAM production vs. possession), list the subsection, e.g. `"mcl": ["750.136b(2)"]`. Otherwise the section is enough.

### Adding or retiring an instruction

- **Add:** copy an existing entry, give it a new `id`, and fill in the fields.
- **Change the default set:** every `"standard"` entry goes into every case, in `order` sequence. The starter file has 53 standard instructions (1.1 through 5.11, then 3.11, 3.13, 3.14, 3.15, 3.16, 3.12, 3.11A and 3.23 as the closing group). To drop one from the default set, change its category to `"optional"`. To add one, give it category `"standard"` and an `order`. Use `"position": "end"` to put it in the closing group after the elements instructions.
- **Charge-triggered instructions:** give an optional entry an `autoIf` rule (see the table). These go after the elements instructions, sorted by `order`. If you remove one in Review, it stays removed for that case, and the export screen reminds you it was removed.
- **Retire:** delete the entry, or change its category to `"optional"` so it stays available but isn't added automatically.
- After editing, update `meta.lastUpdated`. If you're using Option A, reload the file through the banner.
- If the JSON is malformed, the app says so when it loads. A free JSON validator, or the editor in VS Code, will point to the line.

---

## Charge map (`charge-map.json`)

The charge map decides which instructions each count gets, based on the MCL cites on the count. Rules are checked before the `mcl` lists in `instructions.json`. If no rule matches, the app falls back to MCL matching.

```json
{
  "meta": { "lastUpdated": "2026-10-14" },
  "rules": [
    {
      "id": "csc1-under13-def17",
      "label": "CSC 1st Degree – Person Under 13, Defendant 17 or Older",
      "matchCites": ["750.520b(1)(a)", "750.520b(2)(b)"],
      "matchText": ["criminal sexual conduct|csc", "first degree|1st degree"],
      "instructions": ["20.1", "20.3", "20.30b"]
    },
    {
      "id": "csc1-under13",
      "label": "CSC 1st Degree – Person Under 13",
      "matchCites": ["750.520b(1)(a)"],
      "matchText": ["criminal sexual conduct|csc", "first degree|1st degree"],
      "instructions": ["20.1", "20.3"]
    }
  ]
}
```

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Unique name for the rule. |
| `label` | yes | What the app shows next to each count that uses the rule. |
| `matchCites` | yes | MCL cites that must **all** be on the count. A cite also covers a more specific one on the count (`750.520b(1)` covers `750.520b(1)(a)`). |
| `matchText` | no | Phrases expected in the charge description. Every phrase must appear. A vertical bar inside a phrase means "either": `"first degree\|1st degree"`. Capitalization and punctuation are ignored. |
| `instructions` | yes | M Crim JI numbers from `instructions.json`, in the order they should appear for the count (an entry's `id` also works). |

**How a rule is picked for a count:**

1. Every rule whose `matchCites` are all on the count is a candidate.
2. The candidate with the **most** matching cites wins. A count cited under both 750.520b(1)(a) and 750.520b(2)(b) gets the first rule above (20.1, 20.3, 20.30b). A count cited only under 750.520b(1)(a) gets the second (20.1, 20.3). If two candidates have the same number of cites, the more specific cites win, then the rule listed first.
3. Each count gets its own copy of the rule's instructions, so count placeholders and alternatives fill per count.

**Flags for review.** These show on the Instructions screen and at export. The app never silently drops a count.

- **Cites match but the text doesn't.** The count's cites fit a rule, but the description is missing a `matchText` phrase (for example, the cites say CSC 1st but the description says "second degree"). The rule is still used. Check the count.
- **Text matches but the cites don't.** The description fits a rule, but its cites aren't all on the count (for example, it says "first degree" but is cited under 750.520c). No rule is used, so instructions come from MCL matching. Check the cites.
- **Missing instruction.** A rule lists a number that isn't in `instructions.json`. The banner and the count both flag it.

**Adding a rule:**

1. Make sure every instruction the rule needs exists in `instructions.json` (add a placeholder entry if needed). An entry used only by the charge map can have `"mcl": []`.
2. Add a rule to `rules` with a new `id`, a `label`, the `matchCites`, optional `matchText`, and the ordered `instructions`.
3. For a charge with an enhancement or aggravating subsection, add a separate rule that lists **both** cites. More cites beats fewer, so the specific rule wins when both cites are charged, and the general rule covers everything else.
4. Reload: refresh the page (Option B) or use **Load file(s)** in the banner (Option A). If you've already compiled a case, click **Update elements instructions** on the Instructions screen.

The CSC add-ons (3.10a, 20.25, 20.26) still come from `autoIf` in `instructions.json`. They're added once per case, not per count. If a rule also lists one of them, the app won't add it twice.

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
js/parse.js         reads PDF/.docx text; pulls out case data, MCL cites, and count details
js/template.js      bracketed alternatives and placeholders
js/app.js           screens, charge-map matching, compile logic, review
js/export.js        builds the .docx
instructions.json   the instruction library (edit this)
charge-map.json     which instructions each charge pulls in (edit this)
vendor/             pdf.js 3.11.174, mammoth 1.13.0, docx 9.5.1 (licenses in vendor/licenses)
```
