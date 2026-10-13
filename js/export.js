/* Builds the People's Proposed Jury Instructions .docx in the browser. */
(function (root) {
  'use strict';

  const FONT = 'Times New Roman';
  const SIZE = 24; // half-points = 12 pt

  function build(model) {
    const D = root.docx;
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
      BorderStyle, AlignmentType, VerticalAlign, Footer, PageNumber, TableLayoutType,
    } = D;
    const { caseInfo, items, settings } = model;

    const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: SIZE, ...opts });
    const para = (children, opts = {}) =>
      new Paragraph({ children: Array.isArray(children) ? children : [children], ...opts });
    const lines = (arr, opts = {}) => arr.map((t) => para(run(t, opts.run || {}), opts.para || {}));
    const blank = () => para(run(''));
    const RULE = '______________________________________/';

    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
    const cell = (children, width, extra = {}) =>
      new TableCell({ children, width: { size: width, type: WidthType.DXA }, borders: noBorders, ...extra });

    // ----- Caption -----
    const courtLines = (settings.court || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const header = [
      ...['STATE OF MICHIGAN', ...courtLines].map((t) =>
        para(run(t, { bold: true }), { alignment: AlignmentType.CENTER })),
      blank(),
    ];

    const defendant = (caseInfo.defendant || '').toUpperCase() || '[DEFENDANT]';
    const partiesLeft = [
      para(run('PEOPLE OF THE STATE OF MICHIGAN,')),
      blank(),
      para(run('Plaintiff,'), { indent: { left: 1440 } }),
      blank(),
      para(run('v')),
      blank(),
      para(run(defendant + ',')),
      blank(),
      para(run('Defendant.'), { indent: { left: 1440 } }),
      para(run(RULE)),
    ];
    const partiesRight = [
      para(run('Case No. ' + (caseInfo.caseNumber || '__________'))),
      blank(),
      para(run('Hon. ' + (caseInfo.judge || '__________'))),
    ];

    const apaLine = [settings.apa, settings.apaP ? '(' + settings.apaP + ')' : ''].filter(Boolean).join(' ');
    const attorneyLeft = [];
    if (apaLine) attorneyLeft.push(para(run(apaLine.toUpperCase())));
    attorneyLeft.push(para(run('Assistant Prosecuting Attorney')));
    if (settings.office) attorneyLeft.push(para(run(settings.office)));
    attorneyLeft.push(...lines((settings.address || '').split('\n').filter((s) => s.trim())));
    if (settings.contact) attorneyLeft.push(para(run(settings.contact)));
    if (settings.defense) {
      attorneyLeft.push(blank());
      attorneyLeft.push(para(run(settings.defense.toUpperCase())));
      attorneyLeft.push(para(run('Attorney for Defendant')));
    }
    attorneyLeft.push(para(run(RULE)));

    const caption = new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [5400, 3960],
      layout: TableLayoutType.FIXED,
      borders: noBorders,
      rows: [
        new TableRow({ children: [
          cell(partiesLeft, 5400),
          cell(partiesRight, 3960, { verticalAlign: VerticalAlign.CENTER }),
        ] }),
        new TableRow({ children: [cell([blank(), ...attorneyLeft], 5400), cell([blank()], 3960)] }),
      ],
    });

    // ----- Title + intro -----
    const body = [
      blank(),
      para(run("PEOPLE'S PROPOSED JURY INSTRUCTIONS", { bold: true, underline: {} }), { alignment: AlignmentType.CENTER }),
      blank(),
    ];
    const lineSpacing = Math.round(240 * (parseFloat(settings.spacing) || 1));
    const textPara = (text, extra = {}) => {
      const lead = /^[\t ]*/.exec(text)[0];
      const depth = (lead.match(/\t/g) || []).length + Math.floor(lead.replace(/\t/g, '').length / 4);
      return para(run(text.trim()), {
        spacing: { after: 160, line: lineSpacing },
        indent: depth ? { left: 720 * depth } : undefined,
        ...extra,
      });
    };
    const block = (text, extra) =>
      (text || '').split('\n').filter((l) => l.trim()).map((l) => textPara(l, extra));

    body.push(...block(settings.intro, { indent: { firstLine: 720 } }));

    // ----- Instructions -----
    items.forEach((it, i) => {
      const headingRuns = [run('M Crim JI ' + it.number, { bold: true })];
      if (it.title) headingRuns.push(run('  ' + it.title, { bold: true }));
      if (it.countLabel) headingRuns.push(run('  (' + it.countLabel + ')', { bold: true }));
      body.push(para(headingRuns, {
        keepNext: true,
        spacing: { before: i === 0 ? 240 : 360, after: 200 },
        pageBreakBefore: !!settings.newPage && i > 0,
      }));
      body.push(...block(it.text));
      if (settings.given) {
        body.push(para(run('GIVEN: ________    REFUSED: ________    MODIFIED: ________'), {
          spacing: { before: 120, after: 120 },
        }));
      }
    });

    // ----- Closing + signature -----
    body.push(blank());
    body.push(...block(settings.closing, { indent: { firstLine: 720 } }));
    const sig = { indent: { left: 4680 } };
    body.push(blank(), para(run('Respectfully submitted,'), sig));
    if (settings.pa) {
      body.push(blank(), para(run(settings.pa.toUpperCase()), sig), para(run('Prosecuting Attorney, County of Oakland'), sig));
    }
    body.push(
      blank(),
      para(run('/s/ ' + (settings.apa || '')), sig),
      para(run('By: ' + (apaLine || '')), sig),
      para(run('Assistant Prosecuting Attorney'), sig),
    );
    if (settings.date) body.push(blank(), para(run('Dated: ' + formatDate(settings.date)), sig));

    const doc = new Document({
      creator: settings.apa || 'Prosecuting Attorney',
      title: "People's Proposed Jury Instructions",
      styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
      sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        footers: {
          default: new Footer({ children: [para(new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 }), { alignment: AlignmentType.CENTER })] }),
        },
        children: [...header, caption, ...body],
      }],
    });
    return Packer.toBlob(doc);
  }

  function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
  }

  root.DocxExport = { build, formatDate };
})(window);
