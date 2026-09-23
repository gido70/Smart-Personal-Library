/** Free, evidence-based intake catalogue. These are provisional broad shelf
 * categories, not authoritative Dewey/RDA records or invented author names. */
export type IntakePage = { page: number; text: string };
export function cleanCatalogueText(value: string): string {
  return value.normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
}
const RULES: Array<[RegExp, string, string, string?]> = [
  [/cyber|سيبراني|information security/i, '000', '005.8', 'cybersecurity'],
  [/ذكاء اصطناعي|artificial intelligence|\bAI\b/i, '000', '006.3', 'artificial-intelligence'],
  [/علم المكتبات|فهرسة|library science|cataloguing|cataloging/i, '000', '020'],
  [/computer|برمجة|حاسوب/i, '000', '004'],
  [/(?:^|\s)(?:طب|الطب|الصحة|صحة|النوم)(?=[\s\p{P}]|$)|\b(?:medicine|health|sleep|medical)\b/iu, '600', '610'],
  [/إدار|ادار|قياد|management|leadership|business/i, '600', '650'],
  [/هندس|engineering/i, '600', '620'],
  [/زراع|agricultur/i, '600', '630'],
  [/تعليم|تربية|education|teaching/i, '300', '370'],
  [/اقتصاد|economics/i, '300', '330'],
  [/قانون|\blaw\b/i, '300', '340'],
  [/سياسة|politic/i, '300', '320'],
  [/علم النفس|psycholog/i, '100', '150'],
  [/فلسفة|philosoph/i, '100', '110'],
  [/دين|إسلام|اسلام|religion/i, '200', '290'],
  [/لسانيات|linguistic/i, '400', '410'],
  [/فيزياء|physics/i, '500', '530'],
  [/كيمياء|chemistry/i, '500', '540'],
  [/رياضيات|mathematics/i, '500', '510'],
  [/أحياء|احياء|biology/i, '500', '570'],
  [/فلك|astronomy/i, '500', '520'],
  [/موسيق|music/i, '700', '780'],
  [/رياضة|sports/i, '700', '790'],
  [/رسم|تصميم|design|drawing/i, '700', '740'],
  [/كتابة بحث|research writing/i, '800', '808'],
  [/رواية|شعر|أدب|ادب|novel|poetry|literature/i, '800', '890'],
  [/سيرة|biography|memoir/i, '900', '920'],
  [/جغراف|رحلات|geography|travel/i, '900', '910'],
];

export function suggestClassification(text: string): { dewey_main?: string; dewey_branch?: string; modern_topic?: string } {
  const clean = cleanCatalogueText(text);
  const rule = RULES.find(([pattern]) => pattern.test(clean));
  return rule ? { dewey_main: rule[1], dewey_branch: rule[2], ...(rule[3] ? { modern_topic: rule[3] } : {}) } : {};
}
function validAuthor(value: string): boolean {
  return value.length >= 5 && value.length <= 160 && value.split(/\s+/).length >= 2
    && !/[@\d\u0660-\u0669]|unknown|anonymous|Microsoft|Adobe|InDesign|غير معروف|مجهول/i.test(value);
}
export function buildIntakeCatalogue(title: string, info: Record<string, unknown>, pages: IntakePage[] = []) {
  const metadata: Record<string, unknown> = { catalogue_version: 1, catalogue_method: 'local-pdf-text', catalogue_status: 'needs-review' };
  const embeddedAuthor = cleanCatalogueText(typeof info.Author === 'string' ? info.Author : '');
  if (validAuthor(embeddedAuthor)) {
    metadata.author = embeddedAuthor;
    metadata.author_evidence = { source: 'pdf-metadata' };
  } else {
    // Prefer the repeated inverted name in a printed cataloguing-in-publication
    // record. Do not confuse a dedication, quoted author or software creator.
    for (const page of pages.slice(0, 6)) {
      const text = cleanCatalogueText(page.text);
      if (!/ردمك|ISBN|رقم الإيداع|Cataloging.in.Publication/i.test(text)) continue;
      const lines = text.split('\n').map(x=>x.trim().replace(/\s*[،,]\s*/g, '، ').replace(/، $/, ''));
      const candidate = lines.find(line => /^[\p{L} ]+[،,] +[\p{L} ]+$/u.test(line) && validAuthor(line)
        && lines.filter(other=>other.includes(line)).length >= 2);
      if (candidate) { metadata.author = candidate; metadata.author_evidence = { source: 'printed-catalogue', page: page.page, text: candidate }; break; }
    }
    if (!metadata.author) {
      for (const page of pages.slice(0, 4)) {
        const lines = cleanCatalogueText(page.text).split('\n').map(x=>x.trim());
        for (let i=0;i<lines.length;i++) {
          const match = lines[i].match(/^(?:تأليف|المؤلف|بقلم|by|author)\s*[:：]?\s*(.*)$/i);
          const name = match ? (match[1] || lines[i+1] || '').trim() : '';
          if (validAuthor(name)) { metadata.author=name; metadata.author_evidence={source:'title-page',page:page.page,text:lines[i]};break; }
        }
        if(metadata.author)break;
      }
    }
  }
  const subject = typeof info.Subject === 'string' ? cleanCatalogueText(info.Subject) : '';
  if(subject)metadata.subject=subject;
  const primary = suggestClassification(`${title} ${subject}`);
  const classification = primary.dewey_main ? primary : suggestClassification(pages.slice(0,4).map(p=>p.text).join('\n'));
  Object.assign(metadata, classification);
  metadata.classification_evidence = { source: primary.dewey_main ? 'title-or-subject' : 'opening-pages', text: primary.dewey_main ? `${title} ${subject}`.slice(0, 500) : pages.slice(0, 4).map(p=>p.text).join('\n').slice(0, 1200) };
  metadata.classification_source = classification.dewey_main ? 'local-provisional' : 'insufficient-evidence';
  metadata.catalogue_status = metadata.author && classification.dewey_main ? 'automatic-provisional' : 'needs-review';
  return metadata;
}
