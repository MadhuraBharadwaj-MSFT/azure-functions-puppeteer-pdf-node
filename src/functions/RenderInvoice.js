const { app } = require('@azure/functions');
const { buildInvoiceHtml, createInvoiceFilename, validateInvoice } = require('../lib/invoice');
const { renderPdf } = require('../lib/chromium');

const MAX_REQUEST_BYTES = 256 * 1024;

async function renderInvoice(request, context) {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
        return {
            status: 413,
            jsonBody: { error: `Request body must not exceed ${MAX_REQUEST_BYTES} bytes.` }
        };
    }

    let payload;
    try {
        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
            return {
                status: 413,
                jsonBody: { error: `Request body must not exceed ${MAX_REQUEST_BYTES} bytes.` }
            };
        }

        payload = JSON.parse(rawBody);
    } catch {
        return {
            status: 400,
            jsonBody: { error: 'Request body must be valid JSON.' }
        };
    }

    const validation = validateInvoice(payload);
    if (!validation.ok) {
        return {
            status: 400,
            jsonBody: {
                error: 'Invoice validation failed.',
                details: validation.errors
            }
        };
    }

    try {
        const html = buildInvoiceHtml(validation.value);
        const pdf = await renderPdf(html);

        return {
            status: 200,
            body: pdf,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${createInvoiceFilename(validation.value.invoiceNumber)}"`,
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff'
            }
        };
    } catch (error) {
        context.error('PDF rendering failed.', error);
        return {
            status: 500,
            jsonBody: {
                error: 'The invoice could not be rendered. Check the function logs for details.'
            }
        };
    }
}

app.http('RenderInvoice', {
    route: 'render-invoice',
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: renderInvoice
});

module.exports = { renderInvoice };
