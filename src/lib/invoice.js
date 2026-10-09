const LIMITS = Object.freeze({
    invoiceNumber: 80,
    customerName: 120,
    description: 200,
    notes: 1000,
    lineItems: 100,
    quantity: 100000,
    unitPrice: 10000000
});

const TOP_LEVEL_FIELDS = new Set(['invoiceNumber', 'customerName', 'lineItems', 'notes']);
const LINE_ITEM_FIELDS = new Set(['description', 'quantity', 'unitPrice']);

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addUnknownFieldErrors(value, allowedFields, path, errors) {
    for (const field of Object.keys(value)) {
        if (!allowedFields.has(field)) {
            errors.push({
                field: `${path}${field}`,
                message: 'Field is not supported.'
            });
        }
    }
}

function validateText(value, field, maxLength, errors, required = true) {
    if (value === undefined || value === null) {
        if (required) {
            errors.push({ field, message: 'Field is required.' });
        }
        return '';
    }

    if (typeof value !== 'string') {
        errors.push({ field, message: 'Must be a string.' });
        return '';
    }

    const normalized = value.trim();
    if (required && normalized.length === 0) {
        errors.push({ field, message: 'Must not be empty.' });
    }
    if (normalized.length > maxLength) {
        errors.push({ field, message: `Must be ${maxLength} characters or fewer.` });
    }

    return normalized;
}

function validateNumber(value, field, minimum, maximum, errors) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push({ field, message: 'Must be a finite number.' });
        return 0;
    }
    if (value < minimum || value > maximum) {
        errors.push({
            field,
            message: `Must be between ${minimum} and ${maximum}.`
        });
    }

    return value;
}

function validateInvoice(payload) {
    const errors = [];
    if (!isRecord(payload)) {
        return {
            ok: false,
            errors: [{ field: '$', message: 'Request body must be a JSON object.' }]
        };
    }

    addUnknownFieldErrors(payload, TOP_LEVEL_FIELDS, '', errors);

    const invoiceNumber = validateText(
        payload.invoiceNumber,
        'invoiceNumber',
        LIMITS.invoiceNumber,
        errors
    );
    const customerName = validateText(
        payload.customerName,
        'customerName',
        LIMITS.customerName,
        errors
    );
    const notes = validateText(payload.notes, 'notes', LIMITS.notes, errors, false);

    const lineItems = [];
    if (!Array.isArray(payload.lineItems)) {
        errors.push({ field: 'lineItems', message: 'Must be an array.' });
    } else if (payload.lineItems.length === 0 || payload.lineItems.length > LIMITS.lineItems) {
        errors.push({
            field: 'lineItems',
            message: `Must contain between 1 and ${LIMITS.lineItems} items.`
        });
    } else {
        payload.lineItems.forEach((item, index) => {
            const itemPath = `lineItems[${index}]`;
            if (!isRecord(item)) {
                errors.push({ field: itemPath, message: 'Must be an object.' });
                return;
            }

            addUnknownFieldErrors(item, LINE_ITEM_FIELDS, `${itemPath}.`, errors);
            lineItems.push({
                description: validateText(
                    item.description,
                    `${itemPath}.description`,
                    LIMITS.description,
                    errors
                ),
                quantity: validateNumber(
                    item.quantity,
                    `${itemPath}.quantity`,
                    Number.MIN_VALUE,
                    LIMITS.quantity,
                    errors
                ),
                unitPrice: validateNumber(
                    item.unitPrice,
                    `${itemPath}.unitPrice`,
                    0,
                    LIMITS.unitPrice,
                    errors
                )
            });
        });
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    return {
        ok: true,
        value: {
            invoiceNumber,
            customerName,
            lineItems,
            ...(notes ? { notes } : {})
        }
    };
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatMoney(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(value);
}

function formatQuantity(value) {
    return new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 3
    }).format(value);
}

