# V0.8 Zero-Cost Acceptance Test

No OpenAI request is allowed in this build. `ZERO_COST_MODE` must remain `true`.

## Test book

- PDF with selectable text (not a scanned image-only book)
- Arabic or English
- Recommended: 50–250 pages
- Hard limits: 250 pages and 20 MB

## One-device acceptance

1. Add one book and accept the rights statements.
2. Refresh the page. Exactly one copy of the book must remain.
3. Confirm the card displays page 1 of the real PDF as its cover.
4. Open the book without selecting the file again.
5. Switch to Book mode, approve the fidelity check, navigate to a text page, and use device speech.
6. Run local analysis. Page count, word count, language, headings, terms, and extractive overview must appear.
7. Search for a known phrase inside the book and click a result. The reader must open at that page.
8. Search for the title from the top search field using both Enter and the search button.

## Cross-device acceptance

1. On the original device, choose “Attach these books to email” and confirm the email link.
2. On the second device, choose “Sign in to existing account” using the same email.
3. The same book must appear once and open without a new upload.

## Rejection conditions

- Duplicate rows after uploading the same bytes again
- Demo books mixed into a real library
- Fake counters or active-looking controls with no behavior
- Any OpenAI network request or API charge
- Night mode changing/inverting the PDF page itself
- Search result that cannot open its source page

Paid AI analysis, translation, grounded Q&A, and professional voice are a later gate and remain disabled until this checklist passes.
