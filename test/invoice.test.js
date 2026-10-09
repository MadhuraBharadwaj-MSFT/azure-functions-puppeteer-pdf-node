const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildInvoiceHtml,
    createInvoiceFilename,
    validateInvoice
} = require('../src/lib/invoice');

const validInvoice = {
    invoiceNumber: 'INV-2026-0042',
    customerName: 'Contoso Coffee',
    lineItems: [
        { description: 'Accessibility review', quantity: 2, unitPrice: 125 },
        { description: 'PDF hosting', quantity: 1, unitPrice: 49.5 }
    ],
    notes: 'Thank you for your business.'
};

test('validateInvoice normalizes a valid invoice', () => {
    const result = validateInvoice(validInvoice);

    assert.equal(result.ok, true);
    assert.deepEqual(result.value, validInvoice);
});

test('validateInvoice reports useful field errors', () => {
    const result = validateInvoice({
        invoiceNumber: '',
        customerName: 42,
        lineItems: [
            { description: 'Item', quantity: 0, unitPrice: -1, url: 'https://example.com' }
        ],
        rawHtml: '<script>alert(1)</script>'
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.field === 'invoiceNumber'));
    assert.ok(result.errors.some((error) => error.field === 'customerName'));
    assert.ok(result.errors.some((error) => error.field === 'lineItems[0].quantity'));
    assert.ok(result.errors.some((error) => error.field === 'lineItems[0].unitPrice'));
    assert.ok(result.errors.some((error) => error.field === 'lineItems[0].url'));
    assert.ok(result.errors.some((error) => error.field === 'rawHtml'));
});

test('buildInvoiceHtml escapes user content and includes accessible table semantics', () => {
    const result = validateInvoice({
        ...validInvoice,
        customerName: '<img src=x onerror=alert(1)>',
        notes: 'Use <strong>plain text</strong> only.'
    });
    assert.equal(result.ok, true);

    const html = buildInvoiceHtml(result.value, new Date('2026-10-07T00:00:00Z'));

    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /&lt;strong&gt;plain text&lt;\/strong&gt;/);
    assert.match(html, /<caption>Invoice line items<\/caption>/);
    assert.match(html, /<th scope="col">Description<\/th>/);
    assert.match(html, /\$299\.50/);
});

test('createInvoiceFilename removes unsafe filename characters', () => {
    assert.equal(
        createInvoiceFilename('../../Invoice 42\r\n"unsafe"'),
        'invoice-Invoice-42-unsafe.pdf'
    );
});