function buildInvoiceHtml(invoice, generatedAt = new Date()) {
    const total = invoice.lineItems.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
    );
    const rows = invoice.lineItems.map((item) => {
        const lineTotal = item.quantity * item.unitPrice;
        return `
            <tr>
                <td>${escapeHtml(item.description)}</td>
                <td class="number">${formatQuantity(item.quantity)}</td>
                <td class="number">${formatMoney(item.unitPrice)}</td>
                <td class="number">${formatMoney(lineTotal)}</td>
            </tr>`;
    }).join('');
    const dateLabel = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
    }).format(generatedAt);
    const notes = invoice.notes
        ? `<section class="notes" aria-labelledby="notes-heading">
                <h2 id="notes-heading">Notes</h2>
                <p>${escapeHtml(invoice.notes)}</p>
           </section>`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
    <style>
        :root {
            color: #172033;
            font-family: Arial, "Noto Sans", sans-serif;
            font-size: 12px;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: #fff;
            color: #172033;
        }
        main {
            width: 100%;
            padding: 8mm 6mm;
        }
        header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 24px;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 18px;
            margin-bottom: 26px;
        }
        h1 {
            margin: 0;
            color: #1d4ed8;
            font-size: 34px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }
        h2 {
            margin: 0 0 8px;
            font-size: 15px;
        }
        p { margin: 0; line-height: 1.5; }
        .meta {
            min-width: 230px;
            border-left: 1px solid #cbd5e1;
            padding-left: 20px;
        }
        .meta-row {
            display: grid;
            grid-template-columns: 90px 1fr;
            gap: 10px;
            padding: 3px 0;
        }
        .label {
            color: #475569;
            font-weight: 700;
        }
        .bill-to {
            background: #eff6ff;
            border-left: 4px solid #3b82f6;
            border-radius: 4px;
            padding: 15px 18px;
            margin-bottom: 24px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 18px;
        }
        caption {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }
        th {
            background: #1e3a8a;
            color: #fff;
            font-size: 11px;
            letter-spacing: 0.04em;
            padding: 11px 10px;
            text-align: left;
            text-transform: uppercase;
        }
        td {
            border-bottom: 1px solid #dbeafe;
            padding: 11px 10px;
            vertical-align: top;
        }
        tbody tr:nth-child(even) { background: #f8fafc; }
        .number {
            text-align: right;
            white-space: nowrap;
        }
        .total {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 28px;
        }
        .total-box {
            display: grid;
            grid-template-columns: auto auto;
            gap: 22px;
            min-width: 280px;
            background: #172554;
            color: #fff;
            border-radius: 4px;
            padding: 14px 18px;
            font-size: 17px;
            font-weight: 700;
        }
        .notes {
            border-top: 1px solid #cbd5e1;
            padding-top: 16px;
        }
        .notes p {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }
        footer {
            margin-top: 34px;
            color: #64748b;
            font-size: 10px;
            text-align: center;
        }
        @page { size: A4; margin: 12mm; }
    </style>
</head>
<body>
    <main>
        <header>
            <div>
                <h1>Invoice</h1>
                <p>Generated by an Azure Functions custom-container demo.</p>
            </div>
            <div class="meta" aria-label="Invoice details">
                <div class="meta-row"><span class="label">Invoice</span><span>${escapeHtml(invoice.invoiceNumber)}</span></div>
                <div class="meta-row"><span class="label">Generated</span><span>${escapeHtml(dateLabel)} UTC</span></div>
            </div>
        </header>

        <section class="bill-to" aria-labelledby="bill-to-heading">
            <h2 id="bill-to-heading">Bill to</h2>
            <p>${escapeHtml(invoice.customerName)}</p>
        </section>

        <table>
            <caption>Invoice line items</caption>
            <thead>
                <tr>
                    <th scope="col">Description</th>
                    <th scope="col" class="number">Quantity</th>
                    <th scope="col" class="number">Unit price</th>
                    <th scope="col" class="number">Amount</th>
                </tr>
            </thead>
            <tbody>${rows}
            </tbody>
        </table>

        <section class="total" aria-label="Invoice total">
            <div class="total-box">
                <span>Total (USD)</span>
                <span>${formatMoney(total)}</span>
            </div>
        </section>

        ${notes}

        <footer>This sample assumes USD and stores no invoice data.</footer>
    </main>
</body>
</html>`;
}

function createInvoiceFilename(invoiceNumber) {
    const safePart = String(invoiceNumber)
        .normalize('NFKD')
        .replace(/[^\x00-\x7F]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^[.-]+|[.-]+$/g, '')
        .slice(0, 60) || 'document';

    return `invoice-${safePart}.pdf`;
}

module.exports = {
    LIMITS,
    buildInvoiceHtml,
    createInvoiceFilename,
    escapeHtml,
    validateInvoice
};
